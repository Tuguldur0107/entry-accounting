import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { calculateSettlementExchangeEffect } from "@/lib/arap/accounting";
import { logAuditEvent } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import {
  buildCashAccountCodeRules,
  validateCashAccountCode,
} from "@/lib/cash/account-code-validation";
import type { ParsedBankStatement } from "@/lib/cash/bank-statement-types";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { loadCostingAccountSettings } from "@/lib/costing/master-data";
import { buildSegCode } from "@/lib/grid/segments";
import { assertPeriodsOpen } from "@/lib/periods/guard";
import { db } from "@/lib/db";
import {
  arApDocuments,
  arApSettlements,
  bankStatementLines,
  bankStatements,
  cashAccounts,
  cashDocuments,
  chartOfAccounts,
  journalLines,
  journalVouchers,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";

export const runtime = "nodejs";

type SavePayload = ParsedBankStatement & {
  cashAccountId: string;
};

function chunks<T>(items: T[], size = 400) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    output.push(items.slice(index, index + size));
  return output;
}

export async function POST(request: Request) {
  // Хуулгын импорт = бичилт үүсгэх мутаци — accountant+ эрх шаардана.
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireRole("accountant"));
  } catch (caught) {
    return Response.json(
      {
        error:
          caught instanceof Error ? caught.message : "Нэвтрэх шаардлагатай",
      },
      { status: 401 }
    );
  }

  try {
    const payload = (await request.json()) as SavePayload;
    if (!payload.cashAccountId)
      throw new Error("Банкны Cash данс сонгоно уу");
    if (!payload.fileName || !payload.fileHash)
      throw new Error("Хуулгын файлын мэдээлэл дутуу");
    if (!Array.isArray(payload.rows) || payload.rows.length === 0)
      throw new Error("Хадгалах гүйлгээ алга");
    if (payload.rows.length > 5_000)
      throw new Error("Нэг удаад 5,000 хүртэл гүйлгээ хадгална");

    const [cashAccount, duplicate, glAccounts, configs, values] =
      await Promise.all([
        db.query.cashAccounts.findFirst({
          where: and(
            eq(cashAccounts.id, payload.cashAccountId),
            eq(cashAccounts.organizationId, orgId),
            eq(cashAccounts.isActive, true)
          ),
        }),
        // fileHash давхардлын шалгалт БАЙГУУЛЛАГЫН түвшинд — өөр org ижил
        // файлыг өөрийн дансандаа импортолж болно.
        db.query.bankStatements.findFirst({
          where: and(
            eq(bankStatements.organizationId, orgId),
            eq(bankStatements.fileHash, payload.fileHash)
          ),
          columns: { id: true },
        }),
        db.query.chartOfAccounts.findMany({
          where: eq(chartOfAccounts.organizationId, orgId),
        }),
        db.query.segmentConfigs.findMany({
          where: eq(segmentConfigs.organizationId, orgId),
        }),
        db.query.segmentValues.findMany({
          where: eq(segmentValues.organizationId, orgId),
        }),
      ]);
    if (!cashAccount) throw new Error("Идэвхтэй банкны Cash данс олдсонгүй");
    if (duplicate) throw new Error("Энэ хуулга өмнө нь импортлогдсон байна");

    const accountCodeRules = buildCashAccountCodeRules(
      configs,
      values,
      glAccounts
    );

    const rows = payload.rows.map((row, index) => {
      const income = Number(row.income);
      const expense = Number(row.expense);
      if (
        !Number.isFinite(income) ||
        !Number.isFinite(expense) ||
        (income <= 0 && expense <= 0) ||
        (income > 0 && expense > 0)
      )
        throw new Error(`${index + 1}-р мөрийн орлого/зарлагын дүн буруу`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.transactionDate))
        throw new Error(`${index + 1}-р мөрийн огноо буруу`);
      let debitMain: string;
      let creditMain: string;
      try {
        debitMain = validateCashAccountCode(
          row.debitAccountNumber,
          accountCodeRules
        );
        creditMain = validateCashAccountCode(
          row.creditAccountNumber,
          accountCodeRules
        );
      } catch (caught) {
        const reason =
          caught instanceof Error ? caught.message : "дансны бүтэц буруу";
        throw new Error(`${index + 1}-р мөрийн DR/CR ${reason}`);
      }
      if (income > 0 && debitMain !== cashAccount.glAccountNumber)
        throw new Error(`${index + 1}-р мөрийн DR тал банкны данс биш байна`);
      if (expense > 0 && creditMain !== cashAccount.glAccountNumber)
        throw new Error(`${index + 1}-р мөрийн CR тал банкны данс биш байна`);

      const exchangeRate =
        cashAccount.currency === "MNT" ? 1 : Number(row.exchangeRate);
      const baseAmount =
        cashAccount.currency === "MNT"
          ? income > 0
            ? income
            : expense
          : Number(row.baseAmount) ||
            Math.round(
              (income > 0 ? income : expense) * exchangeRate * 100
            ) / 100;
      if (!Number.isFinite(exchangeRate) || exchangeRate <= 0)
        throw new Error(`${index + 1}-р мөрийн валютын ханш буруу`);
      if (!Number.isFinite(baseAmount) || baseAmount <= 0)
        throw new Error(`${index + 1}-р мөрийн MNT дүн буруу`);

      return {
        ...row,
        income,
        expense,
        debitMain,
        creditMain,
        amount: income > 0 ? income : expense,
        exchangeRate,
        baseAmount,
      };
    });

    // Хаагдсан периодын хамгаалалт — мөр бүр өөрийн огноогоор GL-д бичигдэнэ.
    await assertPeriodsOpen(
      orgId,
      rows.map((row) => row.transactionDate)
    );

    // ── Нэхэмжлэхийн settlement — саналыг «Ашиглах» дарсан мөрүүд ──────────
    // Хуулгын мөр нэхэмжлэхтэй холбогдвол кассын баримт нь settlement болж,
    // нэхэмжлэхийн төлсөн дүн/төлөв шинэчлэгдэнэ (АР/АП төлбөртэй ижил дүрэм).
    const settleRows = rows.filter((row) => row.settleInvoiceId);
    const invoiceIds = [
      ...new Set(settleRows.map((row) => row.settleInvoiceId as string)),
    ];
    const invoices = invoiceIds.length
      ? await db.query.arApDocuments.findMany({
          where: and(
            eq(arApDocuments.organizationId, orgId),
            inArray(arApDocuments.id, invoiceIds)
          ),
        })
      : [];
    const invoiceById = new Map(invoices.map((doc) => [doc.id, doc]));
    // Нэхэмжлэх бүрийн нийлбэр (гүйлгээний валютаар + түүхэн ханшийн MNT) —
    // үлдэгдлийн шалгалт болон транзакц доторх нэг удаагийн update-д.
    const settleTotals = new Map<
      string,
      { amount: number; historicalBase: number }
    >();
    // Мөр бүрийн ханшийн үр нөлөө (postCashDocument-тэй ижил): хяналтын данс
    // ТҮҮХЭН ханшаар хаагдаж, төлбөрийн өдрийн ханштай зөрүү нь олз/гарз.
    const settleEffectByRowId = new Map<
      string,
      ReturnType<typeof calculateSettlementExchangeEffect>
    >();
    // Мөрийн id нь settleEffectByRowId-ийн түлхүүр — дутуу/давхардсан id
    // ханшийн effect-ийг буруу мөрөнд хэрэглэх тул урьдчилан таслана.
    const seenSettleRowIds = new Set<string>();
    for (const row of settleRows) {
      if (
        typeof row.id !== "string" ||
        !row.id ||
        seenSettleRowIds.has(row.id)
      )
        throw new Error(
          `${row.rowNumber}-р мөрийн дотоод ID дутуу эсвэл давхардсан байна — файлаа дахин уншуулна уу`
        );
      seenSettleRowIds.add(row.id);
      const invoice = invoiceById.get(row.settleInvoiceId as string);
      if (!invoice)
        throw new Error(
          `${row.rowNumber}-р мөрийн холбосон нэхэмжлэх олдсонгүй`
        );
      if (invoice.status !== "posted" && invoice.status !== "partially_paid")
        throw new Error(
          `${row.rowNumber}-р мөр: ${invoice.documentNo} нэхэмжлэх төлбөр хүлээх төлөвт биш байна`
        );
      const expectedType =
        invoice.documentType === "ar_invoice" ? "income" : "expense";
      if (
        (expectedType === "income" && row.income <= 0) ||
        (expectedType === "expense" && row.expense <= 0)
      )
        throw new Error(
          `${row.rowNumber}-р мөрийн чиглэл ${invoice.documentNo} нэхэмжлэхтэй таарахгүй байна`
        );
      if (invoice.currency !== cashAccount.currency)
        throw new Error(
          `${row.rowNumber}-р мөр: банкны дансны валют ${invoice.documentNo}-ийн валюттай зөрж байна — валют хөрвүүлэлттэй төлбөрийг Мөнгөн хөрөнгө модулиар бүртгэнэ үү`
        );
      // Харьцах тал нь нэхэмжлэхийн хяналтын данс байх ёстой (саналын дагуу).
      const controlMain = invoice.controlAccountNumber.split(".").length === 10
        ? invoice.controlAccountNumber.split(".")[2]
        : invoice.controlAccountNumber;
      const counterMain = row.income > 0 ? row.creditMain : row.debitMain;
      if (counterMain !== controlMain)
        throw new Error(
          `${row.rowNumber}-р мөрийн харьцах данс ${invoice.documentNo}-ийн хяналтын данстай таарахгүй байна`
        );
      const effect = calculateSettlementExchangeEffect({
        documentType: invoice.documentType as "ar_invoice" | "ap_bill",
        amount: row.amount,
        documentExchangeRate: Number(invoice.exchangeRate),
        paymentBaseAmount: row.baseAmount,
      });
      settleEffectByRowId.set(row.id, effect);
      const slot = settleTotals.get(invoice.id) ?? {
        amount: 0,
        historicalBase: 0,
      };
      slot.amount = Math.round((slot.amount + row.amount) * 100) / 100;
      slot.historicalBase =
        Math.round((slot.historicalBase + effect.historicalBaseAmount) * 100) /
        100;
      settleTotals.set(invoice.id, slot);
    }
    // Нэг нэхэмжлэхийг хэд хэдэн мөрөөр хааж болно — нийлбэр нь үлдэгдлээс
    // хэтрэхгүй (transaction доторх атом guard давхар хамгаална).
    for (const [invoiceId, totals] of settleTotals) {
      const invoice = invoiceById.get(invoiceId)!;
      const balance =
        Math.round(
          (Number(invoice.totalAmount) - Number(invoice.paidAmount)) * 100
        ) / 100;
      if (totals.amount > balance + 0.005)
        throw new Error(
          `${invoice.documentNo}: холбосон мөрүүдийн нийлбэр (${totals.amount.toLocaleString("en-US")}) үлдэгдлээс (${balance.toLocaleString("en-US")}) их байна`
        );
    }

    // Ханшийн зөрүүтэй settlement байвал олз/гарзын данс шаардлагатай —
    // тохиргооноос уншиж (postCashDocument-тэй ижил эх сурвалж), идэвхтэй
    // эсэхийг урьдчилан шалгана.
    const needsFxGain = settleRows.some((row) => {
      const effect = settleEffectByRowId.get(row.id);
      if (!effect || Math.abs(effect.difference) <= 0.01) return false;
      const invoice = invoiceById.get(row.settleInvoiceId as string)!;
      return invoice.documentType === "ar_invoice"
        ? effect.difference > 0
        : effect.difference < 0;
    });
    const needsFxLoss = settleRows.some((row) => {
      const effect = settleEffectByRowId.get(row.id);
      if (!effect || Math.abs(effect.difference) <= 0.01) return false;
      const invoice = invoiceById.get(row.settleInvoiceId as string)!;
      return invoice.documentType === "ar_invoice"
        ? effect.difference < 0
        : effect.difference > 0;
    });
    let fxGainMain = "51800001";
    let fxLossMain = "87000003";
    if (needsFxGain || needsFxLoss) {
      const costingSettings = await loadCostingAccountSettings(orgId);
      fxGainMain = costingSettings.fxGainAccountNumber;
      fxLossMain = costingSettings.fxLossAccountNumber;
      for (const main of [
        ...(needsFxGain ? [fxGainMain] : []),
        ...(needsFxLoss ? [fxLossMain] : []),
      ])
        if (
          !glAccounts.some(
            (account) => account.number === main && account.isEnabled
          )
        )
          throw new Error(
            `Ханшийн олз/гарзын данс (${main}) идэвхтэй биш байна — өртгийн дансны тохиргоог шалгана уу`
          );
    }
    // FX мөрийн бүтэн сегмент код — cashPostingCodeBuilder-тэй ижил дүрэм:
    // идэвхтэй сегмент бүрд ганц сонголттой бол default, S9 = "CA".
    const configMap = new Map(configs.map((config) => [config.segmentId, config]));
    const fxActiveSegIds = SEGMENT_DEFS.filter(
      (definition) =>
        definition.id === 3 || configMap.get(definition.id)?.isEnabled === true
    ).map((definition) => definition.id);
    const fxDefaults: Record<number, string> = {};
    for (const segmentId of fxActiveSegIds) {
      const options = values.filter(
        (value) => value.segmentId === segmentId && value.isEnabled
      );
      if (options.length === 1) fxDefaults[segmentId] = options[0].code;
    }
    if (fxActiveSegIds.includes(9)) fxDefaults[9] = "CA";
    const buildFxCode = (mainAccount: string, cashFlowCode: string | null) => {
      const parts: Record<number, string> = { ...fxDefaults, 3: mainAccount };
      if (cashFlowCode && fxActiveSegIds.includes(8)) parts[8] = cashFlowCode;
      return buildSegCode(parts, fxActiveSegIds, { ...fxDefaults, 9: "CA" });
    };

    const totalIncome = rows.reduce((sum, row) => sum + row.income, 0);
    const totalExpense = rows.reduce((sum, row) => sum + row.expense, 0);

    const statementId = await db.transaction(async (tx) => {
      const [statement] = await tx
        .insert(bankStatements)
        .values({
          userId,
          organizationId: orgId,
          cashAccountId: cashAccount.id,
          fileName: payload.fileName.slice(0, 255),
          fileHash: payload.fileHash,
          bankName: payload.bankName?.slice(0, 120) || cashAccount.bankName,
          currency: cashAccount.currency,
          periodStart: payload.periodStart || null,
          periodEnd: payload.periodEnd || null,
          rowCount: rows.length,
          totalIncome: String(totalIncome),
          totalExpense: String(totalExpense),
          status: "posted",
        })
        .returning({ id: bankStatements.id });

      const postingRows = rows.map((row) => ({
        ...row,
        voucherId: randomUUID(),
        cashDocumentId: randomUUID(),
      }));

      for (const group of chunks(postingRows)) {
        await tx.insert(journalVouchers).values(
          group.map((row) => ({
            id: row.voucherId,
            userId,
            organizationId: orgId,
            date: row.transactionDate,
            description: `[BANK ${statement.id.slice(0, 8)}-${row.rowNumber}] ${
              row.description || row.counterparty || "Банкны гүйлгээ"
            }`,
            status: "posted",
          }))
        );
      }

      const allJournalLines = postingRows.flatMap((row) => {
        const lineDescription = row.description || row.counterparty;
        const effect = row.settleInvoiceId
          ? settleEffectByRowId.get(row.id)
          : undefined;
        // Settlement мөр: хяналтын (харьцах) данс нэхэмжлэхийн ТҮҮХЭН
        // ханшаар хаагдана; банкны тал төлбөрийн өдрийн ханшаар. Зөрүү нь
        // ханшийн олз/гарзын мөр болно (buildSettlementPostingLines-тэй ижил).
        const counterBase = effect
          ? effect.historicalBaseAmount
          : row.baseAmount;
        const lines = [
          {
            voucherId: row.voucherId,
            accountNumber: row.debitAccountNumber,
            cashAccountId: row.income > 0 ? cashAccount.id : null,
            debit: String(row.income > 0 ? row.baseAmount : counterBase),
            credit: "0",
            description: lineDescription,
            sortOrder: 0,
          },
          {
            voucherId: row.voucherId,
            accountNumber: row.creditAccountNumber,
            cashAccountId: row.expense > 0 ? cashAccount.id : null,
            debit: "0",
            credit: String(row.expense > 0 ? row.baseAmount : counterBase),
            description: lineDescription,
            sortOrder: 1,
          },
        ];
        if (effect && Math.abs(effect.difference) > 0.01) {
          const invoice = invoiceById.get(row.settleInvoiceId as string)!;
          const isGain =
            invoice.documentType === "ar_invoice"
              ? effect.difference > 0
              : effect.difference < 0;
          const fxAmount = String(Math.abs(effect.difference));
          lines.push({
            voucherId: row.voucherId,
            accountNumber: buildFxCode(
              isGain ? fxGainMain : fxLossMain,
              row.debitAccountNumber.split(".")[7] ||
                row.creditAccountNumber.split(".")[7] ||
                null
            ),
            cashAccountId: null,
            debit: isGain ? "0" : fxAmount,
            credit: isGain ? fxAmount : "0",
            description: `Ханшийн ${isGain ? "олз" : "гарз"}: ${lineDescription}`,
            sortOrder: 2,
          });
        }
        return lines;
      });
      for (const group of chunks(allJournalLines))
        await tx.insert(journalLines).values(group);

      for (const group of chunks(postingRows)) {
        await tx.insert(cashDocuments).values(
          group.map((row) => ({
            id: row.cashDocumentId,
            userId,
            organizationId: orgId,
            documentNo: `BS-${statement.id.slice(0, 8).toUpperCase()}-${
              row.rowNumber
            }`,
            documentType: row.income > 0 ? "receipt" : "payment",
            date: row.transactionDate,
            fromCashAccountId: row.expense > 0 ? cashAccount.id : null,
            toCashAccountId: row.income > 0 ? cashAccount.id : null,
            counterAccountNumber:
              row.income > 0 ? row.creditMain : row.debitMain,
            cashFlowCode:
              row.debitAccountNumber.split(".")[7] ||
              row.creditAccountNumber.split(".")[7] ||
              null,
            counterparty: row.counterparty || null,
            description: row.description || "Банкны гүйлгээ",
            amount: String(row.amount),
            currency: cashAccount.currency,
            exchangeRate: String(row.exchangeRate),
            baseAmount: String(row.baseAmount),
            status: "posted",
            voucherId: row.voucherId,
            // Нэхэмжлэхтэй холбогдсон мөр — settlement баримт болно.
            // `|| null`: хоосон тэмдэгт settlement шүүлтийг давдаггүйтэй
            // нийцүүлж uuid баганад орохоос сэргийлнэ.
            arApDocumentId: row.settleInvoiceId || null,
            postedAt: new Date(),
          }))
        );
      }

      // Settlement: нэхэмжлэхийн төлсөн дүн/төлөвийг атом guard-тай
      // шинэчилнэ (postCashDocument-тэй ижил дүрэм; basePaidAmount нь
      // ТҮҮХЭН ханшаар). Нэхэмжлэх бүрд НЭГ update — 5000 мөрийн импортод
      // мөр тус бүрийн round-trip хийхгүй.
      for (const [invoiceId, totals] of settleTotals) {
        const [updated] = await tx
          .update(arApDocuments)
          .set({
            paidAmount: sql`${arApDocuments.paidAmount} + ${String(totals.amount)}`,
            basePaidAmount: sql`${arApDocuments.basePaidAmount} + ${String(totals.historicalBase)}`,
            status: sql`CASE WHEN ${arApDocuments.paidAmount} + ${String(
              totals.amount
            )} >= ${arApDocuments.totalAmount} - 0.005 THEN 'paid' ELSE 'partially_paid' END`,
          })
          .where(
            and(
              eq(arApDocuments.id, invoiceId),
              eq(arApDocuments.organizationId, orgId),
              inArray(arApDocuments.status, ["posted", "partially_paid"]),
              sql`${arApDocuments.totalAmount} - ${arApDocuments.paidAmount} >= ${String(
                totals.amount
              )} - 0.005`
            )
          )
          .returning({ id: arApDocuments.id });
        if (!updated)
          throw new Error(
            `${invoiceById.get(invoiceId)!.documentNo}: нэхэмжлэхийн үлдэгдэл өөрчлөгдсөн байна — дахин оролдоно уу`
          );
      }
      const settlementInserts = postingRows
        .filter((row) => row.settleInvoiceId)
        .map((row) => ({
          userId,
          organizationId: orgId,
          documentId: row.settleInvoiceId as string,
          cashDocumentId: row.cashDocumentId,
          settlementDate: row.transactionDate,
          amount: String(row.amount),
          baseAmount: String(
            settleEffectByRowId.get(row.id)?.historicalBaseAmount ??
              row.baseAmount
          ),
        }));
      for (const group of chunks(settlementInserts))
        await tx.insert(arApSettlements).values(group);

      // Импорт = олон posted бичилт үүсгэдэг ТОМ мутаци — аудитад нэг мөр.
      await logAuditEvent(
        {
          userId,
          organizationId: orgId,
          action: "import",
          entityType: "cash",
          entityId: statement.id,
          summary: `Банкны хуулга импортлогдов — ${payload.fileName.slice(0, 80)}, ${rows.length} мөр, орлого ${totalIncome.toLocaleString("en-US")}, зарлага ${totalExpense.toLocaleString("en-US")}${settleRows.length ? `, ${settleRows.length} мөр нэхэмжлэхтэй холбогдов` : ""}`,
        },
        tx
      );

      const persistedLines = postingRows.map((row) => ({
        statementId: statement.id,
        rowNumber: row.rowNumber,
        transactionDate: row.transactionDate,
        valueDate: row.valueDate || null,
        description: row.description || "Банкны гүйлгээ",
        counterparty: row.counterparty || null,
        counterAccount: row.counterAccount || null,
        income: String(row.income),
        expense: String(row.expense),
        balance: row.balance == null ? null : String(row.balance),
        exchangeRate: String(row.exchangeRate),
        baseAmount: String(row.baseAmount),
        debitAccountNumber: row.debitAccountNumber,
        creditAccountNumber: row.creditAccountNumber,
        rawData: JSON.stringify(row.rawData),
        cashDocumentId: row.cashDocumentId,
        voucherId: row.voucherId,
      }));
      for (const group of chunks(persistedLines))
        await tx.insert(bankStatementLines).values(group);

      return statement.id;
    });

    revalidatePath("/cash");
    revalidatePath("/cash/accounts");
    revalidatePath("/cash/transactions");
    revalidatePath("/cash/statements");
    revalidatePath("/gl/journal");
    revalidatePath("/gl/reports");
    // Settlement нэхэмжлэхийн үлдэгдлийг өөрчилдөг.
    revalidatePath("/receivables/documents");
    revalidatePath("/payables/documents");
    return Response.json({ id: statementId, rowCount: rows.length });
  } catch (caught) {
    const error = caught as { code?: string; message?: string };
    const message =
      error.code === "23505"
        ? "Энэ хуулга өмнө нь импортлогдсон байна"
        : error.message || "Хуулга хадгалж чадсангүй";
    return Response.json({ error: message }, { status: 400 });
  }
}

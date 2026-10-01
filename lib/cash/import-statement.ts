// Банкны хуулгын импортын ЦӨМ — /api/cash/statements/save route болон
// MCP-ийн import_bank_statement tool хоёул ЭНЭ функцийг дуудна (нэг л зам).
// Эрхийн шалгалт (accountant+) функц дотроо — action-уудтай ижил хэв маяг.

import { settlementCashType } from "@/lib/arap/document-kind";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { calculateSettlementExchangeEffect } from "@/lib/arap/accounting";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction } from "@/lib/auth";
import {
  buildCashAccountCodeRules,
  validateCashAccountCode,
} from "@/lib/cash/account-code-validation";
import type { ParsedBankStatement } from "@/lib/cash/bank-statement-types";
import {
  validateEwalletSettlementRow,
  type EwalletSettlementMethod,
} from "@/lib/cash/ewallet-settlement";
import { loadEwalletSettlementContext } from "@/lib/cash/ewallet-settlement-data";
import { buildSettlementPostingLines } from "@/lib/cash/settlement-lines";
import { loadCostingAccountSettings } from "@/lib/costing/master-data";
import { postingCodeBuilderFromData } from "@/lib/gl/posting-code";
import { assertPeriodOpenInTx, assertPeriodsOpen } from "@/lib/periods/guard";
import { nextVoucherNos } from "@/lib/gl/voucher-no";
import { db } from "@/lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  arApSettlements,
  bankStatementLines,
  bankStatements,
  cashAccounts,
  cashDocuments,
  chartOfAccounts,
  counterparties,
  journalLines,
  journalVouchers,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { matchCounterpartyByName } from "@/lib/cash/list-columns";
import {
  BANK_ROW_ACTION_LABELS,
  bankRowActionAdvanceSide,
  bankRowActionDirection,
  bankRowActionInvoiceType,
  isBankRowAction,
  splitInclusiveVat,
  type BankRowAction,
} from "@/lib/arap/advance-math";
import { advanceAccountFor, loadAdvanceSettings } from "@/lib/arap/advances";
import { counterpartyDirectionError } from "@/lib/arap/counterparty-kind";
import { documentNoPrefix } from "@/lib/arap/document-kind";
import { loadArApSegmentData } from "@/lib/arap/load-data";
import { loadVatSettings } from "@/lib/vat/settings";
import { extractMainAccount } from "@/lib/reports/balances";
import { nextVoucherNo } from "@/lib/gl/voucher-no";
import { loadImportedExternalRefs } from "@/lib/cash/statement-external-refs";
import { enqueueArapInvoiceEbarimt } from "@/lib/ebarimt/queue";


export type SavePayload = ParsedBankStatement & {
  cashAccountId: string;
};

function chunks<T>(items: T[], size = 400) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    output.push(items.slice(index, index + size));
  return output;
}

export async function saveBankStatement(
  payload: SavePayload
): Promise<{ id: string; rowCount: number }> {
  // Мөр бүр кассын баримт + GL журналыг БАТАЛНА — модулийн батлах эрх
  // (cash:post). Өмнө нь role-оор (accountant+) шалгадаг тул cash:write
  // override-той гишүүн ч батлах, багцын read-only горимыг ч тойрдог байв
  // (ontology-audit §4.2; requireModuleAction нь entitlement-ийг хамт шалгана).
  const { orgId, userId } = await requireModuleAction("cash", "post");
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

    // Банкны API-аас татсан мөр (externalRef) — огнооны муж давхцсан татал
    // ижил гүйлгээг GL-д ДАХИН бичихгүй.
    const externalRefs = payload.rows
      .map((row) => row.externalRef ?? "")
      .filter(Boolean);
    if (new Set(externalRefs).size !== externalRefs.length)
      throw new Error("Хуулгад ижил гүйлгээ давхар орсон байна");
    if (externalRefs.length > 0) {
      const imported = await loadImportedExternalRefs(orgId, externalRefs);
      if (imported.size > 0)
        throw new Error(
          `${imported.size} гүйлгээ өмнө нь импортлогдсон байна — хуулгыг банкнаас дахин татна уу`
        );
    }

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
      // Алдаанд аль тал, ямар данс болохыг нэрлэнэ — засварыг олоход хялбар.
      const validateSide = (side: "DR" | "CR", code: string) => {
        try {
          return validateCashAccountCode(code, accountCodeRules);
        } catch (caught) {
          const reason =
            caught instanceof Error ? caught.message : "дансны бүтэц буруу";
          const main = code.split(".").length === 10 ? code.split(".")[2] : code;
          throw new Error(
            `${index + 1}-р мөрийн ${side} (данс ${main || code}): ${reason}`
          );
        }
      };
      const debitMain = validateSide("DR", row.debitAccountNumber);
      const creditMain = validateSide("CR", row.creditAccountNumber);
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

    // Харилцагчийн задаргаа: нэхэмжлэхтэй холбогдсон мөр нэхэмжлэхийн
    // харилцагчийг, бусад мөр (банкны дүрмээс ирсэн) чөлөөт нэрээр ЯГ таарсан
    // бүртгэлийг холбоно — жагсаалтын "Харилцагчийн код/нэр" багана бөглөгдөнө.
    // Таараагүй нэр текстээрээ үлдэнэ (ХОЛБООС ЗОХИОХГҮЙ).
    const counterpartyList = await db.query.counterparties.findMany({
      where: eq(counterparties.organizationId, orgId),
      columns: {
        id: true,
        name: true,
        counterpartyType: true,
        isActive: true,
        defaultPayableAccountNumber: true,
        defaultReceivableAccountNumber: true,
      },
    });
    const counterpartyById = new Map(counterpartyList.map((c) => [c.id, c]));
    // Мөрөнд ил сонгосон харилцагч (бүртгэлтэй, идэвхтэй) — нэрээр таахаас давуу.
    for (const row of rows) {
      if (!row.counterpartyId) continue;
      const master = counterpartyById.get(row.counterpartyId);
      if (!master || !master.isActive)
        throw new Error(`${row.rowNumber}-р мөрийн сонгосон харилцагч олдсонгүй эсвэл идэвхгүй`);
    }
    const counterpartyLinkFor = (row: {
      settleInvoiceId?: string | null;
      counterpartyId?: string | null;
      counterparty?: string | null;
    }): { counterpartyId: string | null; counterparty: string | null } => {
      const invoice = row.settleInvoiceId
        ? invoiceById.get(row.settleInvoiceId)
        : undefined;
      if (invoice) {
        const master = counterpartyList.find((c) => c.id === invoice.counterpartyId);
        return {
          counterpartyId: invoice.counterpartyId,
          counterparty: master?.name ?? row.counterparty ?? null,
        };
      }
      const chosen = row.counterpartyId ? counterpartyById.get(row.counterpartyId) : undefined;
      if (chosen) return { counterpartyId: chosen.id, counterparty: chosen.name };
      const match = matchCounterpartyByName(row.counterparty, counterpartyList);
      return match
        ? { counterpartyId: match.id, counterparty: match.name }
        : { counterpartyId: null, counterparty: row.counterparty || null };
    };
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
        settlementCashType(invoice.documentType) === "receipt" ? "income" : "expense";
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

    // ── Э-хэтэвчийн (QPay) settlement мөрүүд ─────────────────────────────
    // Мөр = түр данс → банк шилжүүлэг (цэвэр) + шимтгэлийн зарлага (түр
    // данснаас). Нийт (gross) нь түр дансны тулгагдаагүй үлдэгдлээс хэтрэхгүй;
    // нэг импорт доторх хэд хэдэн settlement дарааллаар үлдэгдлээс хасна.
    const ewalletRows = rows.filter((row) => row.ewalletSettlement);
    const ewalletMethodById = new Map<string, EwalletSettlementMethod>();
    let ewalletFeeAccountNumber = "";
    let ewalletFeeCode = "";
    if (ewalletRows.length) {
      const context = await loadEwalletSettlementContext(orgId);
      for (const method of context.methods) ewalletMethodById.set(method.paymentMethodId, method);
      ewalletFeeAccountNumber = context.feeAccountNumber;
      if (
        !glAccounts.some(
          (account) => account.number === ewalletFeeAccountNumber && account.isEnabled
        )
      )
        throw new Error(
          `Э-хэтэвчийн шимтгэлийн данс (${ewalletFeeAccountNumber}) идэвхтэй биш байна — POS тохиргооноос шалгана уу`
        );
      const claimedByMethod = new Map<string, number>();
      for (const row of ewalletRows) {
        const input = row.ewalletSettlement!;
        const method = ewalletMethodById.get(input.paymentMethodId);
        if (!method)
          throw new Error(
            `${row.rowNumber}-р мөр: settlement-ийн төлбөрийн хэлбэр олдсонгүй (идэвхтэй ewallet хэлбэр, түр данстай байх ёстой)`
          );
        if (row.settleInvoiceId)
          throw new Error(
            `${row.rowNumber}-р мөр: settlement мөр нэхэмжлэхтэй зэрэг холбогдохгүй`
          );
        if (method.cashAccountId === cashAccount.id)
          throw new Error(`${row.rowNumber}-р мөр: түр данс банкны данстай ижил байж болохгүй`);
        if (cashAccount.currency !== "MNT")
          throw new Error(
            `${row.rowNumber}-р мөр: э-хэтэвчийн settlement зөвхөн MNT банкны дансанд`
          );
        if (row.creditMain !== method.glAccountNumber)
          throw new Error(
            `${row.rowNumber}-р мөрийн харьцах данс «${method.cashAccountName}» түр дансны GL (${method.glAccountNumber}) байх ёстой`
          );
        const openBalance = method.openReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
        const claimed = claimedByMethod.get(method.paymentMethodId) ?? 0;
        const errors = validateEwalletSettlementRow({
          netAmount: row.income,
          grossAmount: Number(input.grossAmount),
          feeAmount: Number(input.feeAmount),
          openBalance: Math.round((openBalance - claimed) * 100) / 100,
        });
        if (errors.length)
          throw new Error(`${row.rowNumber}-р мөр (${method.methodName} settlement): ${errors.join("; ")}`);
        claimedByMethod.set(method.paymentMethodId, claimed + Number(input.grossAmount));
      }
    }

    // ── Мөрийн бүртгэлийн төрөл (docs/dev/arap.md §5l) ────────────────────
    // Урьдчилгаа: харьцах тал = тохиргооны урьдчилгааны данс, харилцагч заавал.
    // Нэхэмжлэх үүсгэх: энэ транзакц дотор батлагдаж, мөр нь түүнийг шууд хаана —
    //   create_ar_invoice: Dr авлага / Cr харьцах тал = орлого [+ Cr НӨАТ гаралт]
    //   create_ap_bill:    Dr харьцах тал = зардал [+ Dr НӨАТ оролт] / Cr өглөг
    type InvoicePlan = {
      documentType: "ar_invoice" | "ap_bill";
      invoiceId: string;
      voucherId: string;
      documentNo: string;
      counterpartyId: string;
      counterpartyName: string;
      controlMain: string;
      /** Орлого (АР) эсвэл зардлын (АП) бүтэн код — мөрийн харьцах тал. */
      counterCode: string;
      /** НӨАТ-ын данс (main): АР гаралт, АП оролт — НӨАТ төлөгч биш бол null. */
      vatMain: string | null;
      net: number;
      vat: number;
      baseNet: number;
      baseVat: number;
    };
    const invoiceByRowId = new Map<string, InvoicePlan>();
    const actionRows = rows.filter((row) => row.rowAction);
    if (actionRows.length) {
      const needsAdvance = actionRows.some(
        (row) => isBankRowAction(row.rowAction) && bankRowActionAdvanceSide(row.rowAction)
      );
      const invoiceTypes = new Set(
        actionRows.map((row) => (isBankRowAction(row.rowAction) ? bankRowActionInvoiceType(row.rowAction) : null))
      );
      // Нэхэмжлэх үүсгэх нь тухайн дэвтрийн батлах эрх шаардана — кассын
      // эрхээр авлага/өглөг тойрч бичигдэхгүй.
      if (invoiceTypes.has("ar_invoice")) await requireModuleAction("ar", "post");
      if (invoiceTypes.has("ap_bill")) await requireModuleAction("ap", "post");
      const needsInvoice = invoiceTypes.has("ar_invoice") || invoiceTypes.has("ap_bill");
      const advanceSettings = needsAdvance ? await loadAdvanceSettings(orgId) : null;
      const vatSettings = needsInvoice ? await loadVatSettings(orgId, userId) : null;
      const defaultControl = needsInvoice
        ? (await loadArApSegmentData(orgId)).defaultAccountNumbers
        : { receivable: "", payable: "" };
      const enabledMains = new Set(
        glAccounts.filter((account) => account.isEnabled).map((account) => account.number)
      );
      const seenActionRowIds = new Set<string>();
      for (const row of actionRows) {
        const label = `${row.rowNumber}-р мөр`;
        if (!isBankRowAction(row.rowAction))
          throw new Error(`${label}: бүртгэлийн төрөл буруу («${String(row.rowAction)}»)`);
        const action: BankRowAction = row.rowAction;
        const actionLabel = BANK_ROW_ACTION_LABELS[action];
        if (typeof row.id !== "string" || !row.id || seenActionRowIds.has(row.id))
          throw new Error(`${label}: дотоод ID дутуу эсвэл давхардсан — файлаа дахин уншуулна уу`);
        seenActionRowIds.add(row.id);
        const direction = bankRowActionDirection(action);
        if ((direction === "income" ? row.income : row.expense) <= 0)
          throw new Error(
            `${label}: «${actionLabel}» нь ${direction === "income" ? "орлогын" : "зарлагын"} мөрөнд л`
          );
        if (row.settleInvoiceId || row.ewalletSettlement)
          throw new Error(`${label}: «${actionLabel}» нэхэмжлэх хаах / settlement-тэй зэрэг байж болохгүй`);
        const master = row.counterpartyId ? counterpartyById.get(row.counterpartyId) : undefined;
        if (!master) throw new Error(`${label}: «${actionLabel}»-д харилцагч заавал сонгоно`);
        const counterMain = row.income > 0 ? row.creditMain : row.debitMain;

        const side = bankRowActionAdvanceSide(action);
        if (side) {
          if (cashAccount.currency !== "MNT")
            throw new Error(`${label}: урьдчилгааг одоогоор зөвхөн MNT дансаар бүртгэнэ`);
          const advanceAccount = advanceAccountFor(advanceSettings!, side);
          if (counterMain !== advanceAccount)
            throw new Error(
              `${label}: «${actionLabel}»-ийн харьцах данс ${advanceAccount} (урьдчилгааны тохиргоо) байх ёстой`
            );
          if (!enabledMains.has(advanceAccount))
            throw new Error(`${label}: урьдчилгааны данс ${advanceAccount} идэвхтэй биш байна`);
          continue;
        }

        // create_ar_invoice / create_ap_bill
        const documentType = bankRowActionInvoiceType(action)!;
        const isSale = documentType === "ar_invoice";
        const directionError = counterpartyDirectionError(documentType, master.counterpartyType, master.name);
        if (directionError) throw new Error(`${label}: ${directionError}`);
        // Харилцагчийн картад данс бүтэн сегмент кодоор (000.000000.31000001.00.0000)
        // хадгалагддаг — үндсэн дансаар нь харьцуулна.
        const controlMain = extractMainAccount(
          (
            (isSale ? master.defaultReceivableAccountNumber : master.defaultPayableAccountNumber) ||
            (isSale ? defaultControl.receivable : defaultControl.payable) ||
            ""
          ).trim()
        );
        if (!controlMain || !enabledMains.has(controlMain))
          throw new Error(
            `${label}: ${master.name}-ийн ${isSale ? "авлагын" : "өглөгийн"} хяналтын данс тохируулаагүй эсвэл идэвхгүй — харилцагчийн картаас шалгана уу`
          );
        if (counterMain === controlMain || counterMain === cashAccount.glAccountNumber)
          throw new Error(
            isSale
              ? `${label}: «${actionLabel}»-ийн CR тал орлогын данс байх ёстой (авлага / банк биш)`
              : `${label}: «${actionLabel}»-ийн DR тал зардлын данс байх ёстой (өглөг / банк биш)`
          );
        let net = row.amount;
        let vat = 0;
        let vatMain: string | null = null;
        if (vatSettings?.isVatPayer) {
          const rate = Number(vatSettings.vatRatePercent);
          if (!(rate > 0)) throw new Error("НӨАТ-ийн хувь тохируулаагүй байна");
          const configured = isSale ? vatSettings.outputVatAccountNumber : vatSettings.inputVatAccountNumber;
          if (!configured || !enabledMains.has(configured))
            throw new Error(
              `НӨАТ ${isSale ? "гаралтын" : "оролтын"} данс ${configured ?? "(тохируулаагүй)"} идэвхтэй биш байна — НӨАТ-ийн тохиргоог шалгана уу`
            );
          ({ net, vat } = splitInclusiveVat(row.amount, rate));
          vatMain = configured;
        }
        const baseVat = vat > 0 ? Math.round(vat * row.exchangeRate * 100) / 100 : 0;
        invoiceByRowId.set(row.id, {
          documentType,
          invoiceId: randomUUID(),
          voucherId: randomUUID(),
          documentNo: `${documentNoPrefix(documentType)}-${row.transactionDate.replaceAll("-", "")}-${randomUUID().slice(0, 6).toUpperCase()}`,
          counterpartyId: master.id,
          counterpartyName: master.name,
          controlMain,
          counterCode: isSale ? row.creditAccountNumber : row.debitAccountNumber,
          vatMain,
          net,
          vat,
          baseNet: Math.round((row.baseAmount - baseVat) * 100) / 100,
          baseVat,
        });
      }
    }

    // Ханшийн зөрүүтэй settlement байвал олз/гарзын данс шаардлагатай —
    // тохиргооноос уншиж (postCashDocument-тэй ижил эх сурвалж), идэвхтэй
    // эсэхийг урьдчилан шалгана.
    const needsFxGain = settleRows.some((row) => {
      const effect = settleEffectByRowId.get(row.id);
      if (!effect || Math.abs(effect.difference) <= 0.01) return false;
      const invoice = invoiceById.get(row.settleInvoiceId as string)!;
      return settlementCashType(invoice.documentType) === "receipt"
        ? effect.difference > 0
        : effect.difference < 0;
    });
    const needsFxLoss = settleRows.some((row) => {
      const effect = settleEffectByRowId.get(row.id);
      if (!effect || Math.abs(effect.difference) <= 0.01) return false;
      const invoice = invoiceById.get(row.settleInvoiceId as string)!;
      return settlementCashType(invoice.documentType) === "receipt"
        ? effect.difference < 0
        : effect.difference > 0;
    });
    // Дансны дугаар зөвхөн тохиргооноос — код дотор fallback байхгүй.
    let fxAccounts: { gain: string; loss: string } | null = null;
    if (needsFxGain || needsFxLoss) {
      const costingSettings = await loadCostingAccountSettings(orgId);
      fxAccounts = {
        gain: costingSettings.fxGainAccountNumber,
        loss: costingSettings.fxLossAccountNumber,
      };
      for (const main of [
        ...(needsFxGain ? [fxAccounts.gain] : []),
        ...(needsFxLoss ? [fxAccounts.loss] : []),
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
    // FX мөрийн бүтэн сегмент код — cashPostingCodeBuilder-тэй НЭГ цөм
    // (lib/gl/posting-code.ts); cash-flow код мөр бүрд өөр байж болох тул
    // builder-ийг код тус бүрд нэг л удаа бүтээж кэшилнэ.
    const fxBuilderByFlow = new Map<string, (main: string) => string>();
    const fxCodeBuilder = (cashFlowCode: string | null) => {
      const key = cashFlowCode ?? "";
      let builder = fxBuilderByFlow.get(key);
      if (!builder) {
        builder = postingCodeBuilderFromData({
          configs,
          values,
          moduleTag: "CA",
          cashFlowCode,
        });
        fxBuilderByFlow.set(key, builder);
      }
      return builder;
    };

    if (ewalletRows.length) ewalletFeeCode = fxCodeBuilder(null)(ewalletFeeAccountNumber);

    const totalIncome = rows.reduce((sum, row) => sum + row.income, 0);
    const totalExpense = rows.reduce((sum, row) => sum + row.expense, 0);

    const statementId = await db.transaction(async (tx) => {
      // Сар хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт (сар бүрд нэг).
      const monthDates = new Map<string, string>();
      for (const row of rows) monthDates.set(row.transactionDate.slice(0, 7), row.transactionDate);
      for (const date of monthDates.values()) await assertPeriodOpenInTx(tx, orgId, date);
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

      // Хуулгаас үүсэх нэхэмжлэх (create_ar_invoice / create_ap_bill) — кассын
      // баримт, settlement-ийн FK-ээс ӨМНӨ. Батлагдсан, энэ мөрөөр тэр даруй
      // бүтэн төлөгдсөн:
      //   АР: Dr авлага / Cr орлого (+ Cr НӨАТ гаралт); мөр нь Dr банк / Cr авлага
      //   АП: Dr зардал (+ Dr НӨАТ оролт) / Cr өглөг; мөр нь Dr өглөг / Cr банк
      for (const row of rows) {
        const plan = invoiceByRowId.get(row.id);
        if (!plan) continue;
        const isSale = plan.documentType === "ar_invoice";
        const planCode = fxCodeBuilder(null);
        const description = row.description || `${plan.counterpartyName} — банкны гүйлгээ`;
        await tx.insert(journalVouchers).values({
          id: plan.voucherId,
          userId,
          organizationId: orgId,
          date: row.transactionDate,
          description: `${isSale ? "Борлуулалтын нэхэмжлэх" : "Өглөгийн нэхэмжлэх"} (банкны хуулга): ${description}`,
          documentNo: await nextVoucherNo(tx, orgId, isSale ? "ar" : "ap", row.transactionDate),
          status: "posted",
        });
        const vatCode = plan.vatMain ? planCode(plan.vatMain) : null;
        // Орлого/зардал ба НӨАТ нэг талд, хяналтын данс нөгөө талд.
        const side = (amount: number) =>
          isSale
            ? { debit: "0", credit: String(amount) }
            : { debit: String(amount), credit: "0" };
        const controlSide = isSale
          ? { debit: String(row.baseAmount), credit: "0" }
          : { debit: "0", credit: String(row.baseAmount) };
        await tx.insert(journalLines).values([
          {
            voucherId: plan.voucherId,
            accountNumber: plan.counterCode,
            ...side(plan.baseNet),
            description,
            sortOrder: 0,
          },
          ...(vatCode
            ? [
                {
                  voucherId: plan.voucherId,
                  accountNumber: vatCode,
                  ...side(plan.baseVat),
                  description: `НӨАТ — ${description}`,
                  sortOrder: 1,
                },
              ]
            : []),
          {
            voucherId: plan.voucherId,
            accountNumber: planCode(plan.controlMain),
            ...controlSide,
            description,
            sortOrder: 2,
          },
        ]);
        await tx.insert(arApDocuments).values({
          id: plan.invoiceId,
          userId,
          organizationId: orgId,
          documentNo: plan.documentNo,
          documentType: plan.documentType,
          counterpartyId: plan.counterpartyId,
          date: row.transactionDate,
          dueDate: row.transactionDate,
          currency: cashAccount.currency,
          exchangeRate: String(row.exchangeRate),
          controlAccountNumber: plan.controlMain,
          description,
          totalAmount: String(row.amount),
          paidAmount: String(row.amount),
          baseTotalAmount: String(row.baseAmount),
          basePaidAmount: String(row.baseAmount),
          status: "paid",
          voucherId: plan.voucherId,
          postedAt: new Date(),
        });
        await tx.insert(arApDocumentLines).values([
          {
            documentId: plan.invoiceId,
            accountNumber: plan.counterCode,
            description,
            amount: String(plan.net),
            sortOrder: 0,
          },
          ...(vatCode
            ? [
                {
                  documentId: plan.invoiceId,
                  accountNumber: vatCode,
                  description: "НӨАТ",
                  amount: String(plan.vat),
                  sortOrder: 1,
                },
              ]
            : []),
        ]);
        await logAuditEvent(
          {
            userId,
            organizationId: orgId,
            action: "create_posted",
            entityType: "arap",
            entityId: plan.invoiceId,
            summary: `${isSale ? "Борлуулалтын нэхэмжлэх" : "Өглөгийн нэхэмжлэх"} банкны хуулгаас бичигдэж ${isSale ? "хаагдав" : "төлөгдөв"} — ${plan.documentNo}, ${row.transactionDate}, ${plan.counterpartyName}, дүн ${row.amount.toLocaleString("en-US")} ${cashAccount.currency}${plan.vat ? ` (НӨАТ ${plan.vat.toLocaleString("en-US")})` : ""}`,
          },
          tx
        );
      }

      const postingRows = rows.map((row) => ({
        ...row,
        voucherId: randomUUID(),
        cashDocumentId: randomUUID(),
      }));

      // Дугааруудыг НЭГ багцаар нөөцөлнө — мөр бүрд тусдаа хүсэлт явуулбал
      // олон зуун мөртэй хуулга удаашрана (nextVoucherNos огноогоор бүлэглэнэ).
      const voucherNos = await nextVoucherNos(
        tx,
        orgId,
        "cash",
        postingRows.map((row) => row.transactionDate)
      );

      for (const group of chunks(
        postingRows.map((row, index) => ({
          ...row,
          documentNo: voucherNos[index],
        }))
      )) {
        await tx.insert(journalVouchers).values(
          group.map((row) => ({
            id: row.voucherId,
            userId,
            organizationId: orgId,
            date: row.transactionDate,
            description: `[BANK ${statement.id.slice(0, 8)}-${row.rowNumber}] ${
              row.description || row.counterparty || "Банкны гүйлгээ"
            }`,
            documentNo: row.documentNo,
            status: "posted",
          }))
        );
      }

      const allJournalLines = postingRows.flatMap((row) => {
        const lineDescription = row.description || row.counterparty;
        const plan = invoiceByRowId.get(row.id);
        if (plan) {
          // Шинэ нэхэмжлэхийг ижил ханшаар тэр даруй хаана — ханшийн зөрүүгүй.
          const buildCode = fxCodeBuilder(
            row.debitAccountNumber.split(".")[7] || row.creditAccountNumber.split(".")[7] || null
          );
          return buildSettlementPostingLines({
            voucherId: row.voucherId,
            documentType: plan.documentType,
            cashAccountId: cashAccount.id,
            cashAccountNumber: row.income > 0 ? row.debitAccountNumber : row.creditAccountNumber,
            controlAccountNumber: buildCode(plan.controlMain),
            baseAmount: row.baseAmount,
            historicalBaseAmount: row.baseAmount,
            fxDifference: 0,
            fxGainAccountNumber: "",
            fxLossAccountNumber: "",
            buildCode,
            description: lineDescription,
          });
        }
        const effect = row.settleInvoiceId
          ? settleEffectByRowId.get(row.id)
          : undefined;
        if (effect) {
          // Settlement мөр — postCashDocument-той НЭГ мөр-бүтээгчээр
          // (хяналтын данс түүхэн ханшаар, зөрүү = ханшийн олз/гарз).
          const invoice = invoiceById.get(row.settleInvoiceId as string)!;
          if (Math.abs(effect.difference) > 0.01 && !fxAccounts)
            throw new Error("Ханшийн олз/гарзын данс ачаалагдсангүй");
          return buildSettlementPostingLines({
            voucherId: row.voucherId,
            documentType: invoice.documentType,
            cashAccountId: cashAccount.id,
            cashAccountNumber:
              row.income > 0 ? row.debitAccountNumber : row.creditAccountNumber,
            controlAccountNumber:
              row.income > 0 ? row.creditAccountNumber : row.debitAccountNumber,
            baseAmount: row.baseAmount,
            historicalBaseAmount: effect.historicalBaseAmount,
            fxDifference: effect.difference,
            fxGainAccountNumber: fxAccounts?.gain ?? "",
            fxLossAccountNumber: fxAccounts?.loss ?? "",
            buildCode: fxCodeBuilder(
              row.debitAccountNumber.split(".")[7] ||
                row.creditAccountNumber.split(".")[7] ||
                null
            ),
            description: lineDescription,
          });
        }
        // Settlement мөр = шилжүүлэг: хоёр тал хоёулаа кассын данстай
        // (postCashDocument-ийн transfer-тэй ижил) — касс модуль хоёр дансыг
        // тулгана.
        const ewalletMethod = row.ewalletSettlement
          ? ewalletMethodById.get(row.ewalletSettlement.paymentMethodId)
          : undefined;
        return [
          {
            voucherId: row.voucherId,
            accountNumber: row.debitAccountNumber,
            cashAccountId: row.income > 0 ? cashAccount.id : null,
            debit: String(row.baseAmount),
            credit: "0",
            description: lineDescription,
            sortOrder: 0,
          },
          {
            voucherId: row.voucherId,
            accountNumber: row.creditAccountNumber,
            cashAccountId:
              row.expense > 0 ? cashAccount.id : ewalletMethod ? ewalletMethod.cashAccountId : null,
            debit: "0",
            credit: String(row.baseAmount),
            description: lineDescription,
            sortOrder: 1,
          },
        ];
      });
      for (const group of chunks(allJournalLines))
        await tx.insert(journalLines).values(group);

      for (const group of chunks(postingRows)) {
        await tx.insert(cashDocuments).values(
          group.map((row) => {
            const ewalletMethod = row.ewalletSettlement
              ? ewalletMethodById.get(row.ewalletSettlement.paymentMethodId)
              : undefined;
            const plan = invoiceByRowId.get(row.id);
            return {
            id: row.cashDocumentId,
            userId,
            organizationId: orgId,
            documentNo: `BS-${statement.id.slice(0, 8).toUpperCase()}-${
              row.rowNumber
            }`,
            // Settlement мөр — түр данс → банк ШИЛЖҮҮЛЭГ (харилцагч, харьцах данс байхгүй).
            documentType: ewalletMethod ? "transfer" : row.income > 0 ? "receipt" : "payment",
            date: row.transactionDate,
            fromCashAccountId: ewalletMethod
              ? ewalletMethod.cashAccountId
              : row.expense > 0
                ? cashAccount.id
                : null,
            toCashAccountId: row.income > 0 ? cashAccount.id : null,
            counterAccountNumber: ewalletMethod
              ? null
              : plan
                ? plan.controlMain
                : row.income > 0
                  ? row.creditMain
                  : row.debitMain,
            cashFlowCode:
              row.debitAccountNumber.split(".")[7] ||
              row.creditAccountNumber.split(".")[7] ||
              null,
            ...(ewalletMethod
              ? { counterpartyId: null, counterparty: null }
              : counterpartyLinkFor(row)),
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
            arApDocumentId: row.settleInvoiceId || plan?.invoiceId || null,
            postedAt: new Date(),
            };
          })
        );
      }

      // Settlement-ийн ШИМТГЭЛ — түр данснаас зарлага (Dr шимтгэлийн зардал /
      // Cr түр данс) тусдаа баримт + журнал; 0 шимтгэлтэй мөрд үүсэхгүй.
      const feeRows = postingRows
        .filter((row) => row.ewalletSettlement && Number(row.ewalletSettlement.feeAmount) > 0)
        .map((row) => ({
          row,
          method: ewalletMethodById.get(row.ewalletSettlement!.paymentMethodId)!,
          fee: Math.round(Number(row.ewalletSettlement!.feeAmount) * 100) / 100,
          voucherId: randomUUID(),
          cashDocumentId: randomUUID(),
        }));
      if (feeRows.length) {
        const feeVoucherNos = await nextVoucherNos(
          tx,
          orgId,
          "cash",
          feeRows.map((entry) => entry.row.transactionDate)
        );
        await tx.insert(journalVouchers).values(
          feeRows.map((entry, index) => ({
            id: entry.voucherId,
            userId,
            organizationId: orgId,
            date: entry.row.transactionDate,
            description: `[BANK ${statement.id.slice(0, 8)}-${entry.row.rowNumber}] ${entry.method.methodName} settlement шимтгэл`,
            documentNo: feeVoucherNos[index],
            status: "posted",
          }))
        );
        await tx.insert(journalLines).values(
          feeRows.flatMap((entry) => [
            {
              voucherId: entry.voucherId,
              accountNumber: ewalletFeeCode,
              cashAccountId: null,
              debit: String(entry.fee),
              credit: "0",
              description: `${entry.method.methodName} шимтгэл`,
              sortOrder: 0,
            },
            {
              voucherId: entry.voucherId,
              accountNumber: entry.row.creditAccountNumber,
              cashAccountId: entry.method.cashAccountId,
              debit: "0",
              credit: String(entry.fee),
              description: `${entry.method.methodName} шимтгэл`,
              sortOrder: 1,
            },
          ])
        );
        await tx.insert(cashDocuments).values(
          feeRows.map((entry) => ({
            id: entry.cashDocumentId,
            userId,
            organizationId: orgId,
            documentNo: `BS-${statement.id.slice(0, 8).toUpperCase()}-${entry.row.rowNumber}-F`,
            documentType: "payment",
            date: entry.row.transactionDate,
            fromCashAccountId: entry.method.cashAccountId,
            toCashAccountId: null,
            counterAccountNumber: ewalletFeeAccountNumber,
            cashFlowCode: null,
            counterpartyId: null,
            counterparty: null,
            description: `${entry.method.methodName} settlement шимтгэл — ${entry.row.description || "банкны гүйлгээ"}`,
            amount: String(entry.fee),
            currency: cashAccount.currency,
            exchangeRate: "1",
            baseAmount: String(entry.fee),
            status: "posted",
            voucherId: entry.voucherId,
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
        .filter((row) => row.settleInvoiceId || invoiceByRowId.has(row.id))
        .map((row) => ({
          userId,
          organizationId: orgId,
          documentId: (row.settleInvoiceId || invoiceByRowId.get(row.id)?.invoiceId) as string,
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
      const createdSales = [...invoiceByRowId.values()].filter(
        (plan) => plan.documentType === "ar_invoice"
      ).length;
      const createdBills = invoiceByRowId.size - createdSales;
      await logAuditEvent(
        {
          userId,
          organizationId: orgId,
          action: "import",
          entityType: "cash",
          entityId: statement.id,
          summary: `Банкны хуулга импортлогдов — ${payload.fileName.slice(0, 80)}, ${rows.length} мөр, орлого ${totalIncome.toLocaleString("en-US")}, зарлага ${totalExpense.toLocaleString("en-US")}${settleRows.length ? `, ${settleRows.length} мөр нэхэмжлэхтэй холбогдов` : ""}${ewalletRows.length ? `, ${ewalletRows.length} э-хэтэвчийн settlement (шилжүүлэг + шимтгэл)` : ""}${createdSales ? `, ${createdSales} борлуулалтын нэхэмжлэх үүсэж хаагдав` : ""}${createdBills ? `, ${createdBills} өглөгийн нэхэмжлэх үүсэж хаагдав` : ""}${actionRows.length - invoiceByRowId.size > 0 ? `, ${actionRows.length - invoiceByRowId.size} урьдчилгаа` : ""}`,
        },
        tx
      );

      const persistedLines = postingRows.map((row) => ({
        statementId: statement.id,
        rowNumber: row.rowNumber,
        transactionDate: row.transactionDate,
        description: row.description || "Банкны гүйлгээ",
        counterparty: row.counterparty || null,
        counterAccount: row.counterAccount || null,
        income: String(row.income),
        expense: String(row.expense),
        exchangeRate: String(row.exchangeRate),
        baseAmount: String(row.baseAmount),
        debitAccountNumber: row.debitAccountNumber,
        creditAccountNumber: row.creditAccountNumber,
        rawData: JSON.stringify(row.rawData),
        externalRef: row.externalRef || null,
        cashDocumentId: row.cashDocumentId,
        voucherId: row.voucherId,
      }));
      for (const group of chunks(persistedLines))
        await tx.insert(bankStatementLines).values(group);

      return statement.id;
    });

    // Хуулгаас үүссэн борлуулалтын нэхэмжлэх нь гараар батлагдсантай ИЖИЛ
    // eBarimt-д явна (commit-ийн ДАРАА, тохиргоо унтраалттай бол юу ч хийхгүй,
    // ШИДЭХГҮЙ); төлөлтийн баримтыг settlement-ийн сканнер авна.
    for (const plan of invoiceByRowId.values())
      if (plan.documentType === "ar_invoice") await enqueueArapInvoiceEbarimt(orgId, plan.invoiceId);

    revalidatePath("/cash");
    revalidatePath("/cash/accounts");
    revalidatePath("/cash/transactions");
    revalidatePath("/cash/statements");
    revalidatePath("/gl/journal");
    revalidatePath("/gl/reports");
    // Settlement нэхэмжлэхийн үлдэгдлийг өөрчилдөг.
    revalidatePath("/receivables/documents");
    revalidatePath("/payables/documents");
    return { id: statementId, rowCount: rows.length };
}

import { and, desc, eq, inArray, lte } from "drizzle-orm";

import {
  CashReconciliationWorkspace,
  type CashFxHistoryRow,
  type CashReconciliationRow,
} from "@/components/cash/cash-reconciliation-workspace";
import { getActiveOrg } from "@/lib/auth";
import { computeCashCoreRows, glMainNumber } from "@/lib/cash/reconciliation";
import { db } from "@/lib/db";
import {
  bankStatements,
  cashAccounts,
  cashDocuments,
  cashFxRevaluations,
  chartOfAccounts,
  journalVouchers,
} from "@/lib/db/schema";

type SearchParams = Promise<{ asOf?: string }>;

function todayInUlaanbaatar() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export default async function CashReconciliationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const params = await searchParams;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(params.asOf ?? "")
    ? params.asOf!
    : todayInUlaanbaatar();

  const [
    accounts,
    documents,
    vouchers,
    statements,
    fxRevaluations,
    glAccounts,
  ] =
    await Promise.all([
      db.query.cashAccounts.findMany({
        where: eq(cashAccounts.organizationId, orgId),
        orderBy: (account, { asc }) => [asc(account.name)],
      }),
      db.query.cashDocuments.findMany({
        where: and(
          eq(cashDocuments.organizationId, orgId),
          lte(cashDocuments.date, asOf)
        ),
      }),
      db.query.journalVouchers.findMany({
        where: and(
          eq(journalVouchers.organizationId, orgId),
          lte(journalVouchers.date, asOf),
          inArray(journalVouchers.status, ["posted", "reversed"])
        ),
        with: { lines: true },
      }),
      db.query.bankStatements.findMany({
        where: eq(bankStatements.organizationId, orgId),
        with: { lines: true },
      }),
      db.query.cashFxRevaluations.findMany({
        where: and(
          eq(cashFxRevaluations.organizationId, orgId),
          lte(cashFxRevaluations.valuationDate, asOf)
        ),
        with: { cashAccount: true },
        orderBy: [
          desc(cashFxRevaluations.valuationDate),
          desc(cashFxRevaluations.createdAt),
        ],
      }),
      db.query.chartOfAccounts.findMany({
        where: and(
          eq(chartOfAccounts.organizationId, orgId),
          eq(chartOfAccounts.isEnabled, true)
        ),
        orderBy: (account, { asc }) => [asc(account.number)],
      }),
    ]);

  // Данс бүрийн үлдэгдэл/зөрүү/статус — хяналтын самбартай ХАМТЫН цөм.
  const coreRows = computeCashCoreRows({
    accounts,
    documents,
    vouchers,
    statements,
    fxRevaluations,
    asOf,
  });

  // Данс бүрийн НООРОГ баримтууд — зөрүүний оношилгоонд:
  //   - GL-ээс үүссэн (sourceVoucherId-тэй) ноорог: журнал нь GL-д аль
  //     хэдийн бичигдсэн ч кассын бүртгэлд ороогүй → Бүртгэл−GL зөрүү үүсгэнэ
  //   - Энгийн ноорог: аль талд ч тоологдоогүй — зөрүүнд нөлөөгүй ч
  //     батлагдаагүй орхигдсоныг сануулна
  const pendingDraftsByAccount = new Map<
    string,
    CashReconciliationRow["pendingDrafts"]
  >();
  for (const doc of documents) {
    if (doc.status !== "draft") continue;
    const entry = {
      id: doc.id,
      documentNo: doc.documentNo,
      date: doc.date,
      documentType: doc.documentType,
      baseAmount: Number(doc.baseAmount ?? doc.amount),
      fromGl: !!doc.sourceVoucherId,
      rateUnknown: Number(doc.exchangeRate ?? 1) === 0,
    };
    for (const accountId of [doc.fromCashAccountId, doc.toCashAccountId]) {
      if (!accountId) continue;
      const list = pendingDraftsByAccount.get(accountId) ?? [];
      list.push({
        ...entry,
        // Энэ дансны бүртгэлд батлагдвал орох чиглэл.
        effect: doc.toCashAccountId === accountId ? entry.baseAmount : -entry.baseAmount,
      });
      pendingDraftsByAccount.set(accountId, list);
    }
  }

  // ── Тоон дээр дарахад гарах ЗАДАРГАА — данс бүрийн гурван эх сурвалж ──────
  //   cash: нээлт + батлагдсан баримт бүрийн чиглэлтэй дүн (дансны валютаар)
  //   gl:   энэ дансны GL дугаарт нөлөөлсөн журнал бүрийн цэвэр дүн (MNT)
  //   bank: хуулга бүрийн asOf-оос өмнөх сүүлийн үлдэгдэл мөр
  const cashDetailByAccount = new Map<
    string,
    CashReconciliationRow["details"]["cash"]
  >();
  for (const doc of documents) {
    if (doc.status !== "posted") continue;
    for (const accountId of [doc.fromCashAccountId, doc.toCashAccountId]) {
      if (!accountId) continue;
      const list = cashDetailByAccount.get(accountId) ?? [];
      list.push({
        id: doc.id,
        date: doc.date,
        label: `${doc.documentNo} · ${doc.description}`,
        amount:
          doc.toCashAccountId === accountId
            ? Number(doc.amount)
            : -Number(doc.amount),
      });
      cashDetailByAccount.set(accountId, list);
    }
  }

  const glDetailByMain = new Map<
    string,
    CashReconciliationRow["details"]["gl"]
  >();
  for (const voucher of vouchers) {
    // Задаргаанд ч эх + буцаалт хоёул харагдана — нэт 0 гэдгийг нүдээр
    // харах боломжтой (дээрх glByMain-тай ижил дүрэм).
    const byMain = new Map<string, number>();
    for (const line of voucher.lines) {
      const main = glMainNumber(line.accountNumber);
      byMain.set(main, (byMain.get(main) ?? 0) + Number(line.debit) - Number(line.credit));
    }
    for (const [main, effect] of byMain) {
      if (Math.abs(effect) < 0.005) continue;
      const list = glDetailByMain.get(main) ?? [];
      list.push({
        id: voucher.id,
        date: voucher.date,
        label: voucher.description,
        amount: Math.round(effect * 100) / 100,
      });
      glDetailByMain.set(main, list);
    }
  }

  const bankDetailByAccount = new Map<
    string,
    CashReconciliationRow["details"]["bank"]
  >();
  for (const statement of statements) {
    let latest: { date: string; rowNumber: number; balance: number } | null = null;
    for (const line of statement.lines) {
      if (line.transactionDate > asOf || line.balance == null) continue;
      if (
        !latest ||
        line.transactionDate > latest.date ||
        (line.transactionDate === latest.date && line.rowNumber > latest.rowNumber)
      )
        latest = {
          date: line.transactionDate,
          rowNumber: line.rowNumber,
          balance: Number(line.balance),
        };
    }
    if (!latest) continue;
    const list = bankDetailByAccount.get(statement.cashAccountId) ?? [];
    list.push({
      id: statement.id,
      date: latest.date,
      label: `${statement.fileName}${statement.periodEnd ? ` · ${statement.periodStart ?? ""}–${statement.periodEnd}` : ""}`,
      amount: latest.balance,
    });
    bankDetailByAccount.set(statement.cashAccountId, list);
  }

  const byDateDesc = (a: { date: string }, b: { date: string }) =>
    b.date.localeCompare(a.date);

  const rows: CashReconciliationRow[] = accounts.map((account) => {
    const core = coreRows.get(account.id)!;
    const rateRow = core.rateRow;

    return {
      id: account.id,
      isActive: account.isActive,
      accountName: account.name,
      accountType: account.accountType,
      currency: account.currency,
      glAccountNumber: account.glAccountNumber,
      cashBalance: core.cashBalance,
      bankBalance: core.bankBalance,
      bankBalanceDate: core.bankBalanceDate,
      closingRate: core.closingRate,
      rateSource: rateRow?.rateSource ?? null,
      rateBasis: rateRow?.rateBasis ?? null,
      sourceDate: rateRow?.sourceDate ?? null,
      sourceUrl: rateRow?.sourceUrl ?? null,
      fetchedAt: rateRow?.fetchedAt?.toISOString() ?? null,
      cashBalanceMnt: core.cashBalanceMnt,
      glBalance: core.glBalance,
      bankToCashDifference: core.bankToCashDifference,
      cashToGlDifference: core.cashToGlDifference,
      openingBalance: Number(account.openingBalance ?? 0),
      pendingDrafts: pendingDraftsByAccount.get(account.id) ?? [],
      details: {
        cash: [
          // Нээлтийн үлдэгдэл — баримтгүй тул тусдаа мөр.
          ...(Math.abs(Number(account.openingBalance ?? 0)) > 0.005
            ? [
                {
                  id: `opening-${account.id}`,
                  date: "",
                  label: "Нээлтийн үлдэгдэл",
                  amount: Number(account.openingBalance ?? 0),
                },
              ]
            : []),
          ...(cashDetailByAccount.get(account.id) ?? []).sort(byDateDesc),
        ],
        gl: (glDetailByMain.get(account.glAccountNumber) ?? []).sort(byDateDesc),
        bank: (bankDetailByAccount.get(account.id) ?? []).sort(byDateDesc),
      },
      status: core.status,
    };
  });

  const history: CashFxHistoryRow[] = fxRevaluations.map((item) => ({
    id: item.id,
    cashAccountId: item.cashAccountId,
    revision: item.revision,
    valuationDate: item.valuationDate,
    accountName: item.cashAccount.name,
    currency: item.currency,
    closingRate: Number(item.closingRate),
    rateSource: item.rateSource,
    rateBasis: item.rateBasis,
    sourceDate: item.sourceDate,
    foreignBalance: Number(item.foreignBalance),
    carryingAmount: Number(item.carryingAmount),
    revaluedAmount: Number(item.revaluedAmount),
    adjustmentAmount: Number(item.adjustmentAmount),
    gainLossAccountNumber: item.gainLossAccountNumber,
    voucherId: item.voucherId,
    status: item.status,
  }));

  return (
    <CashReconciliationWorkspace
      key={`${asOf}:${history[0]?.id ?? "none"}`}
      asOf={asOf}
      rows={rows}
      history={history}
      fxAccountOptions={glAccounts.map((account) => ({
        number: account.number,
        name: account.name,
      }))}
    />
  );
}

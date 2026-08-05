import { and, desc, eq, inArray, lte } from "drizzle-orm";

import {
  CashReconciliationWorkspace,
  type CashFxHistoryRow,
  type CashReconciliationRow,
} from "@/components/cash/cash-reconciliation-workspace";
import { auth } from "@/lib/auth";
import { calculateCashBalances } from "@/lib/cash/balances";
import { reconciliationStatus } from "@/lib/cash/reconciliation";
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
  const session = await auth();
  const userId = session!.user!.id!;
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
        where: eq(cashAccounts.userId, userId),
        orderBy: (account, { asc }) => [asc(account.name)],
      }),
      db.query.cashDocuments.findMany({
        where: and(
          eq(cashDocuments.userId, userId),
          lte(cashDocuments.date, asOf)
        ),
      }),
      db.query.journalVouchers.findMany({
        where: and(
          eq(journalVouchers.userId, userId),
          lte(journalVouchers.date, asOf),
          inArray(journalVouchers.status, ["posted", "reversed"])
        ),
        with: { lines: true },
      }),
      db.query.bankStatements.findMany({
        where: eq(bankStatements.userId, userId),
        with: { lines: true },
      }),
      db.query.cashFxRevaluations.findMany({
        where: and(
          eq(cashFxRevaluations.userId, userId),
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
          eq(chartOfAccounts.userId, userId),
          eq(chartOfAccounts.isEnabled, true)
        ),
        orderBy: (account, { asc }) => [asc(account.number)],
      }),
    ]);

  const cashBalanceMap = calculateCashBalances(accounts, documents);
  // GL үлдэгдлийг ДАНСНЫ ДУГААРААР тоолно (cashAccountId холбоосоор БИШ) —
  // гараар/AI-гаар бичсэн журнал холбоосгүй байдаг тул холбоосоор тоолбол
  // тэдгээр нь GL талд "алга болж" хий зөрүү үзүүлдэг байсан. Дугаараар
  // тоолсноор энэ хуудас reconcile_modules tool-той ИЖИЛ үнэнийг харуулна.
  const glByMain = new Map<string, number>();
  for (const voucher of vouchers) {
    // "reversed" журнал GL-д тооцогдсон хэвээр байдаг (GL тайлантай ижил):
    // эх бичилт + posted буцаалт нь хоорондоо нэт 0 болдог. Reversed-ийг
    // алгасвал буцаалт нь дан ганцаараа орж, буцаасан гүйлгээ бүр хий
    // зөрүү үүсгэдэг байсан.
    for (const line of voucher.lines) {
      const parts = line.accountNumber.split(".");
      const main = parts.length === 10 ? parts[2] : line.accountNumber;
      glByMain.set(
        main,
        (glByMain.get(main) ?? 0) + Number(line.debit) - Number(line.credit)
      );
    }
  }
  const glBalanceMap = new Map<string, number>(
    accounts.map((account) => [
      account.id,
      Math.round((glByMain.get(account.glAccountNumber) ?? 0) * 100) / 100,
    ])
  );

  const latestBankBalance = new Map<
    string,
    { date: string; evidenceDate: string; rowNumber: number; balance: number }
  >();
  for (const statement of statements) {
    for (const line of statement.lines) {
      if (line.transactionDate > asOf || line.balance == null) continue;
      const current = latestBankBalance.get(statement.cashAccountId);
      if (
        !current ||
        line.transactionDate > current.date ||
        (line.transactionDate === current.date &&
          line.rowNumber > current.rowNumber)
      ) {
        latestBankBalance.set(statement.cashAccountId, {
          date: line.transactionDate,
          evidenceDate:
            statement.periodEnd && statement.periodEnd <= asOf
              ? statement.periodEnd
              : line.transactionDate,
          rowNumber: line.rowNumber,
          balance: Number(line.balance),
        });
      }
    }
  }

  const latestFxRate = new Map<string, (typeof fxRevaluations)[number]>();
  for (const revaluation of fxRevaluations) {
    if (revaluation.status !== "posted") continue;
    if (!latestFxRate.has(revaluation.cashAccountId))
      latestFxRate.set(revaluation.cashAccountId, revaluation);
  }

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
      const parts = line.accountNumber.split(".");
      const main = parts.length === 10 ? parts[2] : line.accountNumber;
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
    const cashBalance = cashBalanceMap.get(account.id) ?? 0;
    const glBalance = glBalanceMap.get(account.id) ?? 0;
    const statementBalance = latestBankBalance.get(account.id);
    const rateRow = latestFxRate.get(account.id);
    const closingRate =
      account.currency === "MNT"
        ? 1
        : rateRow
          ? Number(rateRow.closingRate)
          : null;
    // 0 үлдэгдэлтэй валютын дансанд ханш хамаагүй (0 × ямар ч ханш = 0) —
    // "Ханш дутуу" гэж дэмий сануулахгүй.
    const cashBalanceMnt =
      cashBalance === 0
        ? 0
        : closingRate == null
          ? null
          : Math.round(cashBalance * closingRate * 100) / 100;
    const cashToGlDifference =
      cashBalanceMnt == null
        ? null
        : Math.round((cashBalanceMnt - glBalance) * 100) / 100;
    const bankToCashDifference =
      statementBalance == null
        ? null
        : Math.round((statementBalance.balance - cashBalance) * 100) / 100;

    return {
      id: account.id,
      isActive: account.isActive,
      accountName: account.name,
      accountType: account.accountType,
      currency: account.currency,
      glAccountNumber: account.glAccountNumber,
      cashBalance,
      bankBalance: statementBalance?.balance ?? null,
      bankBalanceDate: statementBalance?.evidenceDate ?? null,
      closingRate,
      rateSource: rateRow?.rateSource ?? null,
      rateBasis: rateRow?.rateBasis ?? null,
      sourceDate: rateRow?.sourceDate ?? null,
      sourceUrl: rateRow?.sourceUrl ?? null,
      fetchedAt: rateRow?.fetchedAt?.toISOString() ?? null,
      cashBalanceMnt,
      glBalance,
      bankToCashDifference,
      cashToGlDifference,
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
      status:
        // Юу ч хөдлөөгүй хоосон данс — тулгах зүйл алга, "тэнцсэн" гэж үзнэ
        // (0 үлдэгдэлтэй валютын данс "Ханш дутуу"/"Хуулгагүй" гэж дэмий
        // сануулахгүй).
        cashBalance === 0 && Math.abs(glBalance) <= 0.01 && statementBalance == null
          ? ("balanced" as const)
          : reconciliationStatus(
              cashToGlDifference,
              bankToCashDifference,
              account.currency === "MNT" ||
                closingRate != null ||
                cashBalance === 0,
              statementBalance == null || statementBalance.evidenceDate === asOf
            ),
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

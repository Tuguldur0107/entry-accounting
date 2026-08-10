import type { CashAccount, CashDocument } from "@/lib/db/schema";

import { calculateCashBalances } from "@/lib/cash/balances";

const TOLERANCE = 0.01;

export function cashDocumentEffect(
  document: Pick<
    CashDocument,
    | "status"
    | "documentType"
    | "fromCashAccountId"
    | "toCashAccountId"
    | "amount"
  >,
  accountId: string
) {
  if (document.status !== "posted") return 0;
  const amount = Number(document.amount);
  let effect = 0;
  if (document.toCashAccountId === accountId) effect += amount;
  if (document.fromCashAccountId === accountId) effect -= amount;
  return effect;
}

export function calculateFxRevaluation(
  foreignBalance: number,
  closingRate: number,
  carryingAmount: number
) {
  if (!Number.isFinite(foreignBalance))
    throw new Error("Валютын үлдэгдэл буруу байна");
  if (!Number.isFinite(closingRate) || closingRate <= 0)
    throw new Error("Хаалтын ханш 0-ээс их байна");
  if (!Number.isFinite(carryingAmount))
    throw new Error("GL carrying amount буруу байна");

  const revaluedAmount = Math.round(foreignBalance * closingRate * 100) / 100;
  const adjustmentAmount =
    Math.round((revaluedAmount - carryingAmount) * 100) / 100;
  return { revaluedAmount, adjustmentAmount };
}

// ── Хяналтын самбар + Тулгалт хуудасны ХАМТЫН цөм тооцоо ────────────────────
// Урьд хоёр хуудас данс бүрийн үлдэгдэл/зөрүү/статусыг тус тусдаа тооцдог
// байсан тул зөрдөг байв (самбар GL-ийг cashAccountId холбоосоор, тулгалт
// дансны ДУГААРААР тоолж байсан г.м). Одоо хоёул ЭНЭ функцээс уншина —
// шинэ дүрэм зөвхөн энд нэмэгдэнэ.

/** 10 хэсэгт dotted кодоос үндсэн дансны дугаарыг салгана. */
export function glMainNumber(accountNumber: string) {
  const parts = accountNumber.split(".");
  return parts.length === 10 ? parts[2] : accountNumber;
}

interface VoucherLike {
  lines: { accountNumber: string; debit: string | number; credit: string | number }[];
}

interface StatementLike {
  cashAccountId: string;
  periodEnd: string | null;
  lines: {
    transactionDate: string;
    rowNumber: number;
    balance: string | number | null;
  }[];
}

export interface FxRevaluationLike {
  cashAccountId: string;
  status: string;
  closingRate: string | number;
}

export interface CashCoreRow<R extends FxRevaluationLike = FxRevaluationLike> {
  cashBalance: number;
  glBalance: number;
  bankBalance: number | null;
  /** Хуулгын нотлох огноо (periodEnd байвал тэр, үгүй бол сүүлийн мөрийн огноо). */
  bankBalanceDate: string | null;
  closingRate: number | null;
  rateRow: R | null;
  cashBalanceMnt: number | null;
  cashToGlDifference: number | null;
  bankToCashDifference: number | null;
  status: ReturnType<typeof reconciliationStatus>;
}

export function computeCashCoreRows<R extends FxRevaluationLike>(input: {
  accounts: CashAccount[];
  /** Бүх баримт байж болно — asOf-оос хойшхи нь энд шүүгдэнэ. */
  documents: CashDocument[];
  /** Зөвхөн posted+reversed, date ≤ asOf журналууд (query талдаа шүүгдсэн). */
  vouchers: VoucherLike[];
  statements: StatementLike[];
  /** valuationDate desc, createdAt desc эрэмбээр (query талдаа). */
  fxRevaluations: R[];
  asOf: string;
}): Map<string, CashCoreRow<R>> {
  const { accounts, vouchers, statements, fxRevaluations, asOf } = input;
  const documents = input.documents.filter((doc) => doc.date <= asOf);

  const cashBalanceMap = calculateCashBalances(accounts, documents);

  // GL үлдэгдлийг ДАНСНЫ ДУГААРААР тоолно (cashAccountId холбоосоор БИШ) —
  // гараар/AI-гаар бичсэн журнал холбоосгүй байдаг тул холбоосоор тоолбол
  // тэдгээр нь GL талд "алга болж" хий зөрүү үзүүлдэг. Дугаараар тоолсноор
  // reconcile_modules tool-той ИЖИЛ үнэн гарна. "Reversed" журнал GL-д
  // тооцогдсон хэвээр (эх + буцаалт нэт 0) — GL тайлантай ижил.
  const glByMain = new Map<string, number>();
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      const main = glMainNumber(line.accountNumber);
      glByMain.set(
        main,
        (glByMain.get(main) ?? 0) + Number(line.debit) - Number(line.credit)
      );
    }
  }

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

  const latestFxRate = new Map<string, R>();
  for (const revaluation of fxRevaluations) {
    if (revaluation.status !== "posted") continue;
    if (!latestFxRate.has(revaluation.cashAccountId))
      latestFxRate.set(revaluation.cashAccountId, revaluation);
  }

  const rows = new Map<string, CashCoreRow<R>>();
  for (const account of accounts) {
    const cashBalance = cashBalanceMap.get(account.id) ?? 0;
    const glBalance =
      Math.round((glByMain.get(account.glAccountNumber) ?? 0) * 100) / 100;
    const statementBalance = latestBankBalance.get(account.id);
    const rateRow = latestFxRate.get(account.id) ?? null;
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

    rows.set(account.id, {
      cashBalance,
      glBalance,
      bankBalance: statementBalance?.balance ?? null,
      bankBalanceDate: statementBalance?.evidenceDate ?? null,
      closingRate,
      rateRow,
      cashBalanceMnt,
      cashToGlDifference,
      bankToCashDifference,
      status:
        // Юу ч хөдлөөгүй хоосон данс — тулгах зүйл алга, "тэнцсэн" гэж үзнэ.
        cashBalance === 0 &&
        Math.abs(glBalance) <= TOLERANCE &&
        statementBalance == null
          ? "balanced"
          : reconciliationStatus(
              cashToGlDifference,
              bankToCashDifference,
              account.currency === "MNT" ||
                closingRate != null ||
                cashBalance === 0,
              statementBalance == null || statementBalance.evidenceDate === asOf
            ),
    });
  }
  return rows;
}

export function reconciliationStatus(
  cashToGlDifference: number | null,
  bankToCashDifference: number | null,
  hasRate: boolean,
  isStatementCurrent = true
) {
  if (!hasRate) return "missing-rate" as const;
  if (bankToCashDifference != null && !isStatementCurrent)
    return "stale-statement" as const;
  if (
    (cashToGlDifference != null &&
      Math.abs(cashToGlDifference) > TOLERANCE) ||
    (bankToCashDifference != null &&
      Math.abs(bankToCashDifference) > TOLERANCE)
  )
    return "exception" as const;
  if (bankToCashDifference == null) return "no-statement" as const;
  return "balanced" as const;
}

// Нэг эх сурвалж: үндсэн дансны салгагч. Хуучин нэрээр re-export.
export { extractMainAccount as glMainNumber } from "@/lib/reports/balances";
import { extractMainAccount } from "@/lib/reports/balances";
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

/**
 * Ханшийн тэгшитгэлийн GL-ийн ₮ ДҮН (carrying amount) — ЦЭВЭР (ENT-023).
 *
 * Урьд зөвхөн `cashAccountId` тэмдэглэгдсэн мөрөөр бодогддог байсан тул
 * гараар бичсэн нээлтийн журнал (тэмдэггүй) тооцогдохгүй, бүх үнэлгээ
 * «ханшийн олз» болдог байв (12,000 USD → 41.4 сая хуурамч олз).
 *   • GL данс НЭГ кассын дансанд л холбогдсон → GL дансны БҮХ мөр (тулгалтын
 *     самбарын GL үлдэгдэлтэй ИЖИЛ суурь)
 *   • Олон кассын данс нэг GL хуваалцвал → зөвхөн тэмдэглэгдсэн мөр; тэмдэггүй
 *     мөр байвал аль дансных нь тодорхойгүй тул `untaggedAmount`-оор ИЛ
 *     буцааж, дуудагч тэгшитгэлийг ЗОГСООНО (таамаглахгүй)
 */
export function fxCarryingAmount(input: {
  lines: { accountNumber: string; cashAccountId: string | null; debit: number; credit: number }[];
  cashAccountId: string;
  glAccountNumber: string;
  glSharedWithOtherCashAccounts: boolean;
}): { carryingAmount: number; untaggedAmount: number; untaggedLines: number } {
  let carrying = 0;
  let untagged = 0;
  let untaggedLines = 0;
  for (const line of input.lines) {
    const delta = Number(line.debit) - Number(line.credit);
    if (line.cashAccountId === input.cashAccountId) {
      carrying += delta;
      continue;
    }
    if (extractMainAccount(line.accountNumber) !== input.glAccountNumber) continue;
    if (line.cashAccountId) continue; // өөр кассын дансных
    if (input.glSharedWithOtherCashAccounts) {
      untagged += delta;
      untaggedLines += 1;
    } else carrying += delta;
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return { carryingAmount: round(carrying), untaggedAmount: round(untagged), untaggedLines };
}

// ── Хяналтын самбар + Тулгалт хуудасны ХАМТЫН цөм тооцоо ────────────────────
// Урьд хоёр хуудас данс бүрийн үлдэгдэл/зөрүү/статусыг тус тусдаа тооцдог
// байсан тул зөрдөг байв (самбар GL-ийг cashAccountId холбоосоор, тулгалт
// дансны ДУГААРААР тоолж байсан г.м). Одоо хоёул ЭНЭ функцээс уншина —
// шинэ дүрэм зөвхөн энд нэмэгдэнэ.


interface VoucherLike {
  lines: { accountNumber: string; debit: string | number; credit: string | number }[];
}

interface StatementLike {
  cashAccountId: string;
  periodEnd: string | null;
  lines: {
    transactionDate: string;
    rowNumber: number;
    income: string | number;
    expense: string | number;
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
  /**
   * Snapshot + delta-гаар (lib/cash/period-balances.ts) урьдчилан бодсон
   * кассын үлдэгдэл — өгвөл `documents`-ээс дахин нийлэхгүй (баримтыг JS-д
   * бүхэлд нь ачаалахгүйн тулд).
   */
  cashBalances?: Map<string, number>;
  /** Мөн адил GL: үндсэн данс → Σ(дебет − кредит) (lib/reports/period-balances.ts). */
  glBalances?: Map<string, number>;
}): Map<string, CashCoreRow<R>> {
  const { accounts, vouchers, statements, fxRevaluations, asOf } = input;
  const documents = input.documents.filter((doc) => doc.date <= asOf);

  const cashBalanceMap =
    input.cashBalances ?? calculateCashBalances(accounts, documents);

  // GL үлдэгдлийг ДАНСНЫ ДУГААРААР тоолно (cashAccountId холбоосоор БИШ) —
  // гараар/AI-гаар бичсэн журнал холбоосгүй байдаг тул холбоосоор тоолбол
  // тэдгээр нь GL талд "алга болж" хий зөрүү үзүүлдэг. Дугаараар тоолсноор
  // reconcile_modules tool-той ИЖИЛ үнэн гарна. "Reversed" журнал GL-д
  // тооцогдсон хэвээр (эх + буцаалт нэт 0) — GL тайлантай ижил.
  const glByMain = input.glBalances ?? new Map<string, number>();
  for (const voucher of input.glBalances ? [] : vouchers) {
    for (const line of voucher.lines) {
      const main = extractMainAccount(line.accountNumber);
      glByMain.set(
        main,
        (glByMain.get(main) ?? 0) + Number(line.debit) - Number(line.credit)
      );
    }
  }

  // Банкны тал: хуулгын "Үлдэгдэл" багана импортлогдохгүй (2026-09 — шаардлага
  // байхгүй) тул банкны үлдэгдлийг КАССЫН ТАЛТАЙ ИЖИЛ зангуугаас бодно:
  // дансны нээлтийн үлдэгдэл + Σ(орлого − зарлага) импортолсон мөр (≤ asOf).
  // Ингэснээр bank↔cash зөрүү нь "банкны хөдөлгөөн vs бүртгэсэн хөдөлгөөн"
  // болно — тулгалтын зорилго яг энэ. Таамаглал: нээлтийн огнооноос хойшхи
  // бүх хуулга импортлогдсон (fileHash давхардлыг хаадаг).
  const bankMovement = new Map<
    string,
    { movement: number; date: string; evidenceDate: string; rowNumber: number }
  >();
  for (const statement of statements) {
    for (const line of statement.lines) {
      if (line.transactionDate > asOf) continue;
      const current = bankMovement.get(statement.cashAccountId) ?? {
        movement: 0,
        date: "",
        evidenceDate: "",
        rowNumber: 0,
      };
      current.movement += Number(line.income) - Number(line.expense);
      if (
        line.transactionDate > current.date ||
        (line.transactionDate === current.date &&
          line.rowNumber > current.rowNumber)
      ) {
        current.date = line.transactionDate;
        current.rowNumber = line.rowNumber;
        current.evidenceDate =
          statement.periodEnd && statement.periodEnd <= asOf
            ? statement.periodEnd
            : line.transactionDate;
      }
      bankMovement.set(statement.cashAccountId, current);
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
    const movement = bankMovement.get(account.id);
    const statementBalance = movement
      ? {
          balance:
            Math.round(
              (Number(account.openingBalance) + movement.movement) * 100
            ) / 100,
          evidenceDate: movement.evidenceDate,
        }
      : undefined;
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

/**
 * Кассын тулгалтын ХҮЛЭЭГДЭХ GL үлдэгдэл — модулийн ₮ үлдэгдэл (түүхэн
 * ханшаар) дээр батлагдсан (буцаагдаагүй, asOf хүртэлх) ханшийн
 * тэгшитгэлийн Σ дүнг нэмнэ.
 *
 * ЯАГААД энэ хувилбар (Б биш А): тэгшитгэл ЗӨВХӨН GL-д журнал бичдэг,
 * кассын баримт үүсгэдэггүй тул модулийн үлдэгдэл түүхэн ханшаараа үлддэг.
 * Батлагдсан тэгшитгэлүүдийг нэмбэл GL-ийн carrying дүн ЯГ (бөөрөнхийлөлт
 * хүртэл) сэргэнэ — «FC × сүүлийн ханш» хувилбар бол тэгшитгэл огт
 * хийгээгүй/хэсэгчилсэн үед худал зөрүү үзүүлэх ба GL-д гараар бичсэн
 * бичилтийг тэгшитгэлийн дүнтэй хольж илрүүлэхгүй байх эрсдэлтэй.
 */
export function expectedCashGlBalance(input: {
  subledger: number;
  revaluations: {
    adjustmentAmount: number;
    status: string;
    valuationDate: string;
  }[];
  asOf: string;
}): { expected: number; fxTotal: number } {
  const fxTotal =
    Math.round(
      input.revaluations
        .filter(
          (revaluation) =>
            revaluation.status === "posted" &&
            revaluation.valuationDate <= input.asOf
        )
        .reduce((sum, revaluation) => sum + revaluation.adjustmentAmount, 0) *
        100
    ) / 100;
  return {
    fxTotal,
    expected: Math.round((input.subledger + fxTotal) * 100) / 100,
  };
}

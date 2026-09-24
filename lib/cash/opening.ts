// Кассын дансны НЭЭЛТИЙН үлдэгдлийн ЦЭВЭР дүрэм (tests/cash-opening.test.ts).
//
// SIM Trade симуляци:
//   • ENT-012 — нээлтийн журнал ӨНӨӨДРИЙН огноогоор үүсдэг байв (нэвтрүүлэлтийн
//     cut-off огноо биш). Дансанд «нээлтийн огноо» (`cash_accounts.opening_date`)
//     хадгалагдаж, журнал ЗӨВХӨН түүгээр (эсвэл ил өгсөн огноогоор) бичигдэнэ.
//   • ENT-011 — валютын дансны нээлт ханшгүйгээр ₮ болж бичигддэг байв
//     (12,000 USD → 12,000₮). Одоо валютын журнал: currency/exchangeRate +
//     мөрийн debitFc/creditFc, MNT = FC × нээлтийн огнооны ханш.
//
// Ханш ЗОХИОГДОХГҮЙ: гараар өгсөн (`openingRate`) → нээлтийн огнооны
// Монголбанкны албан ханш → олдохгүй бол [RATE_REQUIRED].

import { assertCalendarDate } from "@/lib/periods/document-date";

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface CashOpeningFieldsInput {
  openingBalance: number;
  currency: string;
  openingDate?: string | null;
  openingRate?: number | string | null;
  /**
   * Нээлт ≠ 0 үед огноог шаардах эсэх (default true). Багана нэмэгдэхээс
   * ӨМНӨХ данс огноогүй хадгалагдсан — эхний үлдэгдэл нь өөрчлөгдөөгүй бол
   * нэр/банкны мэдээллийг засахад огноо нэхэхгүй (засвар огт хийгдэхгүй
   * болж гацдаг байв — аудитын M2).
   */
  requireDate?: boolean;
}

/**
 * Данс үүсгэх/засах үеийн нээлтийн талбаруудыг шалгаж хэвшүүлнэ.
 * Нээлт ≠ 0 бол огноо ЗААВАЛ; ханш зөвхөн валютын дансанд (эерэг тоо).
 */
export function normalizeCashOpeningFields(input: CashOpeningFieldsInput): {
  openingDate: string | null;
  openingRate: number | null;
} {
  const date = input.openingDate?.trim() || null;
  if (date) assertCalendarDate(date, "Нээлтийн огноо");
  if (input.requireDate !== false && Math.abs(input.openingBalance) >= 0.005 && !date)
    throw new Error(
      "Эхний үлдэгдэлтэй дансанд НЭЭЛТИЙН ОГНОО (нэвтрүүлэлтийн cut-off, YYYY-MM-DD) заавал оруулна"
    );
  const currency = input.currency.trim().toUpperCase() || "MNT";
  const rawRate = input.openingRate;
  const hasRate = rawRate !== null && rawRate !== undefined && String(rawRate).trim() !== "";
  if (!hasRate || currency === "MNT") return { openingDate: date, openingRate: null };
  const rate = Number(rawRate);
  if (!Number.isFinite(rate) || rate <= 0)
    throw new Error("Нээлтийн ханш эерэг тоо байна");
  return { openingDate: date, openingRate: rate };
}

export interface CashOpeningPlan {
  /** Баримтын валют. */
  currency: string;
  /** Ханш (MNT-д 1). */
  rate: number;
  /** Валютын дүн (MNT дансанд 0 — журналын FC багана хоосон). */
  amountFc: number;
  /** Дэвтрийн (MNT) дүн. */
  amountMnt: number;
  /** true → Дт касс/банк, Кт харьцах данс; false (сөрөг нээлт) → эсрэгээр. */
  cashIsDebit: boolean;
}

/** Нээлтийн журналын дүн — ханшаар хөрвүүлнэ. */
export function planCashOpeningVoucher(input: {
  openingBalance: number;
  currency: string;
  rate: number;
}): CashOpeningPlan {
  const currency = input.currency.trim().toUpperCase() || "MNT";
  const opening = Number(input.openingBalance);
  if (!Number.isFinite(opening) || Math.abs(opening) < 0.005)
    throw new Error("Нээлтийн үлдэгдэл 0 тул журнал шаардлагагүй");
  const absolute = round2(Math.abs(opening));
  if (currency === "MNT")
    return { currency, rate: 1, amountFc: 0, amountMnt: absolute, cashIsDebit: opening > 0 };
  const rate = Number(input.rate);
  if (!Number.isFinite(rate) || rate <= 0)
    throw new Error(`[RATE_REQUIRED] ${currency} дансны нээлтийн ханш алга`);
  return {
    currency,
    rate,
    amountFc: absolute,
    amountMnt: round2(absolute * rate),
    cashIsDebit: opening > 0,
  };
}

/**
 * Кассын дансны нээлтийн үлдэгдлийн ₮ дүн (тулгалтад, ENT-020). Валютын
 * дансны `openingBalance` нь ВАЛЮТААР тул ₮-тэй шууд нэмэхгүй:
 *   нээлтийн журнал (бодит бичигдсэн ₮) → гараар өгсөн нээлтийн ханш → null
 * null = тодорхойгүй — ханш ЗОХИОХГҮЙ, дуудагч ИЛ мэдэгдэнэ.
 */
export function cashOpeningMnt(input: {
  currency: string;
  openingBalance: number;
  openingRate?: number | null;
  /** Нээлтийн журналын кассын мөрийн ₮ (Дт − Кт) — байхгүй бол null. */
  openingVoucherMnt?: number | null;
}): number | null {
  const opening = Number(input.openingBalance) || 0;
  const currency = input.currency.trim().toUpperCase() || "MNT";
  if (currency === "MNT" || Math.abs(opening) < 0.005) return opening;
  if (input.openingVoucherMnt !== null && input.openingVoucherMnt !== undefined)
    return round2(input.openingVoucherMnt);
  const rate = Number(input.openingRate);
  if (Number.isFinite(rate) && rate > 0) return round2(opening * rate);
  return null;
}

/**
 * Дансны нээлтийн журналыг (дахин) үүсгэж болох эсэх + шинэ журналын
 * externalRef (аудит M1). Буцаагдсан хуучин нээлт (ENT-011-ийн өмнөх ханшгүй
 * ₮ журнал г.м.) болон түүний буцаалт нь ИДЭВХГҮЙ — `reconcile_modules`-ийн
 * «буцаагаад дахин бичнэ» зөвлөмж ажиллахын тулд тэднийг тоохгүй. Unique index
 * (organization_id, external_ref) статусаар шүүгддэггүй тул дахин үүсгэх
 * журнал `cash-opening:<id>:<n>` дугаартай болно (`cash-opening:%` хайлтад орно).
 */
export function planCashOpeningRef(
  cashAccountId: string,
  prior: readonly { externalRef: string | null; status: string; reversalOfVoucherId: string | null }[]
): { blockedBy: "draft" | "posted" | null; externalRef: string } {
  const base = `cash-opening:${cashAccountId}`;
  const active = prior.find(
    (voucher) => voucher.reversalOfVoucherId === null && (voucher.status === "draft" || voucher.status === "posted")
  );
  if (active) return { blockedBy: active.status === "draft" ? "draft" : "posted", externalRef: base };
  const used = new Set(prior.map((voucher) => voucher.externalRef).filter(Boolean));
  if (!used.has(base)) return { blockedBy: null, externalRef: base };
  let n = 2;
  while (used.has(`${base}:${n}`)) n += 1;
  return { blockedBy: null, externalRef: `${base}:${n}` };
}

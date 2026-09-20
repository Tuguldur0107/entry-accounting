// SaaS багцын ҮНЭ — ЦЭВЭР давхарга (DB-гүй, client-safe, тесттэй).
// docs/billing/00-proposal.md §2.
//
// Үнэ нь ОГНООТОЙ: багц бүр үеүдийн (period) түүхтэй бөгөөд үе бүр
// `effectiveFrom` … `effectiveTo` (ХАМРУУЛСАН; null = хугацаагүй) мужтай.
// Ингэснээр анх ямар үнэ тогтоосон нь түүхэндээ үлдэж, ирээдүйн үнийг
// урьдчилан оруулж болно.
//
// Үнэ ГУРВАН давхаргаас бүрдэнэ (доошоо дардаг):
//   1. `plans.ts`-ийн default                       — кодод; тухайн огноог хамрах үе БАЙХГҮЙ үед
//   2. `platform_plan_prices` үеүд                  — Entry Console-оос (deploy хэрэггүй)
//   3. `organization_subscriptions.pricePerSeatMnt` — ТУХАЙН харилцагчийн тусгай үнэ
//
// `null` = үнэ ТОГТООГООГҮЙ (хэлэлцээрээр) — 0₮ гэсэн үг БИШ.

import { PLAN_IDS, PLANS, isPlanId, type PlanId } from "./plans";

export type PlanPriceMap = Record<PlanId, number | null>;

/** Нэг суудлын сарын үнийн дээд хязгаар — гажиг оролтын хамгаалалт. */
export const MAX_PLAN_PRICE_MNT = 100_000_000;

/** Нээлттэй мужийг харьцуулахад ашиглах «хязгааргүй» огноо. */
const OPEN_END = "9999-12-31";

/** Кодод бичигдсэн суурь үнэ (`plans.ts`) — үеийн мөр байхгүй огноонд үйлчилнэ. */
export const DEFAULT_PLAN_PRICES: PlanPriceMap = Object.fromEntries(
  PLAN_IDS.map((planId) => [planId, PLANS[planId].pricePerSeatMnt])
) as PlanPriceMap;

/** Үнийн нэг үе. `effectiveTo` нь ХАМРУУЛСАН (тэр өдөр хүртэл үйлчилнэ). */
export type PlanPricePeriod = {
  id: string;
  planId: PlanId;
  pricePerSeatMnt: number | null;
  /** YYYY-MM-DD */
  effectiveFrom: string;
  /** YYYY-MM-DD, null = хугацаагүй */
  effectiveTo: string | null;
  note: string | null;
};

export type PlanPricePeriodInput = Omit<PlanPricePeriod, "id" | "planId"> & { planId: string };

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Өмнөх хоног — шинэ үе эхлэхэд өмнөхийг хаахад хэрэглэнэ. */
export function previousDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function covers(period: { effectiveFrom: string; effectiveTo: string | null }, date: string): boolean {
  return period.effectiveFrom <= date && date <= (period.effectiveTo ?? OPEN_END);
}

function overlaps(
  a: { effectiveFrom: string; effectiveTo: string | null },
  b: { effectiveFrom: string; effectiveTo: string | null }
): boolean {
  return a.effectiveFrom <= (b.effectiveTo ?? OPEN_END) && b.effectiveFrom <= (a.effectiveTo ?? OPEN_END);
}

/** Огноо → эрт эхэлсэн нь эхэнд; ижил өдөр бол оруулсан дараалал хэвээр. */
export function sortPeriods<T extends { effectiveFrom: string }>(periods: T[]): T[] {
  return [...periods].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/**
 * Тухайн ОГНООНД үйлчлэх үнэ. Хамрах үе байхгүй бол `undefined` —
 * дуудагч кодын default руу шилжинэ (үнэ ЗОХИОХГҮЙ).
 */
export function priceAtDate(
  periods: PlanPricePeriod[],
  planId: PlanId,
  date: string
): number | null | undefined {
  const matches = periods.filter((period) => period.planId === planId && covers(period, date));
  if (matches.length === 0) return undefined;
  // Давхцал үүсэхээс хамгаалагдсан ч (planPriceChange), гажиг өгөгдөлд
  // ХАМГИЙН СҮҮЛД эхэлсэн үеийг авна — тодорхойгүй байдлыг чимээгүй өнгөрөөхгүй.
  return sortPeriods(matches)[matches.length - 1].pricePerSeatMnt;
}

/** Тухайн огнооны бүх багцын үнэ (хамрах үегүй багц нь кодын default-аараа). */
export function resolvePlanPricesAt(periods: PlanPricePeriod[], date: string): PlanPriceMap {
  const prices: PlanPriceMap = { ...DEFAULT_PLAN_PRICES };
  for (const planId of PLAN_IDS) {
    const value = priceAtDate(periods, planId, date);
    if (value !== undefined) prices[planId] = value;
  }
  return prices;
}

/**
 * Оролтыг ₮ бүхэл тоо болгоно; хоосон → null (хэлэлцээрээр).
 * Алдааг МОНГОЛООР шидэж, дуудагч `{ error }` болгоно.
 */
export function parsePlanPriceInput(value: unknown, label = "Үнэ"): number | null {
  if (value === null || value === undefined) return null;
  const raw =
    typeof value === "string" ? (value.trim() === "" ? null : Number(value.replace(/[\s,₮]/g, ""))) : value;
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error(`${label}: тоо байх ёстой`);
  if (!Number.isInteger(raw)) throw new Error(`${label}: бүхэл тоо (₮) байх ёстой`);
  if (raw < 0) throw new Error(`${label}: сөрөг байж болохгүй`);
  if (raw > MAX_PLAN_PRICE_MNT)
    throw new Error(`${label}: хэт их — дээд тал нь ${MAX_PLAN_PRICE_MNT.toLocaleString("en-US")}₮`);
  return raw;
}

export type PlanPriceChange =
  | {
      ok: true;
      period: Omit<PlanPricePeriod, "id">;
      /** Хугацаагүй байсан өмнөх үеийг ЭНЭ өдрөөр хаана (шинэ үе эхлэхийн өмнөх хоног). */
      closePreviousId: string | null;
      closePreviousTo: string | null;
    }
  | { ok: false; error: string };

/**
 * Шинэ үнийн үе нэмэх ТӨЛӨВЛӨГӨӨ — давхцлыг УРЬДЧИЛЖ барина.
 *
 * - Хугацаагүй байсан өмнөх үе дээр ШИНЭ үе хожуу эхэлбэл өмнөхийг автоматаар
 *   хаана (хоёр үнэ нэг өдөр зэрэг үйлчлэхгүй) — үр дүнд нь ИЛ мэдэгдэнэ.
 * - Бусад ямар ч давхцал бол ТАТГАЛЗАНА: аль үетэй мөргөлдсөнийг хэлнэ.
 */
export function planPriceChange(
  existing: PlanPricePeriod[],
  incoming: { planId: string; pricePerSeatMnt: unknown; effectiveFrom: string; effectiveTo: string | null; note?: string | null }
): PlanPriceChange {
  if (!isPlanId(incoming.planId)) return { ok: false, error: `Багц буруу: ${String(incoming.planId)}` };
  if (!isIsoDate(incoming.effectiveFrom))
    return { ok: false, error: "Эхлэх огноо буруу — YYYY-MM-DD" };
  if (incoming.effectiveTo !== null && !isIsoDate(incoming.effectiveTo))
    return { ok: false, error: "Дуусах огноо буруу — YYYY-MM-DD (хоосон = хугацаагүй)" };
  if (incoming.effectiveTo !== null && incoming.effectiveTo < incoming.effectiveFrom)
    return { ok: false, error: "Дуусах огноо эхлэх огнооноос өмнө байна" };

  let price: number | null;
  try {
    price = parsePlanPriceInput(incoming.pricePerSeatMnt, "Үнэ");
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : String(caught) };
  }

  const planPeriods = sortPeriods(existing.filter((period) => period.planId === incoming.planId));
  const conflicts = planPeriods.filter((period) => overlaps(period, incoming));

  let closePreviousId: string | null = null;
  let closePreviousTo: string | null = null;
  if (conflicts.length === 1) {
    const previous = conflicts[0];
    const openEnded = previous.effectiveTo === null;
    const startsLater = previous.effectiveFrom < incoming.effectiveFrom;
    if (openEnded && startsLater) {
      closePreviousId = previous.id;
      closePreviousTo = previousDay(incoming.effectiveFrom);
    }
  }
  if (conflicts.length > 0 && closePreviousId === null) {
    const shown = conflicts
      .map((period) => `${period.effectiveFrom} … ${period.effectiveTo ?? "хугацаагүй"}`)
      .join(", ");
    return {
      ok: false,
      error: `Огноо давхцаж байна (${shown}) — өмнөх үеийн хугацааг эхлээд хаа эсвэл тэр мөрийг устга`,
    };
  }

  return {
    ok: true,
    period: {
      planId: incoming.planId,
      pricePerSeatMnt: price,
      effectiveFrom: incoming.effectiveFrom,
      effectiveTo: incoming.effectiveTo,
      note: incoming.note?.trim() || null,
    },
    closePreviousId,
    closePreviousTo,
  };
}

/** Байгууллагын БОДИТ суудлын үнэ: тусгай үнэ → тухайн огнооны багцын үнэ → null. */
export function resolveSeatPrice(
  planId: PlanId,
  orgOverrideMnt: number | null | undefined,
  prices: PlanPriceMap = DEFAULT_PLAN_PRICES
): number | null {
  if (orgOverrideMnt !== null && orgOverrideMnt !== undefined) return orgOverrideMnt;
  return prices[planId] ?? null;
}

/** Сарын дүн = төлсөн суудал × суудлын үнэ; аль нэг нь тодорхойгүй бол null. */
export function monthlyAmountMnt(
  seats: number | null | undefined,
  pricePerSeatMnt: number | null
): number | null {
  if (seats === null || seats === undefined || pricePerSeatMnt === null) return null;
  if (!Number.isFinite(seats) || seats < 0) return null;
  return Math.round(seats * pricePerSeatMnt);
}

/** Үеийн товч тайлбар — лог, UI-д. */
export function describePeriod(period: Pick<PlanPricePeriod, "pricePerSeatMnt" | "effectiveFrom" | "effectiveTo">): string {
  const price = period.pricePerSeatMnt === null ? "хэлэлцээрээр" : `${period.pricePerSeatMnt.toLocaleString("en-US")}₮`;
  return `${period.effectiveFrom} … ${period.effectiveTo ?? "хугацаагүй"}: ${price}`;
}

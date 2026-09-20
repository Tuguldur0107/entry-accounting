// SaaS багцын ҮНЭ — ЦЭВЭР давхарга (DB-гүй, client-safe, тесттэй).
// docs/billing/00-proposal.md §2.
//
// Үнэ ГУРВАН давхаргаас бүрдэнэ (доошоо дардаг):
//   1. `plans.ts`-ийн default            — кодод; зөвхөн шинэ deploy-д өөрчлөгдөнө
//   2. `platform_plan_prices`            — Entry Console-оос тохируулна (deploy хэрэггүй)
//   3. `organization_subscriptions.pricePerSeatMnt` — ТУХАЙН харилцагчийн тусгай
//      үнэ (enterprise хэлэлцээр, хөнгөлөлт)
//
// `null` = үнэ ТОГТООГООГҮЙ (хэлэлцээрээр) — 0₮ гэсэн үг БИШ. Хадгалагдсан мөрийн
// null нь «цэвэрлэсэн» гэсэн ИЛ утга тул default руу буцахгүй: тохируулагч
// хүн үнийг санаатай авч хаяж чадна.

import { PLAN_IDS, PLANS, isPlanId, type PlanId } from "./plans";

export type PlanPriceMap = Record<PlanId, number | null>;

/** Нэг суудлын сарын үнийн дээд хязгаар — гажиг оролтын хамгаалалт. */
export const MAX_PLAN_PRICE_MNT = 100_000_000;

/** Кодод бичигдсэн суурь үнэ (`plans.ts`). */
export const DEFAULT_PLAN_PRICES: PlanPriceMap = Object.fromEntries(
  PLAN_IDS.map((planId) => [planId, PLANS[planId].pricePerSeatMnt])
) as PlanPriceMap;

/** Хадгалагдсан мөрүүд → бүтэн зураглал (байхгүй багц нь default-аараа). */
export function mergePlanPrices(
  stored: Iterable<{ planId: string; pricePerSeatMnt: number | null }>
): PlanPriceMap {
  const prices: PlanPriceMap = { ...DEFAULT_PLAN_PRICES };
  for (const row of stored) if (isPlanId(row.planId)) prices[row.planId] = row.pricePerSeatMnt;
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

/** Байгууллагын БОДИТ суудлын үнэ: тусгай үнэ → багцын үнэ → null. */
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

/** Өөрчлөлтийн ил тайлбар (лог, аудитад) — өөрчлөгдөөгүй багц ОРОХГҮЙ. */
export function describePlanPriceChanges(current: PlanPriceMap, next: PlanPriceMap): string[] {
  const label = (value: number | null) => (value === null ? "хэлэлцээрээр" : `${value.toLocaleString("en-US")}₮`);
  return PLAN_IDS.filter((planId) => current[planId] !== next[planId]).map(
    (planId) => `${planId}: ${label(current[planId])} → ${label(next[planId])}`
  );
}

// Элэгдлийн цэвэр тооцоолол (DB хамааралгүй, unit тесттэй). Хоёр арга:
//   straight_line     — IAS 16: сарын элэгдэл = (өртөг − үлдэх өртөг) / хугацаа
//   declining_balance — ×2 үлдэгдэл буурах: сарын элэгдэл = NBV × 2 / хугацаа;
//                       хугацаа дуусмагц үлдэгдлийг бүтнээр нь элэгдүүлж хаана.
// Аль ч аргад хуримтлагдсан нь (өртөг − үлдэх өртөг)-өөс хэтрэхгүй.

import { roundMoney as round2 } from "@/lib/arap/accounting";

export type DepreciationMethod = "straight_line" | "declining_balance";

export const DEPRECIATION_METHODS: {
  id: DepreciationMethod;
  label: string;
}[] = [
  { id: "straight_line", label: "Шулуун шугам" },
  { id: "declining_balance", label: "Үлдэгдэл буурах (×2)" },
];

export function isDepreciationMethod(
  value: string
): value is DepreciationMethod {
  return DEPRECIATION_METHODS.some((method) => method.id === value);
}

export function depreciationMethodLabel(value: string): string {
  return (
    DEPRECIATION_METHODS.find((method) => method.id === value)?.label ?? value
  );
}

export interface FixedAssetRef {
  id: string;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  method: DepreciationMethod;
  /** YYYY-MM — элэгдэл эхлэх сар. */
  depreciationStartMonth: string | null;
  /** YYYY-MM-DD — ӨДРИЙН суурьт; хоосон бол эхлэх сарын 1-ний өдөр. */
  depreciationStartDate?: string | null;
  status: string;
  /**
   * ТАТВАРЫН зорилгоорх хугацаа/арга (cit.md-ийн хуулийн хувь) — 0 бол
   * татварын элэгдэл бодогдохгүй. GL-д бичигдэхгүй, зөвхөн мэмо.
   */
  taxUsefulLifeMonths?: number;
  taxMethod?: DepreciationMethod;
}

// ── Өдрийн суурь ───────────────────────────────────────────────────────────
// "daily" үед элэгдэл нь ӨДРӨӨР хуваарилагдана: нийт элэгдүүлэх дүнг
// ашиглалтын хугацааны НИЙТ ӨДРӨӨР хувааж өдрийн хөлс гаргаад, тухайн сард
// элэгдүүлэх өдрийн тоогоор үржүүлнэ. Ингэснээр сар дундуур ашиглалтад
// орсон хөрөнгө тэр сард хувь тэнцүүлэн элэгдэж, 28/30/31 хоногийн сарууд
// өөр дүнтэй гарна. Тогтмол тоо ЗОХИОХГҮЙ — нийт өдөр нь эхлэх огноо ба
// ашиглалтын хугацаанаас (сараар) гарна.

export type DepreciationBasis = "monthly" | "daily";

export function isDepreciationBasis(value: string): value is DepreciationBasis {
  return value === "monthly" || value === "daily";
}

const toUtc = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const DAY_MS = 86_400_000;

/** YYYY-MM-DD дээр сар нэмнэ (сарын өдөр байхгүй бол сарын эцэс рүү унана). */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  const iso = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), safeDay)
  );
  return iso.toISOString().slice(0, 10);
}

/** Сарын эхний / сүүлийн өдөр (YYYY-MM → YYYY-MM-DD). */
export function monthStart(month: string): string {
  return `${month}-01`;
}
export function monthEnd(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
}

/** Хоёр огнооны хоорондох өдрийн тоо (эхлэлийг оролцуулж, төгсгөлийг оролцуулна). */
export function daysBetweenInclusive(from: string, to: string): number {
  if (to < from) return 0;
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

/** Элэгдэл эхлэх огноо — өгөгдөөгүй бол эхлэх сарын 1-ний өдөр. */
export function effectiveStartDate(asset: FixedAssetRef): string | null {
  if (asset.depreciationStartDate) return asset.depreciationStartDate;
  if (asset.depreciationStartMonth) return monthStart(asset.depreciationStartMonth);
  return null;
}

/**
 * Тухайн САРД элэгдүүлэх өдрийн тоо: [эхлэх огноо, ашиглалт дуусах огноо]
 * мужийг сарын [1, эцэс] мужтай огтлолцуулна.
 */
export function depreciableDaysInMonth(
  asset: FixedAssetRef,
  usefulLifeMonths: number,
  month: string
): number {
  const start = effectiveStartDate(asset);
  if (!start || usefulLifeMonths <= 0) return 0;
  // Ашиглалтын СҮҮЛЧИЙН өдөр = эхлэх огноо + хугацаа − 1 өдөр.
  const endExclusive = addMonths(start, usefulLifeMonths);
  const end = new Date(toUtc(endExclusive) - DAY_MS).toISOString().slice(0, 10);
  const from = start > monthStart(month) ? start : monthStart(month);
  const to = end < monthEnd(month) ? end : monthEnd(month);
  return daysBetweenInclusive(from, to);
}

/** Ашиглалтын хугацааны НИЙТ өдрийн тоо (өдрийн хөлсний хуваагч). */
export function totalDepreciableDays(
  asset: FixedAssetRef,
  usefulLifeMonths: number
): number {
  const start = effectiveStartDate(asset);
  if (!start || usefulLifeMonths <= 0) return 0;
  const endExclusive = addMonths(start, usefulLifeMonths);
  return Math.round((toUtc(endExclusive) - toUtc(start)) / DAY_MS);
}


/** Шулуун шугамын тогтмол сарын дүн (мэдээлэл харуулахад). */
export function monthlyDepreciation(asset: {
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
}) {
  if (asset.usefulLifeMonths <= 0) return 0;
  return round2((asset.cost - asset.salvageValue) / asset.usefulLifeMonths);
}

/** Эхлэх сараас тухайн сар хүртэлх сарын индекс (эхлэх сар = 1). */
function monthIndex(startMonth: string, month: string): number {
  const [startYear, startMon] = startMonth.split("-").map(Number);
  const [year, mon] = month.split("-").map(Number);
  return (year - startYear) * 12 + (mon - startMon) + 1;
}

/**
 * Тухайн САРЫН элэгдлийн дүн — арга, суурь (сар/өдөр) хоёроос хамаарна.
 * `accum` = өмнөх идэвхтэй бичилтүүдийн нийлбэр (draft + posted).
 *
 * `life`/`method` параметрээр САНХҮҮГИЙН (IAS 16) эсвэл ТАТВАРЫН хугацааг
 * дамжуулж НЭГ функцээр хоёуланг бодно — хоёр тооцоо хэзээ ч салахгүй.
 */
export function depreciationForMonth(
  asset: FixedAssetRef,
  accum: number,
  month: string,
  options?: {
    basis?: DepreciationBasis;
    usefulLifeMonths?: number;
    method?: DepreciationMethod;
  }
): number {
  const life = options?.usefulLifeMonths ?? asset.usefulLifeMonths;
  const method = options?.method ?? asset.method;
  const basis = options?.basis ?? "monthly";
  if (life <= 0 || !asset.depreciationStartMonth) return 0;
  const base = round2(asset.cost - asset.salvageValue);
  const remaining = round2(base - accum);
  if (remaining <= 0) return 0;

  if (method === "declining_balance") {
    // Хугацаа дууссан бол үлдэгдлийг бүтнээр нь хааж дуусгана — ×2 арга
    // өөрөө хэзээ ч 0 хүрдэггүй тул төгсгөлийг заавал өгнө.
    if (monthIndex(asset.depreciationStartMonth, month) >= life) return remaining;
    const nbv = round2(asset.cost - accum);
    // Өдрийн суурьт эхний/сүүлийн сарыг хувь тэнцүүлнэ (дунд сарууд бүтэн).
    const monthly = round2((nbv * 2) / life);
    const amount =
      basis === "daily"
        ? round2(
            (monthly * depreciableDaysInMonth(asset, life, month)) /
              daysBetweenInclusive(monthStart(month), monthEnd(month))
          )
        : monthly;
    return Math.min(amount, remaining);
  }

  if (basis === "daily") {
    const totalDays = totalDepreciableDays(asset, life);
    if (totalDays <= 0) return 0;
    const days = depreciableDaysInMonth(asset, life, month);
    if (days <= 0) return 0;
    return Math.min(round2((base * days) / totalDays), remaining);
  }

  return Math.min(
    round2((asset.cost - asset.salvageValue) / life),
    remaining
  );
}

export interface ComputedDepreciation {
  assetId: string;
  /** САНХҮҮГИЙН (IAS 16) элэгдэл — GL-д бичигдэнэ. */
  amount: number;
  /** ТАТВАРЫН элэгдэл — МЭМО, GL-д бичигдэхгүй (cit.md). */
  taxAmount: number;
  /** Тухайн сард элэгдүүлсэн өдрийн тоо (сарын суурьт 0). */
  days: number;
}

/**
 * Тухайн сарын элэгдлийн бичилтүүд. `postedAccum` = карт бүрийн Σ идэвхтэй
 * (draft|posted) бичилт — давхар бичилтээс сэргийлж draft-ыг мөн тооцно;
 * `alreadyCharged` = тухайн САРД идэвхтэй бичилттэй картууд (алгасна).
 */
export function computeMonthlyDepreciation(input: {
  assets: FixedAssetRef[];
  postedAccum: Map<string, number>;
  alreadyCharged: Set<string>;
  month: string; // YYYY-MM
  basis?: DepreciationBasis;
  /** Картын татварын хуримтлагдсан элэгдэл (санхүүгийнхээс ТУСДАА). */
  taxAccum?: Map<string, number>;
}): ComputedDepreciation[] {
  const basis = input.basis ?? "monthly";
  const results: ComputedDepreciation[] = [];
  for (const asset of input.assets) {
    if (asset.status !== "active") continue;
    if (!asset.depreciationStartMonth) continue;
    if (asset.depreciationStartMonth > input.month) continue;
    if (input.alreadyCharged.has(asset.id)) continue;
    const accum = input.postedAccum.get(asset.id) ?? 0;
    const amount = depreciationForMonth(asset, accum, input.month, { basis });
    // Татварын элэгдэл ӨӨРИЙН хугацаа, ӨӨРИЙН хуримтлагдсанаараа бодогдоно.
    const taxLife = asset.taxUsefulLifeMonths ?? 0;
    const taxAmount =
      taxLife > 0
        ? depreciationForMonth(
            asset,
            input.taxAccum?.get(asset.id) ?? 0,
            input.month,
            {
              basis,
              usefulLifeMonths: taxLife,
              method: asset.taxMethod ?? "straight_line",
            }
          )
        : 0;
    if (amount <= 0 && taxAmount <= 0) continue;
    results.push({
      assetId: asset.id,
      amount,
      taxAmount,
      days:
        basis === "daily"
          ? depreciableDaysInMonth(asset, asset.usefulLifeMonths, input.month)
          : 0,
    });
  }
  return results;
}

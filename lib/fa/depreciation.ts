// Элэгдлийн цэвэр тооцоолол (DB хамааралгүй, unit тесттэй). Хоёр арга:
//   straight_line     — IAS 16: сарын элэгдэл = (өртөг − үлдэх өртөг) / хугацаа
//   declining_balance — ×2 үлдэгдэл буурах: сарын элэгдэл = NBV × 2 / хугацаа;
//                       хугацаа дуусмагц үлдэгдлийг бүтнээр нь элэгдүүлж хаана.
// Аль ч аргад хуримтлагдсан нь (өртөг − үлдэх өртөг)-өөс хэтрэхгүй.

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
  status: string;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

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
 * Тухайн САРЫН элэгдлийн дүн — аргаас хамаарна. `accum` = өмнөх идэвхтэй
 * бичилтүүдийн нийлбэр (draft + posted).
 */
export function depreciationForMonth(
  asset: FixedAssetRef,
  accum: number,
  month: string
): number {
  if (asset.usefulLifeMonths <= 0 || !asset.depreciationStartMonth) return 0;
  const base = round2(asset.cost - asset.salvageValue);
  const remaining = round2(base - accum);
  if (remaining <= 0) return 0;

  if (asset.method === "declining_balance") {
    // Хугацаа дууссан бол үлдэгдлийг бүтнээр нь хааж дуусгана — ×2 арга
    // өөрөө хэзээ ч 0 хүрдэггүй тул төгсгөлийг заавал өгнө.
    if (monthIndex(asset.depreciationStartMonth, month) >= asset.usefulLifeMonths)
      return remaining;
    const nbv = round2(asset.cost - accum);
    const monthly = round2((nbv * 2) / asset.usefulLifeMonths);
    return Math.min(monthly, remaining);
  }

  return Math.min(monthlyDepreciation(asset), remaining);
}

export interface ComputedDepreciation {
  assetId: string;
  amount: number;
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
}): ComputedDepreciation[] {
  const results: ComputedDepreciation[] = [];
  for (const asset of input.assets) {
    if (asset.status !== "active") continue;
    if (!asset.depreciationStartMonth) continue;
    if (asset.depreciationStartMonth > input.month) continue;
    if (input.alreadyCharged.has(asset.id)) continue;
    const accum = input.postedAccum.get(asset.id) ?? 0;
    const amount = depreciationForMonth(asset, accum, input.month);
    if (amount <= 0) continue;
    results.push({ assetId: asset.id, amount });
  }
  return results;
}

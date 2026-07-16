// Шулуун шугамын элэгдэл — цэвэр тооцоолол (DB хамааралгүй, unit тесттэй).
// IAS 16: сарын элэгдэл = (өртөг − үлдэх өртөг) / ашиглалтын хугацаа (сар);
// хуримтлагдсан нь элэгдүүлэх сууриас хэтрэхгүй (сүүлийн сард үлдэгдлээр).

export interface FixedAssetRef {
  id: string;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  /** YYYY-MM — элэгдэл эхлэх сар. */
  depreciationStartMonth: string | null;
  status: string;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function monthlyDepreciation(asset: FixedAssetRef) {
  if (asset.usefulLifeMonths <= 0) return 0;
  return round2((asset.cost - asset.salvageValue) / asset.usefulLifeMonths);
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
    const monthly = monthlyDepreciation(asset);
    if (monthly <= 0) continue;
    const base = round2(asset.cost - asset.salvageValue);
    const accum = input.postedAccum.get(asset.id) ?? 0;
    const remaining = round2(base - accum);
    if (remaining <= 0) continue; // бүрэн элэгдсэн
    results.push({
      assetId: asset.id,
      amount: Math.min(monthly, remaining),
    });
  }
  return results;
}

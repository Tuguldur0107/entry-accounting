// Ээлж хаалтын кассын зөрүүний босго (SIM2-036) — ЦЭВЭР, CLIENT-SAFE.
// Том зөрүү = |тоолсон − систем| > max(10,000₮, системийн 1%). Кассчин буруу
// тоо бичсэн ч шууд зардалд ордог байв — одоо давсан бол «Дахин тоолох /
// менежерийн баталгаажуулалт» (pos:post эрх) шаардана.

export const SHIFT_VARIANCE_MIN_MNT = 10_000;
export const SHIFT_VARIANCE_PERCENT = 1;

export function shiftVarianceThreshold(systemCash: number): number {
  return Math.max(SHIFT_VARIANCE_MIN_MNT, (Math.abs(systemCash) * SHIFT_VARIANCE_PERCENT) / 100);
}

export function isLargeShiftVariance(systemCash: number, countedCash: number): boolean {
  return Math.abs(countedCash - systemCash) > shiftVarianceThreshold(systemCash);
}

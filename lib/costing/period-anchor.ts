// Периодын өртгийн тооцооллын ЗАНГУУ — хаагдсан үеийн хадгалагдсан үр дүнгээс
// үргэлжлүүлэх (snapshot + delta-гийн өртгийн хувилбар). ЦЭВЭР функцүүд —
// тест: tests/periodic-costing-anchor.test.ts.
//
// Дүрэм: хаагдсан период руу бараа хөдөлгөөн/өртгийн бичилт хийх хориотой
// (assertPeriodOpen) тул хаагдсан үеийн cost_period_results нь ЭЦСИЙН — гэхдээ
// зөвхөн хаалтын ДАРАА тооцоологдсон бол (хаахаас өмнөх тооцоолол хаалтын
// өмнөх сүүлийн бичилтийг агуулаагүй байж болно). Тиймээс зангуу P нь:
//   • эхний хөдөлгөөний сараас P хүртэл БҮГД хаагдсан (тасралтгүй урьдал),
//   • P-д хадгалагдсан мөр байгаа, тэдгээрийн calculated_at ≥ P хүртэлх
//     хаалтуудын хамгийн сүүлийн closedAt.
// Зангуу байхгүй бол бүрэн дахин тооцоолол (correct by construction).

import { nextPeriodCode } from "@/lib/periods/period";
import { scopeKey, type OpeningBalance } from "./periodic";

export interface ClosedPeriodRef {
  code: string;
  closedAt: Date | null;
}

export interface PeriodResultMeta {
  /** Тухайн периодод хадгалагдсан мөрийн тоо. */
  rows: number;
  /** Тэдгээрийн хамгийн эрт calculatedAt. */
  minCalculatedAt: Date;
}

/** Эхний сараас эхлэн тасралтгүй хаагдсан периодууд (өсөх дараалалтай). */
export function contiguousClosedPrefix(
  firstCode: string,
  closed: ClosedPeriodRef[]
): ClosedPeriodRef[] {
  const byCode = new Map(closed.map((period) => [period.code, period]));
  const prefix: ClosedPeriodRef[] = [];
  let cursor = firstCode;
  for (let guard = 0; guard < 1200; guard += 1) {
    const period = byCode.get(cursor);
    if (!period) break;
    prefix.push(period);
    cursor = nextPeriodCode(cursor);
  }
  return prefix;
}

/**
 * Урьдлын дотроос ИТГЭЖ болох хамгийн сүүлийн период. Итгэх нөхцөл: мөртэй,
 * бөгөөд тооцоолол нь тэр хүртэлх бүх хаалтаас ХОЙШ хийгдсэн.
 */
export function pickCostingAnchor(
  prefix: ClosedPeriodRef[],
  metaByCode: Map<string, PeriodResultMeta>
): string | null {
  let anchor: string | null = null;
  let latestClose = 0;
  for (const period of prefix) {
    latestClose = Math.max(latestClose, period.closedAt?.getTime() ?? 0);
    const meta = metaByCode.get(period.code);
    if (!meta || meta.rows === 0) continue;
    if (meta.minCalculatedAt.getTime() >= latestClose) anchor = period.code;
  }
  return anchor;
}

/**
 * Зангуу хүртэлх хүрээ бүрийн СҮҮЛИЙН мөрөөс дараагийн периодын C1.
 * Тооцоологдсон → {closingQty, closingAmount}; блоклогдсон → null (цуваа
 * цааш блоклогдоно). Мөргүй хүрээ = 0/0 (бүрэн тооцоололтой ижил).
 * Оролт: хүрээ бүрийн зангуу хүртэлх хамгийн сүүлийн мөр (DISTINCT ON).
 */
export function seedOpeningFromResults(
  rows: {
    itemId: string;
    warehouseId: string;
    status: string;
    closingQty: string | number;
    closingAmount: string | number | null;
  }[]
): Map<string, OpeningBalance | null> {
  const seed = new Map<string, OpeningBalance | null>();
  for (const row of rows) {
    const key = scopeKey(row.itemId, row.warehouseId);
    seed.set(
      key,
      row.status === "calculated" && row.closingAmount !== null
        ? { qty: Number(row.closingQty), amount: Number(row.closingAmount) }
        : null
    );
  }
  return seed;
}

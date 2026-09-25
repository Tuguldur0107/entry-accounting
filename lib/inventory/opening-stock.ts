// Нээлтийн барааны үлдэгдлийг ӨРТӨГТЭЙ оруулах (SIM2-007 / ENT-003) — ЦЭВЭР
// (tests/opening-stock.test.ts). DB-гүй тул client (Excel импортын урьдчилсан
// шалгалт) ч дуудна.
//
// Шийдвэр (docs/cost README 1.0, product owner 2026-09-25):
//   D-OS-1 — GL-д бичнэ: Dr барааны нөөц (costing_item_settings) / Cr нээлтийн
//            зөрүүний данс (44000098 «Нээлтийн үлдэгдлийн зөрүү»). Нээлтийн
//            журнал барааг ДАХИН оруулахгүй (onboarding R8) — 44000098 тэгширнэ.
//   D-OS-2 — нээлтийн огноо нь байгууллагын НЭЭЛТИЙН БУС анхны барааны
//            хөдөлгөөнөөс ХОЖУУ байж болохгүй: хэрэгслийг PO/АП-г тойрсон
//            «өртөгтэй орлого»-ын арын хаалга болгохгүй.

export const OPENING_STOCK_SOURCE_TYPE = "opening";
export const OPENING_VALUATION_SOURCE = "opening";
export const OPENING_STOCK_REF_PREFIX = "opening-stock:";
export const OPENING_STOCK_MAX_LINES = 1000;

export interface OpeningStockInputLine {
  itemCode: string;
  warehouseCode: string;
  quantity: number;
  unitCost: number;
}

export interface OpeningStockPlannedLine extends OpeningStockInputLine {
  /** Оролтын мөрийн дугаар (1-ээс) — алдааг хэрэглэгчид мөрөөр нь харуулна. */
  row: number;
  /** quantity × unitCost, 0.01-ээр бөөрөнхийлсөн — GL-д бичигдэх дүн. */
  amount: number;
}

export type OpeningStockPlan =
  | { ok: true; lines: OpeningStockPlannedLine[]; totalAmount: number }
  | { ok: false; errors: string[] };

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Мөрүүдийг шалгаж дүнг бодно. Бараа×агуулах давхардвал ТАТГАЛЗАНА — аль
 * өртгийг авахыг таахгүй (нэгтгэвэл нэгж өртөг холилдоно). Нэгж өртөг 0 бол
 * ТАТГАЛЗАНА — үнэ зохиохгүй; өртөг мэдэгдэхгүй бол `create_inventory_movement`
 * (өртөггүй орлого) → /costing «үнэ хүлээж байгаа» зам хэвээр (onboarding R3).
 */
export function planOpeningStock(lines: OpeningStockInputLine[]): OpeningStockPlan {
  const errors: string[] = [];
  if (lines.length === 0) return { ok: false, errors: ["Мөр алга"] };
  if (lines.length > OPENING_STOCK_MAX_LINES)
    return { ok: false, errors: [`Нэг удаад ${OPENING_STOCK_MAX_LINES}-аас ихгүй мөр`] };
  const seen = new Map<string, number>();
  const planned: OpeningStockPlannedLine[] = [];
  lines.forEach((line, index) => {
    const row = index + 1;
    const itemCode = (line.itemCode ?? "").trim();
    const warehouseCode = (line.warehouseCode ?? "").trim();
    const quantity = Number(line.quantity);
    const unitCost = Number(line.unitCost);
    const problems: string[] = [];
    if (!itemCode) problems.push("барааны код хоосон");
    if (!warehouseCode) problems.push("агуулахын код хоосон");
    if (!Number.isFinite(quantity) || quantity <= 0) problems.push("тоо хэмжээ 0-ээс их байна");
    if (!Number.isFinite(unitCost) || unitCost <= 0)
      problems.push("нэгж өртөг 0-ээс их байна (өртөг мэдэгдэхгүй бол өртөггүй орлогоор)");
    const key = `${itemCode.toUpperCase()}|${warehouseCode.toUpperCase()}`;
    const previous = seen.get(key);
    if (itemCode && warehouseCode && previous)
      problems.push(`${itemCode} × ${warehouseCode} ${previous}-р мөртэй давхардсан`);
    if (itemCode && warehouseCode && !previous) seen.set(key, row);
    if (problems.length > 0) {
      errors.push(`${row}-р мөр: ${problems.join(", ")}`);
      return;
    }
    const amount = round2(quantity * unitCost);
    if (amount < 0.01) {
      errors.push(`${row}-р мөр: дүн 0.01₮-өөс бага`);
      return;
    }
    planned.push({ row, itemCode, warehouseCode, quantity, unitCost, amount });
  });
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    lines: planned,
    totalAmount: round2(planned.reduce((sum, line) => sum + line.amount, 0)),
  };
}

/**
 * D-OS-2: нээлтийн огноо нь нээлтийн БУС анхны хөдөлгөөний огнооноос хожуу
 * бол алдааны текст, эс бөгөөс null. Ижил өдөр зөвшөөрнө (cut-off өдрийн
 * нээлт + тэр өдрийн гүйлгээ).
 */
export function openingStockDateProblem(
  date: string,
  firstOtherMovementDate: string | null
): string | null {
  if (firstOtherMovementDate && date > firstOtherMovementDate)
    return `[OPENING_AFTER_ACTIVITY] Нээлтийн огноо ${date} нь анхны барааны гүйлгээ (${firstOtherMovementDate})-ээс хожуу — нээлтийн үлдэгдэл бусад гүйлгээнээс ӨМНӨ байна. Дараа ирсэн өртөгтэй барааг PO / өглөгийн нэхэмжлэхээр оруулна`;
  return null;
}

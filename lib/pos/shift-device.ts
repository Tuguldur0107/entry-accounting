// Ээлж нээх цонхны ТӨХӨӨРӨМЖИЙН санамж — ЦЭВЭР (tests/pos-shift-device.test.ts).
//
// Олон салбартай байгууллагад салбар бүрийн кассын PC өөрийн касс / агуулахаа
// сонгох ёстой. Байгууллагын «сүүлийн ээлж» (lastShift) нь аль ч төхөөрөмжийнх
// байж болох тул ганцаараа хангалтгүй — салбар-2-ын PC салбар-1-ийн кассыг санал
// болгож, кассчин андуурч нээх эрсдэлтэй. Тиймээс энэ төхөөрөмж дээр сүүлд
// НЭЭСЭН касс + агуулахыг localStorage-д санаж, анхдагчаар түрүүлж сонгоно.
//
// Нэг төхөөрөмжөөр олон байгууллагад ажиллаж болох тул сүүлийн хэдэн сонголтыг
// жагсаалтаар хадгалж, тухайн байгууллагын жагсаалтад ХОЁУЛАА байгаа эхнийхийг
// авна (ID-ууд байгууллага хооронд давхцахгүй). Энэ нь зөвхөн UI-ийн анхдагч —
// сервер (`openShift`) касс / агуулахыг өөрөө шалгана.

export const SHIFT_DEVICE_STORAGE_KEY = "ea-pos-shift-device";
export const SHIFT_DEVICE_MAX_ENTRIES = 10;

export interface ShiftDevicePick {
  cashAccountId: string;
  warehouseId: string;
}

function isPick(value: unknown): value is ShiftDevicePick {
  if (!value || typeof value !== "object") return false;
  const pick = value as Record<string, unknown>;
  return (
    typeof pick.cashAccountId === "string" &&
    pick.cashAccountId.length > 0 &&
    typeof pick.warehouseId === "string" &&
    pick.warehouseId.length > 0
  );
}

/** localStorage-ийн утга (JSON parse хийсэн) → хүчинтэй сонголтууд, шинэ нь эхэндээ. */
export function parseShiftDevicePicks(raw: unknown): ShiftDevicePick[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isPick)
    .map((pick) => ({ cashAccountId: pick.cashAccountId, warehouseId: pick.warehouseId }))
    .slice(0, SHIFT_DEVICE_MAX_ENTRIES);
}

/** Шинэ сонголтыг эхэнд нэмнэ — ижил кассын хуучин мөрийг хасна, дээд тоогоор таслана. */
export function rememberShiftDevicePick(picks: ShiftDevicePick[], pick: ShiftDevicePick): ShiftDevicePick[] {
  return [pick, ...picks.filter((entry) => entry.cashAccountId !== pick.cashAccountId)].slice(
    0,
    SHIFT_DEVICE_MAX_ENTRIES
  );
}

/**
 * Ээлж нээх цонхны анхдагч касс / агуулах. Дараалал:
 *   1. энэ төхөөрөмжийн сүүлийн сонголт (касс ба агуулах ХОЁУЛАА жагсаалтад байвал)
 *   2. байгууллагын сүүлийн ээлж / тохиргооны анхдагч (тус бүр жагсаалтад байвал)
 *   3. жагсаалтын эхнийх
 */
export function pickShiftDefaults(input: {
  devicePicks: ShiftDevicePick[];
  cashAccountIds: string[];
  warehouseIds: string[];
  fallbackCashAccountId?: string | null;
  fallbackWarehouseId?: string | null;
}): { cashAccountId: string; warehouseId: string; fromDevice: boolean } {
  const cash = new Set(input.cashAccountIds);
  const warehouses = new Set(input.warehouseIds);
  const device = input.devicePicks.find((pick) => cash.has(pick.cashAccountId) && warehouses.has(pick.warehouseId));
  if (device) return { ...device, fromDevice: true };
  return {
    cashAccountId:
      input.fallbackCashAccountId && cash.has(input.fallbackCashAccountId)
        ? input.fallbackCashAccountId
        : (input.cashAccountIds[0] ?? ""),
    warehouseId:
      input.fallbackWarehouseId && warehouses.has(input.fallbackWarehouseId)
        ? input.fallbackWarehouseId
        : (input.warehouseIds[0] ?? ""),
    fromDevice: false,
  };
}

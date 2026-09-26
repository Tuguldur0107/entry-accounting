// eBarimt-ийн ДҮҮРЭГ / ХОРООНЫ кодын АЛБАН лавлах — ЦЭВЭР, CLIENT-SAFE (≈500 мөр).
//
// ӨГӨГДӨЛ: `district-codes.json` — PosAPI 3.0 мерчантын багцын `DISTRICT CODE.txt`
// (ТЕГ-ийн `getBranchInfo` хариу):
//   node scripts/build-ebarimt-districts.mjs "DISTRICT CODE.txt"
// Код = аймаг/дүүрэг (2 орон) + сум/хороо (2 орон): Баянзүрх 3-р хороо = 2403,
// Чингэлтэй 5-р хороо = 3505. Гараар бичихэд эдгээрийг андуурах нь амархан тул
// тохиргоо жагсаалтаас сонгуулна. ТЕГ шинэ хороо нэмдэг (жагсаалт хоцорч болно)
// тул жагсаалтад байхгүй 4 оронтой кодыг ЗӨВШӨӨРНӨ — зөвхөн «шалгаагүй» гэж ил
// тэмдэглэнэ, код ЗОХИОХГҮЙ. Серверээс `getBranchInfo`-г дуудахгүй: api.ebarimt.mn
// зөвхөн Монголын IP-д хариулдаг.

import { DISTRICT_CODE_RE } from "./constants";
import raw from "./district-codes.json";

export interface EbarimtDistrict {
  /** 4 оронтой eBarimt `districtCode`. */
  code: string;
  /** Аймаг / нийслэлийн дүүрэг. */
  district: string;
  /** Сум / хороо. */
  khoroo: string;
}

/** JSON-ийг шалгаж цэгцэлнэ — хэлбэр буруу мөрийг алгасна (код зохиохгүй). */
export function normalizeDistrictEntries(entries: readonly unknown[]): EbarimtDistrict[] {
  const seen = new Set<string>();
  const out: EbarimtDistrict[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code.trim() : "";
    const district = typeof record.district === "string" ? record.district.trim() : "";
    const khoroo = typeof record.khoroo === "string" ? record.khoroo.trim() : "";
    if (!DISTRICT_CODE_RE.test(code) || !district || !khoroo || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, district, khoroo });
  }
  return out;
}

export const EBARIMT_DISTRICTS: readonly EbarimtDistrict[] = normalizeDistrictEntries(raw as unknown[]);

const BY_CODE = new Map(EBARIMT_DISTRICTS.map((entry) => [entry.code, entry]));

export function findDistrict(code: string, list: readonly EbarimtDistrict[] = EBARIMT_DISTRICTS): EbarimtDistrict | null {
  const key = code.trim();
  if (list === EBARIMT_DISTRICTS) return BY_CODE.get(key) ?? null;
  return list.find((entry) => entry.code === key) ?? null;
}

/** «Баянзүрх · 3-р хороо»; жагсаалтад байхгүй бол null. */
export function districtLabel(code: string, list: readonly EbarimtDistrict[] = EBARIMT_DISTRICTS): string | null {
  const entry = findDistrict(code, list);
  return entry ? `${entry.district} · ${entry.khoroo}` : null;
}

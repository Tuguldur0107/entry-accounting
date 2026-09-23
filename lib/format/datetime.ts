// Огноо-цагийг Улаанбаатарын цагийн бүсээр (UTC+8) — ЦЭВЭР, client-safe
// (tests/datetime-format.test.ts). ENT-055: сар хаалт «2026-09-23T11:53»,
// хуулгын импорт «12:38» гэх мэт UTC-ээр харагдаж байв (бодит нь 20:38).

const FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ulaanbaatar",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "YYYY-MM-DD HH:mm" (Улаанбаатар). Хоосон/гажиг бол null. */
export function fmtDateTimeUb(value: Date | string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return FORMATTER.format(date).replace(",", "");
}

// Мөнгөн дүнгийн ТОВЧ формат — хуудасны гол тоонд (UI гайдын карт 6, 9).
// ЦЭВЭР, client-safe (tests/money-format.test.ts). Бүтэн дүн нь `fmtMnt`
// (2 орон) хэвээр — товч хэлбэр нь зөвхөн харагдац, hover/title-д бүтнээр.

const UNITS: { min: number; divisor: number; suffix: string; digits: number }[] = [
  { min: 1e9, divisor: 1e9, suffix: "тэрбум", digits: 2 },
  { min: 1e6, divisor: 1e6, suffix: "сая", digits: 2 },
  { min: 1e4, divisor: 1e3, suffix: "мянга", digits: 1 },
];

function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** 13_952_730 → "13.95 сая ₮"; 950_000 → "950 мянга ₮"; 8_500 → "8,500 ₮"; сөрөг «−». */
export function fmtMntCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  const unit = UNITS.find((candidate) => abs >= candidate.min);
  if (!unit) {
    return `${sign}${Math.round(abs).toLocaleString("en-US")} ₮`;
  }
  const scaled = trimZeros((abs / unit.divisor).toFixed(unit.digits));
  return `${sign}${scaled} ${unit.suffix} ₮`;
}

/** Уншигдах хүснэгтийн дүн — 0 бол «—» (UI гайдын карт 9). */
export function moneyOrDash(value: number, format: (value: number) => string): string {
  return Math.abs(value) < 0.005 ? "—" : format(value);
}

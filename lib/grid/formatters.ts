import { fmtMnt } from "@/lib/reports/balances";
import { fmtAccountDisplay as fmtAccountDisplayImpl } from "./segments";

export { fmtMnt };
export { fmtAccountDisplay } from "./segments";

// Locale-tolerant money parser: accepts "1,234.50", "1 234,50", "1234.5", "₮ 99.00".
export function parseMntInput(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (raw == null) return NaN;
  const s = String(raw)
    .replace(/[₮\s]/g, "")
    .replace(/,(?=\d{3}(?:\D|$))/g, "");
  const dotCount = (s.match(/\./g) || []).length;
  const commaCount = (s.match(/,/g) || []).length;
  let normalized = s;
  if (commaCount === 1 && dotCount === 0) normalized = s.replace(",", ".");
  else if (commaCount >= 1 && dotCount >= 1) normalized = s.replace(/,/g, "");
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export function moneyValueFormatter(params: { value: unknown }): string {
  const v = params.value;
  if (v == null || v === "") return "";
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n === 0) return "";
  return fmtMnt(n);
}

export function accountValueFormatter(activeSegIds: number[]) {
  return (params: { value: unknown }) =>
    fmtAccountDisplayImpl(String(params.value ?? ""), activeSegIds);
}

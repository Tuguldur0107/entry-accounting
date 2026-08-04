// Shared segment helpers — lifted out of journal-entry-form for reuse by
// grid editors, clipboard parser, valueFormatters, and validators.
//
// Сегментийн систем (хатуу стандарт):
//   - WRITE: код үргэлж 10-part dotted. БҮХ сегмент бөглөгдөнө — бичигдээгүй
//     (идэвхгүй ЭСВЭЛ идэвхтэй ч сонгоогүй) сегмент оронгийн тоогоор "0"
//     утга авна. Онцгой: S3 үндсэн данс default-гүй (заавал сонгоно),
//     S9 модулийн тэмдэг default нь "GL".
//   - READ/DISPLAY: зөвхөн идэвхтэй сегментүүд харагдана. Идэвхгүй байсан
//     сегментийг идэвхжүүлэхэд хуучин дата "0…0" утгатайгаа шууд харагдана —
//     migration шаардлагагүй.

import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";

export const ALL_SEG_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * Сегмент бүрийн default утга — SEGMENT_DEFS-ийн оронгийн тооноос гарна
 * (ЦОРЫН ГАНЦ эх сурвалж). S3 = "" (үндсэн данс заавал), S9 = "GL".
 */
export const SEG_DEFAULTS: Record<number, string> = Object.fromEntries(
  SEGMENT_DEFS.map((def) => [
    def.id,
    def.id === 3 ? "" : def.id === 9 ? "GL" : "0".repeat(def.length),
  ])
);

// Pull active-segment values out of a stored 10-part (or legacy partial) code.
// Migration-өөс өмнө хадгалагдсан хоосон хэсгүүд default утгаараа уншигдана —
// идэвхжүүлсэн сегмент хуучин дата дээр ч "0…0" гэж харагдана.
export function parseSegParts(
  code: string,
  activeSegIds: number[]
): Record<number, string> {
  const parts = code.split(".");
  if (parts.length === 10) {
    return Object.fromEntries(
      activeSegIds.map((id) => {
        const raw = parts[id - 1] ?? "";
        return [id, raw !== "" ? raw : (SEG_DEFAULTS[id] ?? "")];
      })
    );
  }
  // Legacy partial code: positional mapping
  return Object.fromEntries(activeSegIds.map((id, i) => [id, parts[i] ?? ""]));
}

// Always emit a full 10-segment dotted code. Every position is filled:
// inactive AND unfilled-active positions take their default (zeros by
// length). `extraDefaults` lets callers pin e.g. company segment.
export function buildSegCode(
  activeParts: Record<number, string>,
  activeSegIds: number[],
  extraDefaults: Record<number, string> = {}
): string {
  return ALL_SEG_IDS.map((id) => {
    if (activeSegIds.includes(id)) {
      const value = activeParts[id] ?? "";
      if (value !== "") return value;
    }
    return extraDefaults[id] ?? SEG_DEFAULTS[id] ?? "";
  }).join(".");
}

// Active-only display. Данс (S3) сонгогдоогүй бол бүхэлдээ хоосон харагдана —
// хоосон мөр "000.000000.…" гэж дүүрч харагдахаас сэргийлнэ.
export function fmtAccountDisplay(code: string, activeSegIds: number[]): string {
  if (!code) return "";
  const parts = parseSegParts(code, activeSegIds);
  if (activeSegIds.includes(3) && (parts[3] ?? "") === "") return "";
  return activeSegIds
    .map((id) => parts[id] ?? "")
    .filter((p) => p !== "")
    .join(".");
}

/**
 * Идэвхтэй сегментийн сонголтод үргэлж байх "Ерөнхий" (0-default) сонголт.
 * S3-д хамаарахгүй (үндсэн данс заавал бодит утгатай).
 */
export function withSegDefaultOption<T extends { code: string; name: string }>(
  segId: number,
  options: T[]
): (T | { code: string; name: string })[] {
  const def = segId === 3 ? "" : (SEG_DEFAULTS[segId] ?? "");
  if (!def) return options;
  if (options.some((option) => option.code === def)) return options;
  return [{ code: def, name: "Ерөнхий (default)" }, ...options];
}

// Inverse of fmtAccountDisplay for paste: accepts either a 10-part dotted code
// OR an active-only N-part code, returns a normalized full 10-part code.
export function normalizePastedAccount(
  raw: string,
  activeSegIds: number[],
  extraDefaults: Record<number, string> = {}
): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(".");
  if (parts.length === 10) {
    // Хуучин форматын (хоосон хэсэгтэй) кодыг 0-default-аар дүүргэнэ —
    // S3 үндсэн данс л хоосон байж болно.
    return parts
      .map((part, index) => {
        if (part !== "" || index === 2) return part;
        const id = index + 1;
        return extraDefaults[id] ?? SEG_DEFAULTS[id] ?? "";
      })
      .join(".");
  }
  if (parts.length === activeSegIds.length) {
    const map = Object.fromEntries(activeSegIds.map((id, i) => [id, parts[i]]));
    return buildSegCode(map, activeSegIds, extraDefaults);
  }
  if (parts.length === 1 && /^\d{8}$/.test(trimmed) && activeSegIds.includes(3)) {
    return buildSegCode({ 3: trimmed }, activeSegIds, extraDefaults);
  }
  return trimmed;
}

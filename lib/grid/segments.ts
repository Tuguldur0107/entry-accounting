// Shared segment helpers — lifted out of journal-entry-form for reuse by
// grid editors, clipboard parser, valueFormatters, and validators.
//
// Honors the segment system rule:
//   - On WRITE: code is always a 10-part dotted string. Inactive segments are
//     padded with SEG_DEFAULTS (mostly "0"). Active segments come from user
//     input.
//   - On READ/DISPLAY: only active segments are shown.

export const ALL_SEG_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export const SEG_DEFAULTS: Record<number, string> = {
  1: "",
  2: "",
  3: "",
  4: "",
  5: "",
  6: "000",
  7: "0000",
  8: "",
  9: "GL",
  10: "0",
};

// Pull active-segment values out of a stored 10-part (or legacy partial) code.
export function parseSegParts(
  code: string,
  activeSegIds: number[]
): Record<number, string> {
  const parts = code.split(".");
  if (parts.length === 10) {
    return Object.fromEntries(activeSegIds.map((id) => [id, parts[id - 1] ?? ""]));
  }
  // Legacy partial code: positional mapping
  return Object.fromEntries(activeSegIds.map((id, i) => [id, parts[i] ?? ""]));
}

// Always emit a full 10-segment dotted code. Inactive positions take their
// default. `extraDefaults` lets callers pin e.g. company segment at write time.
export function buildSegCode(
  activeParts: Record<number, string>,
  activeSegIds: number[],
  extraDefaults: Record<number, string> = {}
): string {
  return ALL_SEG_IDS.map((id) => {
    if (activeSegIds.includes(id)) return activeParts[id] ?? "";
    return extraDefaults[id] ?? SEG_DEFAULTS[id] ?? "";
  }).join(".");
}

// Active-only display: drops inactive segments and any blank actives.
export function fmtAccountDisplay(code: string, activeSegIds: number[]): string {
  if (!code) return "";
  const parts = parseSegParts(code, activeSegIds);
  return activeSegIds
    .map((id) => parts[id] ?? "")
    .filter((p) => p !== "")
    .join(".");
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
  if (parts.length === 10) return trimmed;
  if (parts.length === activeSegIds.length) {
    const map = Object.fromEntries(activeSegIds.map((id, i) => [id, parts[i]]));
    return buildSegCode(map, activeSegIds, extraDefaults);
  }
  if (parts.length === 1 && /^\d{8}$/.test(trimmed) && activeSegIds.includes(3)) {
    return buildSegCode({ 3: trimmed }, activeSegIds, extraDefaults);
  }
  return trimmed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Сегментийн кодын НЭГДСЭН ЭХ СУРВАЛЖ (single source of truth)
//
// 10 сегментийн composite код бол: S1.S2.S3.S4.S5.S6.S7.S8.S9.S10
// Дүрэм (knowledge/03-стандарт/segment-coding-rules.md, segment-strategy.md §7):
//
//   1) Хадгалах код ҮРГЭЛЖ бүтэн 10 хэсэгтэй байна.
//   2) Идэвхтэй + утгатай сегмент   → хэрэглэгчийн утга.
//   3) Идэвхтэй ч хоосон ҮЛДСЭН      → орон тоогоор нь ТЭГ (default).
//      Идэвхгүй (унтарсан) сегмент    → орон тоогоор нь ТЭГ (default).
//      (S9 Модуль бол тэг биш — модулийн код, default "GL".)
//   4) Тайлан тодорхой сегментийг ашиглаагүй бол → тэр сегментийн бүх утгыг
//      НИЙЛБЭРЛЭНЭ (тухайн сегментээр group хийхгүй).
//
// Бүх журнал/тайлан/форм энэ модулийн функцуудыг ЗААВАЛ ашиглана. Хуваагдсан
// логик бичихийг хориглоно (CLAUDE.md "Сегментийн код" дүрэм).
// ─────────────────────────────────────────────────────────────────────────────

import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";

export const ALL_SEGMENT_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** Үндсэн данс (Chart of Accounts) байрлах сегмент. */
export const MAIN_ACCOUNT_SEGMENT = 3;
/** Модулийн сегмент — системээр автомат тавигдана, хэзээ ч тэг биш. */
export const MODULE_SEGMENT = 9;
/** GL гар бичилтийн default модулийн код. */
export const DEFAULT_MODULE_CODE = "GL";

const LENGTHS: Record<number, number> = Object.fromEntries(
  SEGMENT_DEFS.map((d) => [d.id, d.length])
);

export function segmentLength(id: number): number {
  return LENGTHS[id] ?? 1;
}

/** Сегментийн default (тэг) утга — орон тоогоор нь. S9 → модулийн код. */
export function defaultSegmentValue(id: number): string {
  if (id === MODULE_SEGMENT) return DEFAULT_MODULE_CODE;
  return "0".repeat(segmentLength(id));
}

/** Сегментийн утга нь "тэг" (бүх орон 0) эсэхийг шалгана. */
export function isZeroSegment(value: string): boolean {
  return value === "" || /^0+$/.test(value);
}

/**
 * Бүтэн 10 хэсэгт composite код угсарна.
 * - Идэвхтэй + утгатай → утга
 * - Идэвхтэй ч хоосон / идэвхгүй → орон тоогоор нь тэг (эсвэл extraDefaults)
 */
export function buildSegmentCode(
  activeParts: Record<number, string>,
  activeSegIds: number[],
  extraDefaults: Record<number, string> = {}
): string {
  return ALL_SEGMENT_IDS.map((id) => {
    if (activeSegIds.includes(id)) {
      const v = (activeParts[id] ?? "").trim();
      if (v) return v;
    }
    const ex = (extraDefaults[id] ?? "").trim();
    if (ex) return ex;
    return defaultSegmentValue(id);
  }).join(".");
}

/**
 * Хадгалсан кодыг идэвхтэй сегментийн утгууд болгож задална.
 * 10-хэсэгт → байрлалаар; 1-хэсэгт (plain данс) → зөвхөн S3; бусад → дарааллаар.
 */
export function parseSegmentCode(
  code: string,
  activeSegIds: number[]
): Record<number, string> {
  const parts = code.split(".");
  if (parts.length === 10) {
    return Object.fromEntries(
      activeSegIds.map((id) => [id, parts[id - 1] ?? ""])
    );
  }
  if (parts.length === 1) {
    return Object.fromEntries(
      activeSegIds.map((id) => [id, id === MAIN_ACCOUNT_SEGMENT ? parts[0] : ""])
    );
  }
  return Object.fromEntries(activeSegIds.map((id, i) => [id, parts[i] ?? ""]));
}

/**
 * Аливаа кодоос үндсэн данс (S3)-ийг гаргаж авна.
 * composite (10), plain (1), эсвэл legacy (8-оронт хэсгийг хайна) бүгдийг дэмжинэ.
 */
export function extractMainAccount(code: string): string {
  const parts = code.split(".");
  if (parts.length === 10) return parts[2];
  if (parts.length === 1) return parts[0];
  const eight = parts.find((p) => /^\d{8}$/.test(p));
  return eight ?? parts[0] ?? code;
}

/** Дэлгэцэнд харуулах: зөвхөн идэвхтэй сегментүүдийг "." -аар холбоно. */
export function formatSegmentDisplay(code: string, activeSegIds: number[]): string {
  const parts = code.split(".");
  if (parts.length === 10) {
    return activeSegIds.map((id) => parts[id - 1] ?? "").join(".");
  }
  return code;
}

/**
 * Идэвхтэй сегментийн жагсаалт. S3 ҮРГЭЛЖ идэвхтэй; бусад нь тодорхой
 * унтраагаагүй бол идэвхтэй (тохиргоо байхгүй → идэвхтэй гэж үзнэ).
 * Бүх хуудас (журнал, тайлан, форм, тохиргоо) ЭНЭ функцийг ашиглана.
 */
export function computeActiveSegIds(
  configs: { segmentId: number; isEnabled: boolean }[]
): number[] {
  const map = new Map(configs.map((c) => [c.segmentId, c.isEnabled]));
  return SEGMENT_DEFS.filter(
    (d) => d.id === MAIN_ACCOUNT_SEGMENT || (map.get(d.id) ?? true)
  ).map((d) => d.id);
}

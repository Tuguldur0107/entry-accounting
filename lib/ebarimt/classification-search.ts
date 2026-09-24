// eBarimt — БАРАА, ҮЙЛЧИЛГЭЭНИЙ АНГИЛЛЫН КОД (7 орон) хайлт — ЦЭВЭР, client-safe.
//
// Эх сурвалж: ҮСХ «Бүтээгдэхүүн, үйлчилгээний нэгдсэн ангилал» (БҮНА, НҮБ-ын
// CPC Ver.2.1 дээр суурилсан; 5 оронтой CPC дэд анги + 2 оронтой үндэсний
// задаргаа — ж: 6331000 ← CPC 63310). Албан жагсаалт нь ТЕГ-ийн мерчант
// багцад (Angilal/*.pdf) ирдэг; `scripts/extract-buna-pdf.py` →
// `scripts/build-ebarimt-classifications.mjs` → `classification-codes.json`.
//
// Код ЗОХИОХГҮЙ: жагсаалтад байхгүй 7 оронтой кодыг хэрэглэгч бичиж болно
// (ТЕГ шинэ код нэмдэг) — хайлт зөвхөн САНАЛ болгоно, хориглохгүй.

import { CLASSIFICATION_CODE_RE } from "./constants";

export interface ClassificationEntry {
  code: string;
  name: string;
}

export interface ClassificationMatch extends ClassificationEntry {
  /** "official" = албан жагсаалтаас, "org" = байгууллага өөрөө хэрэглэж байгаа. */
  source: "official" | "org";
  /** org: хаана хэрэглэгдсэн (ж: «3 бараа · Хүнс ангилал»). */
  usage?: string;
}

export const CLASSIFICATION_SEARCH_LIMIT = 50;

/**
 * Түүхий мөрүүдийг цэвэрлэнэ: 7 оронтой кодтой, нэртэй мөр л үлдэнэ;
 * давхардсан кодоос ЭХНИЙХ нь; кодоор эрэмбэлнэ.
 */
export function normalizeClassificationEntries(
  rows: readonly { code?: unknown; name?: unknown }[]
): ClassificationEntry[] {
  const byCode = new Map<string, ClassificationEntry>();
  for (const row of rows) {
    const code = String(row.code ?? "").trim();
    const name = String(row.name ?? "").replace(/\s+/g, " ").trim();
    if (!CLASSIFICATION_CODE_RE.test(code) || !name) continue;
    if (!byCode.has(code)) byCode.set(code, { code, name });
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Хайлт: (1) яг код → (2) кодын эхлэл → (3) нэрэнд БҮХ үг агуулагдсан.
 * Хоосон хайлт → эхний `limit`. Том/жижиг үсэг хамаарахгүй.
 */
export function searchClassifications(
  entries: readonly ClassificationEntry[],
  query: string,
  limit = CLASSIFICATION_SEARCH_LIMIT
): ClassificationEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries.slice(0, limit);
  const digits = /^\d+$/.test(needle);
  const exact: ClassificationEntry[] = [];
  const prefix: ClassificationEntry[] = [];
  const byName: ClassificationEntry[] = [];
  // Нэрийн таарцад оноо: бүтэн ҮГ (3) > үгийн ЭХЛЭЛ (1) > дэд мөр (0), нэр
  // эхний үгээр эхэлбэл +1. Үгүй бол «ус» → «Бусад…», «сүү» → «Бэрсүүт…»,
  // «архи» → «Архитектур…» мянган мөрийн эхэнд гарч жинхэнэ бараа дарагдана.
  const scored: { entry: ClassificationEntry; score: number }[] = [];
  const words = needle.split(/\s+/).filter(Boolean);
  for (const entry of entries) {
    if (entry.code === needle) exact.push(entry);
    else if (digits && entry.code.startsWith(needle)) prefix.push(entry);
    else {
      const name = entry.name.toLowerCase();
      if (!words.every((word) => name.includes(word) || entry.code.includes(word))) continue;
      const tokens = name.split(/[^0-9a-zа-яөүё]+/i).filter(Boolean);
      let score = name.startsWith(words[0]) ? 1 : 0;
      for (const word of words) {
        if (tokens.includes(word)) score += 3;
        else if (tokens.some((token) => token.startsWith(word))) score += 1;
      }
      scored.push({ entry, score });
    }
  }
  // sort нь тогтвортой — ижил оноонд кодын дараалал хадгалагдана
  byName.push(...scored.sort((a, b) => b.score - a.score).map((item) => item.entry));
  return [...exact, ...prefix, ...byName].slice(0, limit);
}

/** Код → нэр (жагсаалтаас); байхгүй бол null. */
export function classificationName(
  entries: readonly ClassificationEntry[],
  code: string | null | undefined
): string | null {
  const trimmed = code?.trim();
  if (!trimmed) return null;
  return entries.find((entry) => entry.code === trimmed)?.name ?? null;
}

/**
 * Албан жагсаалт + байгууллагын хэрэглэж буй кодыг НЭГ жагсаалт болгоно.
 * Албан нэр давамгайлна; жагсаалтад байхгүй org кодыг «(жагсаалтад алга)»
 * гэж ил тэмдэглэнэ — хэрэглэгч шалгах боломжтой.
 */
export function mergeClassificationMatches(
  official: readonly ClassificationEntry[],
  orgUsed: readonly { code: string; usage: string }[],
  query: string,
  limit = CLASSIFICATION_SEARCH_LIMIT
): ClassificationMatch[] {
  const result: ClassificationMatch[] = official.map((entry) => ({ ...entry, source: "official" as const }));
  const seen = new Map(result.map((entry, index) => [entry.code, index]));
  const needle = query.trim().toLowerCase();
  for (const used of orgUsed) {
    if (!CLASSIFICATION_CODE_RE.test(used.code)) continue;
    if (needle && !used.code.includes(needle) && !used.usage.toLowerCase().includes(needle)) continue;
    const index = seen.get(used.code);
    if (index != null) {
      result[index] = { ...result[index], usage: used.usage };
      continue;
    }
    seen.set(used.code, result.length);
    result.push({ code: used.code, name: "(албан жагсаалтад алга)", source: "org", usage: used.usage });
  }
  return result.slice(0, limit);
}

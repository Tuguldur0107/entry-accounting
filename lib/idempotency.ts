// Idempotency түлхүүр (`externalRef`) — ЦЭВЭР (DB импортгүй, тесттэй).
//
// AI/MCP/REST дуудагч сүлжээ тасарвал ижил хүсэлтийг ДАХИН илгээдэг. Ижил
// `externalRef`-тэй хоёр дахь дуудлага шинэ бичилт үүсгэхгүй, анхныхыг
// `dedup`-тайгаар буцаана (docs/ontology-audit.md §4.2, H2). Хэв маяг:
//   1. урьдчилж хайна → байвал буцаана;
//   2. insert — (organization_id, external_ref) partial unique index нь
//      ЗЭРЭГЦЭЭ дуудлагыг барина;
//   3. `isExternalRefConflict` бол дахин хайж анхныхыг буцаана.

/** Дээд урт — гадаад системийн ID, UUID, `prefix:<id>:<огноо>` багтана. */
export const EXTERNAL_REF_MAX_LENGTH = 200;

/** Хоосон → null; хэт урт бол ил алдаа (таслахгүй — өөр ref-тэй мөргөлдөнө). */
export function cleanExternalRef(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  if (trimmed.length > EXTERNAL_REF_MAX_LENGTH)
    throw new Error(`[INVALID_EXTERNAL_REF] externalRef ${EXTERNAL_REF_MAX_LENGTH} тэмдэгтээс урт байна`);
  return trimmed;
}

/** Postgres unique violation (23505) нь `external_ref`-ийн индексээс үү. */
export function isExternalRefConflict(caught: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = caught;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const error = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    const constraint = String(error.constraint_name ?? error.constraint ?? "");
    const message = typeof error.message === "string" ? error.message : "";
    if (error.code === "23505" && /external_ref/.test(constraint || message)) return true;
    current = error.cause;
  }
  return false;
}

/**
 * Байгууллагаас ГАДУУРХ (organizations) түлхүүр — хэрэглэгчээр нэрийн
 * талбарлана: өөр хэрэглэгчийн ижил ref мөргөлдөхгүй, бусдын байгууллагыг
 * dedup-аар задлахгүй.
 */
export function userScopedExternalRef(userId: string, externalRef: string): string {
  return `user:${userId}:${externalRef}`;
}

// OAuth consent-ийн байгууллага сонголт — ЦЭВЭР (DB-гүй, тесттэй).
//
// Token нь НЭГ байгууллагад уягддаг (resolveApiToken / resolveOAuthAccessToken).
// Олон байгууллагатай хэрэглэгч Connect дарахад өмнө нь вэбийн идэвхтэй
// байгууллага (ea-org cookie) далдуур сонгогдож, AI БУРУУ компанид бичих эрсдэлтэй
// байсан. Одоо consent хуудас компаниа ИЛ сонгуулна; энэ функц формын утгыг
// хэрэглэгчийн гишүүнчлэлтэй тулгана.

export interface ConsentOrgOption {
  id: string;
  name: string;
}

/**
 * Формоос ирсэн байгууллагын id → баталгаажсан id, эсвэл null (татгалзана).
 *
 * - `requested` өгөгдсөн бол ЗААВАЛ гишүүнчлэлд байна — үгүй бол null
 *   (hidden/radio утгыг өөрчилсөн; өөр компани руу ДАЛДУУР унахгүй).
 * - Өгөөгүй бол: идэвхтэй байгууллага (гишүүн бол), эсвэл ганц гишүүнчлэл.
 *   Олон гишүүнчлэлтэй, сонголтгүй бол null — таамаглахгүй.
 */
export function resolveConsentOrg(
  requested: string | null | undefined,
  options: readonly ConsentOrgOption[],
  activeOrgId: string | null | undefined
): string | null {
  const ids = new Set(options.map((option) => option.id));
  const wanted = requested?.trim();
  if (wanted) return ids.has(wanted) ? wanted : null;
  if (activeOrgId && ids.has(activeOrgId)) return activeOrgId;
  return options.length === 1 ? options[0].id : null;
}

/** Consent хуудсанд анх тэмдэглэгдэх байгууллага — идэвхтэй нь, эс бөгөөс эхнийх. */
export function defaultConsentOrg(
  options: readonly ConsentOrgOption[],
  activeOrgId: string | null | undefined
): string | null {
  if (activeOrgId && options.some((option) => option.id === activeOrgId)) return activeOrgId;
  return options[0]?.id ?? null;
}

// Дэмжлэгийн хандалт (support access) — ЦЭВЭР логик, DB-гүй (тесттэй).
//
// Зорилго: платформын оператор (Entry Console-ийг удирддаг хүн) харилцагчийн
// байгууллагад ТҮР ХУГАЦААГААР орж асуудлыг нь шалгах. Апп дотор "супер админ"
// РОЛЬ ҮҮСГЭХГҮЙ (CLAUDE.md §billing — SaaS харилцагчийн удирдлага Console-д):
// хандалт бүр нь Console-оос олгогдсон, ХУГАЦААТАЙ, АУДИТАД БИЧИГДДЭГ нэг
// удаагийн линк — эрх нь хэрэглэгчид биш, СЕССЭД уягдана.
//
// Хоёр хугацаа:
//   линк  (issued → startedAt)  SUPPORT_LINK_TTL_MS   — ашиглагдаагүй линк удаан
//                                                       амьдрахгүй
//   сесс  (startedAt → endsAt)  SUPPORT_SESSION_TTL_MS — орсноос хойш
//
// Эрхийн түвшин ХОЁР л: `viewer` (ЗӨВХӨН унших — default) ба `admin` (бичилт,
// тохиргоо). `owner` ХЭЗЭЭ Ч олгогдохгүй — байгууллага устгах, эзэмшил шилжүүлэх
// нь харилцагчийн өөрийнх (requireRole("owner") support сессээр давагдахгүй).

/** Ашиглагдаагүй линк хүчинтэй хугацаа. */
export const SUPPORT_LINK_TTL_MS = 15 * 60_000; // 15 минут

/** Линк идэвхжсэнээс хойш сесс хүчинтэй хугацаа. */
export const SUPPORT_SESSION_TTL_MS = 60 * 60_000; // 1 цаг

/** Сессийн түлхүүрийг зөөх cookie (raw token — DB-д зөвхөн sha256). */
export const SUPPORT_COOKIE = "ea-support";

/** Аудитын entityType — харилцагч /settings/audit дээрээ ИЛ хардаг. */
export const SUPPORT_AUDIT_ENTITY = "support_session";

export const SUPPORT_ROLES = ["viewer", "admin"] as const;
export type SupportRole = (typeof SUPPORT_ROLES)[number];

export const SUPPORT_ROLE_LABELS: Record<SupportRole, string> = {
  viewer: "Зөвхөн унших",
  admin: "Бичих, тохиргоо (админ)",
};

export function isSupportRole(value: unknown): value is SupportRole {
  return typeof value === "string" && (SUPPORT_ROLES as readonly string[]).includes(value);
}

/**
 * Console-оос ирсэн түвшин. Өгөгдөөгүй бол ХАМГИЙН БОЛГООМЖТОЙ нь —
 * зөвхөн унших. Танигдахгүй утгыг ЧИМЭЭГҮЙ буулгахгүй, ШИДНЭ.
 */
export function parseSupportRole(value: unknown): SupportRole {
  if (value === undefined || value === null || value === "") return "viewer";
  if (!isSupportRole(value))
    throw new Error(`Хандалтын түвшин танигдсангүй: ${String(value)} (viewer | admin)`);
  return value;
}

export type SupportSessionTimes = {
  expiresAt: Date;
  startedAt: Date | null;
  endsAt: Date | null;
  endedAt: Date | null;
};

/** pending = линк хүлээгдэж байна · active = орсон · expired · ended */
export type SupportSessionState = "pending" | "active" | "expired" | "ended";

export function supportSessionState(
  row: SupportSessionTimes,
  now: Date = new Date()
): SupportSessionState {
  if (row.endedAt) return "ended";
  const t = now.getTime();
  if (!row.startedAt) return row.expiresAt.getTime() > t ? "pending" : "expired";
  if (!row.endsAt || row.endsAt.getTime() <= t) return "expired";
  return "active";
}

/** Сессээр хандаж болох эсэх — ганц цэгээс (cookie шалгалт үүгээр). */
export function isSupportSessionUsable(
  row: SupportSessionTimes,
  now: Date = new Date()
): boolean {
  return supportSessionState(row, now) === "active";
}

export function supportLinkExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SUPPORT_LINK_TTL_MS);
}

export function supportSessionExpiry(startedAt: Date): Date {
  return new Date(startedAt.getTime() + SUPPORT_SESSION_TTL_MS);
}

/** Баннерт "N минут үлдлээ" — дууссан/эхлээгүй бол 0. */
export function supportMinutesLeft(
  row: SupportSessionTimes,
  now: Date = new Date()
): number {
  if (!isSupportSessionUsable(row, now) || !row.endsAt) return 0;
  return Math.max(0, Math.ceil((row.endsAt.getTime() - now.getTime()) / 60_000));
}

/** Cookie-ийн `maxAge` (секунд) — сессийн үлдсэн хугацаанаас хэтрэхгүй. */
export function supportCookieMaxAge(endsAt: Date, now: Date = new Date()): number {
  return Math.max(1, Math.floor((endsAt.getTime() - now.getTime()) / 1000));
}

export function describeSupportRole(role: SupportRole): string {
  return SUPPORT_ROLE_LABELS[role];
}

/** Аудитын товч тайлбар — харилцагч хэн, хэзээ, ямар эрхээр орсныг хардаг. */
export function supportAuditSummary(input: {
  email: string | null;
  role: SupportRole;
  reason?: string | null;
  issuedBy?: string | null;
}): string {
  const parts = [
    `Дэмжлэгийн хандалт (${describeSupportRole(input.role)})`,
    input.email ? `· ${input.email}` : "",
    input.issuedBy ? `· ${input.issuedBy}` : "",
    input.reason?.trim() ? `· шалтгаан: ${input.reason.trim()}` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Console-оос ирсэн шалтгаан — хоосон бол null, хэт урт бол таслана. */
export function normalizeSupportReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, 300) : null;
}

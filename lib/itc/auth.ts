// ITC Нэвтрэлтийн нэгдсэн систем (Keycloak OpenID Connect) — ЦЭВЭР хэсэг:
// token URL, grant body, хариуны parse, хүчинтэй эсэх. Сүлжээ `client.ts`-д,
// хадгалалт (шифртэй) хожим DB давхаргад — token-ийн УТГА лог/аудит/health-д
// ХЭЗЭЭ Ч гарахгүй (QPay түлхүүртэй ижил зарчим, CLAUDE.md §5c).
// docs/integrations/00-itc-developer-portal.md §2. tests/itc-auth.test.ts.

import { ITC_AUTH, ITC_ERRORS, ITC_TOKEN_SKEW_MS, type ItcEnvironment } from "./constants";

export class ItcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "ItcError";
    this.code = code;
  }
}

export function isItcEnvironment(value: unknown): value is ItcEnvironment {
  return value === "staging" || value === "production";
}

/** Keycloak token endpoint — `{authBase}/auth/realms/{realm}/protocol/openid-connect/token`. */
export function itcTokenUrl(env: ItcEnvironment): string {
  const { authBase, realm } = ITC_AUTH[env];
  return `${authBase}/auth/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`;
}

/** `grant_type=password` — албан заавар (client нууцгүй public client). */
export function passwordGrantBody(input: { clientId: string; username: string; password: string }): string {
  const clientId = input.clientId.trim();
  const username = input.username.trim();
  if (!clientId) throw new ItcError(ITC_ERRORS.config, "client_id хоосон");
  if (!username || !input.password) throw new ItcError(ITC_ERRORS.config, "Нэвтрэх нэр / нууц үг хоосон");
  return new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    username,
    password: input.password,
  }).toString();
}

/** `grant_type=refresh_token` — access дуусахад дахин нэвтрэхгүй сунгана. */
export function refreshGrantBody(input: { clientId: string; refreshToken: string }): string {
  if (!input.clientId.trim()) throw new ItcError(ITC_ERRORS.config, "client_id хоосон");
  if (!input.refreshToken.trim()) throw new ItcError(ITC_ERRORS.auth, "refresh_token хоосон");
  return new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.clientId.trim(),
    refresh_token: input.refreshToken.trim(),
  }).toString();
}

export interface ItcToken {
  accessToken: string;
  /** Unix мс — access token дуусах мөч (хариуны expires_in-ээс). */
  expiresAt: number;
  refreshToken: string | null;
  refreshExpiresAt: number | null;
  tokenType: string;
  scope: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function seconds(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Keycloak-ийн token хариу → ItcToken. `access_token` байхгүй / хоосон бол ШИДНЭ
 * (Keycloak алдааны `error` / `error_description`-ийг мессежид). `now` — тестэд
 * тогтмол цаг өгөх.
 */
export function parseItcTokenResponse(json: unknown, now: number = Date.now()): ItcToken {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const accessToken = text(body.access_token);
  if (!accessToken) {
    const error = text(body.error);
    const description = text(body.error_description);
    throw new ItcError(
      ITC_ERRORS.auth,
      description || error
        ? `Нэвтрэлт амжилтгүй: ${[error, description].filter(Boolean).join(" — ")}`
        : "Нэвтрэлтийн хариуд access_token алга"
    );
  }
  const expiresIn = seconds(body.expires_in);
  if (!expiresIn) throw new ItcError(ITC_ERRORS.auth, "Нэвтрэлтийн хариуд expires_in алга");
  const refreshToken = text(body.refresh_token) || null;
  const refreshExpiresIn = seconds(body.refresh_expires_in);
  return {
    accessToken,
    expiresAt: now + expiresIn * 1000,
    refreshToken,
    refreshExpiresAt: refreshToken && refreshExpiresIn ? now + refreshExpiresIn * 1000 : null,
    tokenType: text(body.token_type) || "Bearer",
    scope: text(body.scope),
  };
}

/** Access token одоо хэрэглэж болох уу (дуусахаас skew-ээс өмнө). */
export function isAccessTokenUsable(token: Pick<ItcToken, "accessToken" | "expiresAt">, now: number = Date.now(), skewMs = ITC_TOKEN_SKEW_MS): boolean {
  return token.accessToken !== "" && token.expiresAt - skewMs > now;
}

/** Refresh token-оор сунгаж болох уу (байгаа, дуусаагүй). */
export function isRefreshUsable(token: Pick<ItcToken, "refreshToken" | "refreshExpiresAt">, now: number = Date.now(), skewMs = ITC_TOKEN_SKEW_MS): boolean {
  if (!token.refreshToken) return false;
  if (token.refreshExpiresAt == null) return true;
  return token.refreshExpiresAt - skewMs > now;
}

/** `Authorization` толгой — зөвхөн access_token (албан заавар). */
export function bearerHeader(token: Pick<ItcToken, "accessToken">): { Authorization: string } {
  return { Authorization: `Bearer ${token.accessToken}` };
}

/** Лог/аудитад token-ийн УТГА орохгүй — зөвхөн урт, дуусах мөч. */
export function describeToken(token: ItcToken): { accessLength: number; expiresAt: string; hasRefresh: boolean } {
  return {
    accessLength: token.accessToken.length,
    expiresAt: new Date(token.expiresAt).toISOString(),
    hasRefresh: token.refreshToken !== null,
  };
}

// ITC HTTP клиент — Keycloak token + eBarimt TPI дуудлага (SERVER; DB-гүй).
// Монголын IP-ээс л хандагддаг (docs/integrations/00 §3) — гадаад бүсийн серверт
// `ITC_TPI_BASE` / `ITC_AUTH_BASE` (+ `_STAGING`)-ээр Монголд байрлах прокси, ОРЧИН БҮРД ТУСДАА
// (docs/deployment/mongolia-network-runbook.md §A; ebarimt-ийн
// `EBARIMT_PUBLIC_API_BASE`-тэй ижил зарчим). Прокси Cloudflare WAF-ын ард бол
// нууц header нь ЗӨВХӨН `EBARIMT_GATEWAY_HOSTS`-ийн хост руу (gateway-auth.ts) —
// албан ITC хост руу ХЭЗЭЭ Ч явахгүй. Алдаа бүр ItcError `[CODE]`.

import { gatewayHeaders } from "@/lib/ebarimt/gateway-auth";
import {
  EBARIMT_TPI_BASE,
  ITC_CLIENT_IDS,
  ITC_CUSTOMS_BASE,
  ITC_CUSTOMS_PATHS,
  ITC_ERRORS,
  ITC_TOKEN_TIMEOUT_MS,
  ITC_TPI_TIMEOUT_MS,
  TPI_PATHS,
  type ItcEnvironment,
} from "./constants";
import {
  ItcError,
  bearerHeader,
  itcTokenUrl,
  parseItcTokenResponse,
  passwordGrantBody,
  refreshGrantBody,
  type ItcToken,
} from "./auth";
import {
  customsDeclarationBody,
  parseCustomsDeclarations,
  parseSaleListErp,
  parseSalesTotalData,
  saleListErpBody,
  salesTotalDataBody,
  type CustomsDeclarationRequest,
  type CustomsParseResult,
  type SaleListErpRequest,
  type SalesTotalDataRequest,
  type TpiParseResult,
  type TpiPurchaseRow,
  type TpiSaleRow,
} from "./tpi";

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export type ItcProxyEnvName = "ITC_TPI_BASE" | "ITC_AUTH_BASE" | "ITC_CUSTOMS_BASE";

/**
 * Прокси env-ийн нэр орчноор: `ITC_*_BASE` = БОДИТ орчны хост руу дамжуулдаг прокси,
 * `ITC_*_BASE_STAGING` = туршилтын орчных (st.auth.itc.gov.mn, st-api.ebarimt.mn — мөн
 * зөвхөн Монголын IP). Бодитын проксиг staging-д хэрэглэвэл realm/хост зөрж 404 гардаг
 * (2026-10-02 — Keycloak `Staging` realm бодит хост дээр байхгүй) тул ХОЛИХГҮЙ.
 * Гаалийн хост хоёр орчинд ижил тул staging нь `ITC_CUSTOMS_BASE`-ийг ч хэрэглэнэ.
 */
export function itcProxyEnvName(name: ItcProxyEnvName, env: ItcEnvironment): string {
  return env === "staging" ? `${name}_STAGING` : name;
}

/** Орчны прокси override (ЦЭВЭР — `vars` өгч тестлэнэ); хоосон бол undefined. */
export function itcProxyOverride(
  name: ItcProxyEnvName,
  env: ItcEnvironment,
  vars: Record<string, string | undefined> = process.env
): string | undefined {
  const own = vars[itcProxyEnvName(name, env)]?.trim();
  if (own) return own;
  if (name === "ITC_CUSTOMS_BASE" && env === "staging") return vars[name]?.trim() || undefined;
  return undefined;
}

/** TPI хост — орчны прокси (`ITC_TPI_BASE` / `ITC_TPI_BASE_STAGING`) байвал түрүүлнэ. */
export function itcTpiBase(env: ItcEnvironment, override = itcProxyOverride("ITC_TPI_BASE", env)): string {
  const value = (override ?? "").trim();
  if (value) {
    if (!/^https?:\/\//i.test(value)) throw new ItcError(ITC_ERRORS.config, `${itcProxyEnvName("ITC_TPI_BASE", env)} http(s) URL байна`);
    return trimBase(value);
  }
  return EBARIMT_TPI_BASE[env];
}

/** Keycloak token URL — орчны прокси (`ITC_AUTH_BASE` / `ITC_AUTH_BASE_STAGING`) байвал түрүүлнэ. */
export function itcAuthTokenUrl(env: ItcEnvironment, override = itcProxyOverride("ITC_AUTH_BASE", env)): string {
  return itcTokenUrl(env, override);
}

async function request<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { ...(init.headers as Record<string, string> | undefined), ...gatewayHeaders(url) };
    const response = await fetch(url, { ...init, headers, signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    let body: T;
    try {
      body = (text ? JSON.parse(text) : {}) as T;
    } catch {
      body = { message: text.slice(0, 500) } as T;
    }
    return { status: response.status, body };
  } catch (error) {
    if (error instanceof ItcError) throw error;
    if (error instanceof Error && error.name === "AbortError")
      throw new ItcError(ITC_ERRORS.network, `ITC ${Math.round(timeoutMs / 1000)} сек-д хариулсангүй (${url})`);
    const reason = error instanceof Error ? error.message : String(error);
    throw new ItcError(ITC_ERRORS.network, `ITC-д хүрсэнгүй (${url}) — Монголын IP-ээс л хандагдана: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Нэвтрэх нэр / нууц үгээр token (Keycloak password grant). Нууц лог руу орохгүй. */
export async function fetchItcToken(
  env: ItcEnvironment,
  credentials: { username: string; password: string },
  clientId: string = ITC_CLIENT_IDS.ebarimtTpi
): Promise<ItcToken> {
  const { status, body } = await request<unknown>(
    itcAuthTokenUrl(env),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: passwordGrantBody({ clientId, ...credentials }),
    },
    ITC_TOKEN_TIMEOUT_MS
  );
  assertKeycloakReply(env, status, body);
  return parseItcTokenResponse(body);
}

/**
 * Keycloak JSON-оор хариулаагүй (HTML, прокси/гео-хориг) бол «access_token алга»
 * гэсэн ойлгомжгүй мессежийн оронд HTTP код + бодит шалтгааныг ил хэлнэ.
 * auth.itc.gov.mn / st.auth.itc.gov.mn нь ЗӨВХӨН Монголын IP-ээс (docs/integrations/00 §3).
 */
function assertKeycloakReply(env: ItcEnvironment, status: number, body: unknown): void {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if ("access_token" in record || "error" in record) return;
  const envName = itcProxyEnvName("ITC_AUTH_BASE", env);
  const proxy = itcProxyOverride("ITC_AUTH_BASE", env);
  const hint = proxy
    ? ` — ${envName} прокси (${proxy}) зөв ажиллаж буйг шалгана`
    : env === "staging"
      ? " — туршилтын орчны st.auth.itc.gov.mn зөвхөн Монголын IP-ээс хандагддаг: Entry баг ITC_AUTH_BASE_STAGING (Монголд байрлах прокси) тохируулна, эсвэл бодит ITC нэвтрэлттэй бол холболтын орчныг «Бодит орчин» болгоно"
      : " — auth.itc.gov.mn зөвхөн Монголын IP-ээс хандагддаг; гадаад серверт ITC_AUTH_BASE (Монголд байрлах прокси) тохируулна";
  throw new ItcError(
    ITC_ERRORS.network,
    `ITC-ийн нэвтрэлтийн сервер (${env === "staging" ? "туршилтын" : "бодит"} орчин) Keycloak-ийн хариу өгсөнгүй (HTTP ${status})${hint}`
  );
}

/** Refresh token-оор сунгах. */
export async function refreshItcToken(env: ItcEnvironment, refreshToken: string, clientId: string = ITC_CLIENT_IDS.ebarimtTpi): Promise<ItcToken> {
  const { body } = await request<unknown>(
    itcAuthTokenUrl(env),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: refreshGrantBody({ clientId, refreshToken }),
    },
    ITC_TOKEN_TIMEOUT_MS
  );
  return parseItcTokenResponse(body);
}

export interface TpiAuth {
  token: Pick<ItcToken, "accessToken">;
  /** ХСН-д posapi@itc.gov.mn-ээс олгосон X-API-KEY (зарим TPI сервис шаарддаг). */
  apiKey?: string | null;
}

async function tpiPost<T>(env: ItcEnvironment, path: string, auth: TpiAuth, body: unknown): Promise<T> {
  // Албан хуудас: getSalesTotalData / getSaleListERP хоёул X-API-KEY шаарддаг — түлхүүргүй
  // дуудвал 401/403-ын ойлгомжгүй алдааны оронд тохиргооны дутууг ИЛ хэлнэ (CLAUDE.md §5c).
  if (!auth.apiKey?.trim())
    throw new ItcError(
      ITC_ERRORS.config,
      "ТЕГ-ийн TPI X-API-KEY (Entry-ийн операторын түлхүүр, серверийн env ITC_TPI_API_KEY) тохируулагдаагүй — Entry багт хандана уу"
    );
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...bearerHeader(auth.token),
    "X-API-KEY": auth.apiKey.trim(),
  };
  const { status, body: json } = await request<T & { message?: string }>(
    `${itcTpiBase(env)}${path}`,
    { method: "POST", headers, body: JSON.stringify(body) },
    ITC_TPI_TIMEOUT_MS
  );
  if (status === 401 || status === 403)
    throw new ItcError(ITC_ERRORS.auth, `ТЕГ TPI ${status} — token хүчингүй эсвэл X-API-KEY эрхгүй`);
  if (status >= 400)
    throw new ItcError(ITC_ERRORS.tpi, `ТЕГ TPI ${status}: ${json?.message ?? "хариу алдаатай"}`);
  return json;
}

/** Борлуулалтын задаргаа (ТЕГ-д бүртгэгдсэн баримтууд) — Entry ↔ ТЕГ тулгалтын эх. */
export async function tpiSalesTotalData(env: ItcEnvironment, auth: TpiAuth, input: SalesTotalDataRequest): Promise<TpiParseResult<TpiSaleRow>> {
  return parseSalesTotalData(await tpiPost(env, TPI_PATHS.salesTotalData, auth, salesTotalDataBody(input)));
}

/** Охин компанийн худалдан авалт (оролтын НӨАТ-ын eBarimt тулгалт). */
export async function tpiSaleListErp(env: ItcEnvironment, auth: TpiAuth, input: SaleListErpRequest): Promise<TpiParseResult<TpiPurchaseRow>> {
  return parseSaleListErp(await tpiPost(env, TPI_PATHS.saleListErp, auth, saleListErpBody(input)));
}

/**
 * Гаалийн мэдүүлгийн хост — прокси `ITC_CUSTOMS_BASE` (staging-д `_STAGING` байвал тэр)
 * байвал түрүүлнэ. data.ebarimt.mn ЗӨВХӨН Монголын IP (2026-10-02 гадаадаас timeout).
 */
export function itcCustomsBase(env: ItcEnvironment, override = itcProxyOverride("ITC_CUSTOMS_BASE", env)): string {
  const value = (override ?? "").trim();
  if (value) {
    if (!/^https?:\/\//i.test(value)) throw new ItcError(ITC_ERRORS.config, "ITC_CUSTOMS_BASE http(s) URL байна");
    return trimBase(value);
  }
  return ITC_CUSTOMS_BASE[env];
}

/**
 * Хуулийн этгээдийн гаалийн мэдүүлэг (developer портал 10.4) — ижил Keycloak token,
 * харин X-API-KEY нь Гаалийн ерөнхий газрынх (`auth.apiKey`-д дуудагч өгнө).
 */
export async function tpiCustomsDeclarations(
  env: ItcEnvironment,
  auth: TpiAuth,
  input: CustomsDeclarationRequest
): Promise<CustomsParseResult> {
  const url = `${itcCustomsBase(env)}${ITC_CUSTOMS_PATHS.declarations}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...bearerHeader(auth.token),
  };
  if (auth.apiKey?.trim()) headers["X-API-KEY"] = auth.apiKey.trim();
  const { status, body: json } = await request<{ message?: string }>(
    url,
    { method: "POST", headers, body: JSON.stringify(customsDeclarationBody(input)) },
    ITC_TPI_TIMEOUT_MS
  );
  if (status === 401 || status === 403)
    throw new ItcError(ITC_ERRORS.auth, `Гаалийн мэдүүлгийн сервис ${status} — token хүчингүй эсвэл гаалийн X-API-KEY эрхгүй`);
  if (status >= 400)
    throw new ItcError(ITC_ERRORS.tpi, `Гаалийн мэдүүлгийн сервис ${status}: ${json?.message ?? "хариу алдаатай"}`);
  return parseCustomsDeclarations(json);
}

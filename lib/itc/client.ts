// ITC HTTP клиент — Keycloak token + eBarimt TPI дуудлага (SERVER; DB-гүй).
// Монголын IP-ээс л хандагддаг (docs/integrations/00 §3) — гадаад бүсийн серверт
// `ITC_TPI_BASE` / `ITC_AUTH_BASE`-ээр Монголд байрлах прокси
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

/** Орчны хаяг — env override (Монголд байрлах прокси) байвал түрүүлнэ. */
export function itcTpiBase(env: ItcEnvironment, override = process.env.ITC_TPI_BASE): string {
  const value = (override ?? "").trim();
  if (value) {
    if (!/^https?:\/\//i.test(value)) throw new ItcError(ITC_ERRORS.config, "ITC_TPI_BASE http(s) URL байна");
    return trimBase(value);
  }
  return EBARIMT_TPI_BASE[env];
}

/** Keycloak token URL — env `ITC_AUTH_BASE` (Монголд байрлах прокси) байвал түрүүлнэ. */
export function itcAuthTokenUrl(env: ItcEnvironment, override = process.env.ITC_AUTH_BASE): string {
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
  const proxy = process.env.ITC_AUTH_BASE?.trim();
  throw new ItcError(
    ITC_ERRORS.network,
    `ITC-ийн нэвтрэлтийн сервер (${env === "staging" ? "туршилтын" : "бодит"} орчин) Keycloak-ийн хариу өгсөнгүй (HTTP ${status})` +
      (proxy
        ? ` — ITC_AUTH_BASE прокси (${proxy}) зөв ажиллаж буйг шалгана`
        : " — auth.itc.gov.mn зөвхөн Монголын IP-ээс хандагддаг; гадаад серверт ITC_AUTH_BASE (Монголд байрлах прокси) тохируулна")
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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...bearerHeader(auth.token),
  };
  if (auth.apiKey?.trim()) headers["X-API-KEY"] = auth.apiKey.trim();
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

/** Гаалийн мэдүүлгийн хост — env `ITC_CUSTOMS_BASE` (Монголд байрлах прокси) байвал түрүүлнэ. */
export function itcCustomsBase(env: ItcEnvironment, override = process.env.ITC_CUSTOMS_BASE): string {
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

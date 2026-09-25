// ITC HTTP клиент — Keycloak token + eBarimt TPI дуудлага (SERVER; DB-гүй).
// Монголын IP-ээс л хандагддаг (docs/integrations/00 §3) — гадаад бүсийн серверт
// `ITC_PROXY_BASE`-ээр Монголд байрлах прокси/операторын хаяг (ebarimt-ийн
// `EBARIMT_PUBLIC_API_BASE`-тэй ижил зарчим). Алдаа бүр ItcError `[CODE]`.

import {
  EBARIMT_TPI_BASE,
  ITC_CLIENT_IDS,
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
  parseSaleListErp,
  parseSalesTotalData,
  saleListErpBody,
  salesTotalDataBody,
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

async function request<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
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
  const { body } = await request<unknown>(
    itcTokenUrl(env),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: passwordGrantBody({ clientId, ...credentials }),
    },
    ITC_TOKEN_TIMEOUT_MS
  );
  return parseItcTokenResponse(body);
}

/** Refresh token-оор сунгах. */
export async function refreshItcToken(env: ItcEnvironment, refreshToken: string, clientId: string = ITC_CLIENT_IDS.ebarimtTpi): Promise<ItcToken> {
  const { body } = await request<unknown>(
    itcTokenUrl(env),
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

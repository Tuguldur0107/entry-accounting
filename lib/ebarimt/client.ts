// PosAPI 3.0 HTTP клиент — мерчантын PosAPI үйлчилгээ (server горимд Railway-ийн
// posapi service, browser горимд кассын PC-ийн localhost). DB импортгүй тул
// client component ч дуудаж болно (browser горим).
// docs/pos/03-ebarimt-integration-plan.md §1, §3.

import {
  EBARIMT_ERRORS,
  POSAPI_PATHS,
  POSAPI_RECEIPT_TIMEOUT_MS,
  POSAPI_SEND_DATA_TIMEOUT_MS,
  POSAPI_TIMEOUT_MS,
} from "./constants";
import { EbarimtError } from "./receipt";
import { parsePosApiBankAccounts, parsePosApiInfo } from "./posapi-info";
import { gatewayHeaders } from "./gateway-auth";
import type {
  EbarimtDeleteRequest,
  EbarimtReceiptRequest,
  EbarimtReceiptResponse,
  PosApiBankAccount,
  PosApiHealth,
  PosApiInfo,
} from "./types";

function baseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * PosAPI-ийн хариуг JSON болгож уншина. PosAPI үргэлж JSON буцаадаг — HTML / текст
 * ирвэл хүсэлт PosAPI-д ХҮРЭЭГҮЙ (Cloudflare WAF-ын 403 хуудас, буруу URL-ийн вэб
 * консол г.м.) тул амжилт гэж үзэхгүй, шалтгааныг нэрлэж ШИДНЭ. 2026-09-27: WAF
 * блоклосон 403 HTML-ийг «PosAPI-тай холбогдлоо» гэж харуулж байсан.
 */
export function parsePosApiBody<T>(status: number, text: string, url: string): T {
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const hint =
      status === 403
        ? " — Cloudflare WAF татгалзсан: Railway-ийн EBARIMT_GATEWAY_KEY ба WAF дүрмийн нууц таарахгүй, эсвэл EBARIMT_GATEWAY_HOSTS-д энэ хост алга (docs/deployment/ebarimt.md §4a)"
        : " — PosAPI биш хуудас хариулсан (URL-аа шалгана уу)";
    throw new EbarimtError(EBARIMT_ERRORS.posApi, `PosAPI JSON биш хариу өглөө (HTTP ${status}, ${url})${hint}`);
  }
}

async function call<T>(
  url: string,
  init: RequestInit,
  timeoutMs = POSAPI_TIMEOUT_MS
): Promise<{ status: number; body: T }> {
  const { status, text } = await rawCall(url, init, timeoutMs);
  return { status, body: parsePosApiBody<T>(status, text, url) };
}

/** HTTP дуудлага — хариуг задлахгүй (замын 404-ийг дуудагч өөрөө шийдэхэд). */
async function rawCall(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Операторын PosAPI нийтэд ил бол WAF-ын нууц header (allowlist-ийн хост руу л —
    // lib/ebarimt/gateway-auth.ts); тохируулаагүй бол хоосон.
    const headers = { ...(init.headers as Record<string, string> | undefined), ...gatewayHeaders(url) };
    const response = await fetch(url, { ...init, headers, signal: controller.signal, cache: "no-store" });
    return { status: response.status, text: await response.text() };
  } catch (error) {
    if (error instanceof EbarimtError) throw error;
    if (error instanceof Error && error.name === "AbortError")
      // Timeout нь «хүрсэнгүй» БИШ — хүсэлт PosAPI-д хүрч ДДТД үүссэн байж болзошгүй
      // (P0-3); дуудагч (worker) давхардлын эрсдэлийг lastError-д ил бичнэ.
      throw new EbarimtError(
        EBARIMT_ERRORS.posApiTimeout,
        `PosAPI ${Math.round(timeoutMs / 1000)} сек-д хариулсангүй (${url}) — хүсэлт хүрч ДДТД үүссэн байж болзошгүй`
      );
    const reason = error instanceof Error ? error.message : String(error);
    throw new EbarimtError(EBARIMT_ERRORS.posApi, `PosAPI-д хүрсэнгүй (${url}): ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Баримт бичих — урт timeout (PosAPI нөөцөө түлхэж байхдаа удаан хариулдаг, давхар ДДТД-ээс сэргийлнэ). */
export async function posApiPutReceipt(posApiUrl: string, request: EbarimtReceiptRequest): Promise<EbarimtReceiptResponse> {
  const { body } = await call<EbarimtReceiptResponse>(
    `${baseUrl(posApiUrl)}${POSAPI_PATHS.receipt}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    POSAPI_RECEIPT_TIMEOUT_MS
  );
  return body ?? {};
}

export async function posApiDeleteReceipt(posApiUrl: string, request: EbarimtDeleteRequest): Promise<EbarimtReceiptResponse> {
  const { status, body } = await call<EbarimtReceiptResponse>(
    `${baseUrl(posApiUrl)}${POSAPI_PATHS.receipt}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    POSAPI_RECEIPT_TIMEOUT_MS
  );
  return { ...(body ?? {}), httpStatus: status };
}

export async function posApiInfo(posApiUrl: string): Promise<PosApiInfo> {
  const { body } = await call<PosApiInfo>(`${baseUrl(posApiUrl)}${POSAPI_PATHS.info}`, { method: "GET" });
  return body ?? {};
}

/** Мерчантын ТЕГ-д бүртгэлтэй банкны данс (`/rest/bankAccounts?tin=`) — нэхэмжлэхийн данс сонгоход. */
export async function posApiBankAccounts(posApiUrl: string, tin: string): Promise<PosApiBankAccount[]> {
  const { body } = await call<unknown>(
    `${baseUrl(posApiUrl)}${POSAPI_PATHS.bankAccounts}?tin=${encodeURIComponent(tin.trim())}`,
    { method: "GET" },
    10_000
  );
  return parsePosApiBankAccounts(body);
}

/**
 * Хуримтлагдсан баримтыг ТЕГ рүү түлхэнэ. Developer портал `/rest/sendData`,
 * PDF гарын авлага 3.0.1 §8 `/rest/send` гэж өөр бичсэн тул эхнийх нь 404 бол
 * хоёр дахийг оролдоно — аль замыг таньдаг нь операторын PosAPI-ийн хувилбараас
 * хамаарна (docs/integrations/01 §7).
 */
export async function posApiSendData(posApiUrl: string): Promise<PosApiInfo> {
  const base = baseUrl(posApiUrl);
  let url = `${base}${POSAPI_PATHS.sendData}`;
  let response = await rawCall(url, { method: "GET" }, POSAPI_SEND_DATA_TIMEOUT_MS);
  if (response.status === 404) {
    url = `${base}${POSAPI_PATHS.sendDataLegacy}`;
    response = await rawCall(url, { method: "GET" }, POSAPI_SEND_DATA_TIMEOUT_MS);
  }
  if (response.status === 404)
    throw new EbarimtError(
      EBARIMT_ERRORS.posApi,
      `PosAPI ${POSAPI_PATHS.sendData} ба ${POSAPI_PATHS.sendDataLegacy} хоёуланг таньсангүй (HTTP 404, ${base}) — PosAPI-ийн хувилбарыг шалгана уу`
    );
  return parsePosApiBody<PosApiInfo>(response.status, response.text, url) ?? {};
}

/**
 * `/rest/info`-г уншиж ойлгомжтой болгоно; PosAPI-д хүрэхгүй бол null — ХЭЗЭЭ Ч
 * шидэхгүй (самбар, scheduler, статус гурвуул дуудна; хяналт нь борлуулалтыг
 * зогсоох ёсгүй).
 */
export async function fetchPosApiHealth(posApiUrl: string): Promise<PosApiHealth | null> {
  try {
    return parsePosApiInfo(await posApiInfo(posApiUrl));
  } catch {
    return null;
  }
}

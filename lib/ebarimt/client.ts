// PosAPI 3.0 HTTP клиент — мерчантын PosAPI үйлчилгээ (server горимд Railway-ийн
// posapi service, browser горимд кассын PC-ийн localhost). DB импортгүй тул
// client component ч дуудаж болно (browser горим).
// docs/pos/03-ebarimt-integration-plan.md §1, §3.

import { EBARIMT_ERRORS, POSAPI_PATHS, POSAPI_TIMEOUT_MS } from "./constants";
import { EbarimtError } from "./receipt";
import { parsePosApiInfo } from "./posapi-info";
import type { EbarimtDeleteRequest, EbarimtReceiptRequest, EbarimtReceiptResponse, PosApiHealth, PosApiInfo } from "./types";

function baseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

async function call<T>(
  url: string,
  init: RequestInit,
  timeoutMs = POSAPI_TIMEOUT_MS
): Promise<{ status: number; body: T }> {
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
    const reason = error instanceof Error && error.name === "AbortError" ? "хугацаа хэтэрлээ" : error instanceof Error ? error.message : String(error);
    throw new EbarimtError(EBARIMT_ERRORS.posApi, `PosAPI-д хүрсэнгүй (${url}): ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function posApiPutReceipt(posApiUrl: string, request: EbarimtReceiptRequest): Promise<EbarimtReceiptResponse> {
  const { body } = await call<EbarimtReceiptResponse>(`${baseUrl(posApiUrl)}${POSAPI_PATHS.receipt}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return body ?? {};
}

export async function posApiDeleteReceipt(posApiUrl: string, request: EbarimtDeleteRequest): Promise<EbarimtReceiptResponse> {
  const { status, body } = await call<EbarimtReceiptResponse>(`${baseUrl(posApiUrl)}${POSAPI_PATHS.receipt}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return { ...(body ?? {}), httpStatus: status };
}

export async function posApiInfo(posApiUrl: string): Promise<PosApiInfo> {
  const { body } = await call<PosApiInfo>(`${baseUrl(posApiUrl)}${POSAPI_PATHS.info}`, { method: "GET" }, 5_000);
  return body ?? {};
}

export async function posApiSendData(posApiUrl: string): Promise<PosApiInfo> {
  const { body } = await call<PosApiInfo>(`${baseUrl(posApiUrl)}${POSAPI_PATHS.sendData}`, { method: "GET" }, 60_000);
  return body ?? {};
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

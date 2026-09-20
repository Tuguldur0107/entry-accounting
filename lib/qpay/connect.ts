// Нэг товчны холболт (Entry → qpay-dashboard → Entry) — SERVER модуль.
// docs/pos/04-qpay-integration-plan.md §3.6, dashboard docs/API.md «Connect».
//
// Урсгал: startQpayConnect → state (ШИФРЛЭСЭН, 15 мин, org+user+apiUrl+nonce)
// → dashboard /connect (нэвтрэлт, consent) → callback ?state&code → Entry
// сервер /api/connect/exchange (code, state) → API key + webhook secret
// (нууц URL/browser-т ХЭЗЭЭ Ч орохгүй) → pos_settings (encryptSecret).
//
// state нь AES-GCM (authenticated) тул хуурамч/өөр байгууллагын state
// зохиох боломжгүй; хугацаа дууссан / буруу state → callback татгалзана.

import { randomBytes } from "node:crypto";

import { decryptSecret, encryptSecret } from "@/lib/ai/crypto";
import { QpayError } from "./client";
import { QPAY_ERRORS, QPAY_HTTP_TIMEOUT_MS } from "./constants";

export const QPAY_CONNECT_STATE_TTL_MS = 15 * 60 * 1000;
export const QPAY_CONNECT_APP = "entry";
/** Dashboard-ын consent хуудас ба солилцооны зам (dashboard docs/API.md «Connect»). */
export const QPAY_CONNECT_PATH = "/connect";
export const QPAY_CONNECT_EXCHANGE_PATH = "/api/connect/exchange";
export const QPAY_CONNECT_CALLBACK_PATH = "/api/pos/qpay/connect/callback";

export interface QpayConnectState {
  orgId: string;
  userId: string;
  /** Холболт эхлүүлэх үеийн dashboard URL — callback ЭНЭ хаягтай солилцоно. */
  apiUrl: string;
  nonce: string;
  expiresAt: number;
}

const toUrlSafe = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const fromUrlSafe = (value: string) => Buffer.from(value, "base64url").toString("utf8");

/** Шифрлэсэн, URL-safe state ([A-Za-z0-9_-]). */
export function buildConnectState(input: Pick<QpayConnectState, "orgId" | "userId" | "apiUrl">, now = Date.now()): string {
  const payload: QpayConnectState = {
    ...input,
    nonce: randomBytes(12).toString("base64url"),
    expiresAt: now + QPAY_CONNECT_STATE_TTL_MS,
  };
  return toUrlSafe(encryptSecret(JSON.stringify(payload)));
}

/** Тайлж, хугацааг шалгана — буруу / хуучирсан бол null (шидэхгүй). */
export function parseConnectState(state: string, now = Date.now()): QpayConnectState | null {
  if (!/^[A-Za-z0-9_-]{32,4096}$/.test(state)) return null;
  try {
    const plain = decryptSecret(fromUrlSafe(state));
    if (!plain || !plain.startsWith("{")) return null;
    const parsed = JSON.parse(plain) as Partial<QpayConnectState>;
    if (
      typeof parsed.orgId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.apiUrl !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.expiresAt !== "number"
    )
      return null;
    if (parsed.expiresAt < now) return null;
    return parsed as QpayConnectState;
  } catch {
    return null;
  }
}

/** Dashboard-ын consent хуудасны URL (ЦЭВЭР). */
export function connectUrl(apiUrl: string, params: { callback: string; state: string; org: string }): string {
  const url = new URL(QPAY_CONNECT_PATH, apiUrl.replace(/\/$/, "") + "/");
  url.searchParams.set("app", QPAY_CONNECT_APP);
  url.searchParams.set("callback", params.callback);
  url.searchParams.set("state", params.state);
  if (params.org) url.searchParams.set("org", params.org.slice(0, 80));
  return url.toString();
}

export interface QpayConnectGrant {
  merchantId: string;
  merchantName: string | null;
  apiKey: string;
  webhookSecret: string;
}

/** Сервер-сервер: нэг удаагийн code-оор нууцыг авна (dashboard 410 → QPAY_CONNECT_EXPIRED). */
export async function exchangeConnectCode(apiUrl: string, code: string, state: string): Promise<QpayConnectGrant> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QPAY_HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}${QPAY_CONNECT_EXCHANGE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      merchant_id?: string;
      merchant_name?: string | null;
      api_key?: string;
      webhook_secret?: string;
    };
    if (response.status === 410) throw new QpayError(QPAY_ERRORS.connectExpired, body.error ?? "Холболтын code хүчингүй", 410);
    if (!response.ok) throw new QpayError(QPAY_ERRORS.dashboard, body.error ?? `Dashboard ${response.status}`, response.status);
    if (!body.api_key || !body.webhook_secret || !body.merchant_id)
      throw new QpayError(QPAY_ERRORS.dashboard, "Dashboard-ын хариу дутуу (api_key / webhook_secret)", response.status);
    return {
      merchantId: body.merchant_id,
      merchantName: body.merchant_name ?? null,
      apiKey: body.api_key,
      webhookSecret: body.webhook_secret,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Landing-ийн чатын НИЙТИЙН API-ийн нэгдсэн хаалга (`/api/public-chat/*`):
// CORS (зөвхөн зөвшөөрсөн origin), IP-ийн rate limit, Turnstile, зочны токен,
// алдааны хариу. Нэвтрэлтгүй — хамгаалалт нь эдгээр давхарга.

import { NextResponse } from "next/server";

import { deploymentMode } from "@/lib/deployment-mode";
import { checkRateLimit } from "@/lib/rate-limit";

import { PublicChatInputError, allowedOrigins, isVisitorToken } from "./rules";
import { findVisitor, hashIp, type PublicChatVisitor } from "./store";

export const VISITOR_HEADER = "x-visitor-token";

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(process.env.PUBLIC_CHAT_ALLOWED_ORIGINS).includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": `content-type, ${VISITOR_HEADER}`,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function chatJson(request: Request, body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...corsHeaders(request), "Cache-Control": "no-store" },
  });
}

export function chatPreflight(request: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

/**
 * Зөвхөн saas (Entry-ийн үндсэн сервис) — dedicated харилцагчийн deploy-д
 * landing-ийн чат БАЙХГҮЙ (404). Хөтчөөс ирсэн хүсэлт зөвшөөрсөн origin-оос
 * биш бол татгалзана (өөр сайт манай өрөөнд зочны нэрээр бичүүлэхээс).
 * Origin-гүй хүсэлт (curl) — rate limit + Turnstile хамгаална.
 */
export function chatGate(request: Request): NextResponse | null {
  if (deploymentMode() !== "saas") return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins(process.env.PUBLIC_CHAT_ALLOWED_ORIGINS).includes(origin))
    return NextResponse.json({ ok: false, error: "Origin зөвшөөрөгдөөгүй" }, { status: 403 });
  return null;
}

export function clientIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

/** true = хязгаар хэтэрсэн. IP тодорхойгүй бол нэг нийтлэг bucket. */
export function rateLimited(request: Request, key: string, rule: { limit: number; windowMs: number }): boolean {
  return !checkRateLimit(`public-chat:${key}:${clientIp(request) ?? "unknown"}`, rule.limit, rule.windowMs);
}

export function tooMany(request: Request): NextResponse {
  return chatJson(request, { ok: false, error: "Хэт олон хүсэлт — түр хүлээгээд дахин оролдоно уу" }, 429);
}

export function ipHashOf(request: Request): string | null {
  return hashIp(clientIp(request));
}

export async function visitorOf(request: Request): Promise<PublicChatVisitor | null> {
  const token = request.headers.get(VISITOR_HEADER);
  if (!isVisitorToken(token)) return null;
  return findVisitor(token);
}

export function chatFailure(request: Request, caught: unknown): NextResponse {
  if (caught instanceof PublicChatInputError) return chatJson(request, { ok: false, error: caught.message }, 422);
  console.error("[public-chat]", caught);
  return chatJson(request, { ok: false, error: "Түр алдаа гарлаа — дахин оролдоно уу" }, 500);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new PublicChatInputError("Хүсэлт буруу байна");
  }
}

/** `?after=` ISO огноо → Date (буруу бол null = эхнээс). */
export function parseAfter(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Cloudflare Turnstile. `TURNSTILE_SECRET_KEY` тохируулаагүй бол алгасна
 * (dev/локал) — production-д заавал тохируулна (docs/dev/public-chat.md).
 */
export async function verifyTurnstile(token: unknown, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set("remoteip", ip);
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await response.json()) as { success?: boolean };
    return json.success === true;
  } catch (error) {
    console.error("[public-chat] turnstile:", error);
    return false;
  }
}

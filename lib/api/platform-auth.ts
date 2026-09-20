// Платформын API-ийн НЭГДСЭН хаалга — `/api/platform/*` бүгд эндээс дайрна
// (docs/billing/00-proposal.md §5). Нэвтрэлт: Bearer `ENTRY_PLATFORM_API_KEY`
// (timing-safe), ЗӨВХӨН saas горимд — dedicated deploy-д 404 (тэнд харилцагчийг
// Console лицензээр удирддаг, багцын давхарга хамаарахгүй).

import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { deploymentMode } from "@/lib/deployment-mode";
import { checkRateLimit } from "@/lib/rate-limit";

function authorized(request: Request): boolean {
  const secret = process.env.ENTRY_PLATFORM_API_KEY?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Татгалзах хариу, эсвэл зөвшөөрөгдвөл null. */
export function platformGate(request: Request): NextResponse | null {
  if (deploymentMode() !== "saas")
    return NextResponse.json({ ok: false, error: "Зөвхөн saas горимд" }, { status: 404 });
  if (!process.env.ENTRY_PLATFORM_API_KEY?.trim())
    return NextResponse.json({ ok: false, error: "ENTRY_PLATFORM_API_KEY тохируулаагүй" }, { status: 503 });
  if (!checkRateLimit("platform-api", 120, 60_000))
    return NextResponse.json({ ok: false, error: "Хэт олон хүсэлт" }, { status: 429 });
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Нэвтрэх эрхгүй" }, { status: 401 });
  return null;
}

/** Console-ийн actor нэр — логт л ордог, эрх олгохгүй. */
export function platformActorLabel(actor: unknown): string {
  return `Entry Console${typeof actor === "string" && actor ? ` · ${actor.slice(0, 80)}` : ""}`;
}

export function platformFailure(caught: unknown): NextResponse {
  return NextResponse.json(
    { ok: false, error: caught instanceof Error ? caught.message : String(caught) },
    { status: 422 }
  );
}

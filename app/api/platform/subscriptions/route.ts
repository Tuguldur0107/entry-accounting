// Платформын API — Entry Console SaaS харилцагчдын багцыг эндээс удирдана
// (docs/billing/00-proposal.md §5). Нэвтрэлт: Bearer ENTRY_PLATFORM_API_KEY
// (timing-safe), ЗӨВХӨН saas горимд (dedicated deploy-д 404 — тусдаа сервисийн
// харилцагчийг Console лицензээр удирддаг, энэ давхарга хамаарахгүй).
//
//   GET  /api/platform/subscriptions            → { ok, rows: PlatformSubscriptionRow[] }
//   PUT  /api/platform/subscriptions            body: SavePlatformSubscriptionInput
//        + actor?: string (Console-ийн хэрэглэгчийн нэр/и-мэйл — логт)
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  listPlatformSubscriptions,
  savePlatformSubscription,
  type SavePlatformSubscriptionInput,
} from "@/lib/billing/platform";
import { deploymentMode } from "@/lib/deployment-mode";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function gate(request: Request): NextResponse | null {
  if (deploymentMode() !== "saas")
    return NextResponse.json({ ok: false, error: "Зөвхөн saas горимд" }, { status: 404 });
  if (!process.env.ENTRY_PLATFORM_API_KEY?.trim())
    return NextResponse.json(
      { ok: false, error: "ENTRY_PLATFORM_API_KEY тохируулаагүй" },
      { status: 503 }
    );
  if (!checkRateLimit("platform-api", 120, 60_000))
    return NextResponse.json({ ok: false, error: "Хэт олон хүсэлт" }, { status: 429 });
  if (!authorized(request))
    return NextResponse.json({ ok: false, error: "Нэвтрэх эрхгүй" }, { status: 401 });
  return null;
}

export async function GET(request: Request) {
  const blocked = gate(request);
  if (blocked) return blocked;
  const rows = await listPlatformSubscriptions();
  return NextResponse.json({ ok: true, rows });
}

export async function PUT(request: Request) {
  const blocked = gate(request);
  if (blocked) return blocked;
  let body: (SavePlatformSubscriptionInput & { actor?: string }) | null = null;
  try {
    body = (await request.json()) as SavePlatformSubscriptionInput & { actor?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "JSON задлагдсангүй" }, { status: 400 });
  }
  if (!body || typeof body.organizationId !== "string")
    return NextResponse.json({ ok: false, error: "organizationId шаардлагатай" }, { status: 400 });
  try {
    const saved = await savePlatformSubscription(body, {
      userId: null,
      label: `Entry Console${body.actor ? ` · ${String(body.actor).slice(0, 80)}` : ""}`,
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (caught) {
    return NextResponse.json(
      { ok: false, error: caught instanceof Error ? caught.message : String(caught) },
      { status: 422 }
    );
  }
}

// Платформын API — Entry Console SaaS харилцагчдын багцыг эндээс удирдана
// (docs/billing/00-proposal.md §5). Хаалга нь `lib/api/platform-auth.ts`.
//
//   GET  /api/platform/subscriptions            → { ok, rows: PlatformSubscriptionRow[] }
//   PUT  /api/platform/subscriptions            body: SavePlatformSubscriptionInput
//        + actor?: string (Console-ийн хэрэглэгчийн нэр/и-мэйл — логт)
import { NextResponse } from "next/server";

import {
  platformActorLabel,
  platformFailure,
  platformGate,
} from "@/lib/api/platform-auth";
import {
  listPlatformSubscriptions,
  savePlatformSubscription,
  type SavePlatformSubscriptionInput,
} from "@/lib/billing/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  const rows = await listPlatformSubscriptions();
  return NextResponse.json({ ok: true, rows });
}

export async function PUT(request: Request) {
  const blocked = platformGate(request);
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
      label: platformActorLabel(body.actor),
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (caught) {
    return platformFailure(caught);
  }
}

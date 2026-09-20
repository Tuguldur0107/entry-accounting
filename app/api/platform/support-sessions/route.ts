// Платформын API — ДЭМЖЛЭГИЙН ХАНДАЛТ (Entry Console-оос олгогдоно).
//
//   GET    /api/platform/support-sessions?organizationId=&limit=  → { ok, rows }
//   POST   body { organizationId, email, role?, reason?, actor? } → { ok, url, … }
//   DELETE ?id=<uuid>                                             → { ok }
//
// Апп дотор "супер админ" РОЛЬ БАЙХГҮЙ (CLAUDE.md §billing): хандалт бүр нь
// ХУГАЦААТАЙ сесс бөгөөд орох/гарах нь харилцагчийн аудитад ил бичигдэнэ.
import { NextResponse } from "next/server";

import {
  platformActorLabel,
  platformFailure,
  platformGate,
} from "@/lib/api/platform-auth";
import { appBaseUrl } from "@/lib/email/transactional";
import {
  normalizeSupportReason,
  parseSupportRole,
  SUPPORT_LINK_TTL_MS,
} from "@/lib/platform/support";
import {
  endSupportSession,
  issueSupportSession,
  listSupportSessions,
} from "@/lib/platform/support-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get("limit") ?? 20);
  try {
    const rows = await listSupportSessions({
      organizationId: params.get("organizationId")?.trim() || undefined,
      limit: Number.isFinite(limit) ? limit : 20,
    });
    return NextResponse.json({ ok: true, rows });
  } catch (caught) {
    return platformFailure(caught);
  }
}

export async function POST(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  let body: Record<string, unknown> | null = null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON задлагдсангүй" }, { status: 400 });
  }
  if (typeof body?.organizationId !== "string" || !body.organizationId)
    return NextResponse.json({ ok: false, error: "organizationId шаардлагатай" }, { status: 400 });
  if (typeof body?.email !== "string" || !body.email.trim())
    return NextResponse.json({ ok: false, error: "email шаардлагатай" }, { status: 400 });

  try {
    const issued = await issueSupportSession({
      organizationId: body.organizationId,
      email: body.email,
      role: parseSupportRole(body.role),
      reason: normalizeSupportReason(body.reason),
      issuedBy: platformActorLabel(body.actor),
    });
    const url = new URL("/support/enter", appBaseUrl());
    url.searchParams.set("token", issued.token);
    return NextResponse.json({
      ok: true,
      id: issued.id,
      url: url.toString(),
      organizationId: issued.organizationId,
      orgName: issued.orgName,
      email: issued.email,
      role: issued.role,
      expiresAt: issued.expiresAt.toISOString(),
      linkTtlMinutes: Math.round(SUPPORT_LINK_TTL_MS / 60_000),
    });
  } catch (caught) {
    return platformFailure(caught);
  }
}

export async function DELETE(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ ok: false, error: "id шаардлагатай" }, { status: 400 });
  try {
    const row = await endSupportSession({ id });
    if (!row)
      return NextResponse.json({ ok: false, error: "Сесс олдсонгүй" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (caught) {
    return platformFailure(caught);
  }
}

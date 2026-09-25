// Платформын API — байгууллагын ДЭЛГЭРЭНГҮЙ + БҮРМӨСӨН УСТГАХ (Entry Console).
//
//   GET    /api/platform/organizations?id=<uuid>   → { ok, org: PlatformOrgDetail }
//   DELETE /api/platform/organizations?id=<uuid>
//          body { confirm: <нэр эсвэл id>, purgeUsers?: boolean, actor? }
//          → { ok, organizationId, orgName, memberCount, deletedUsers, keptUsers }
//
// Нууц өгөгдөл (нууц үг, token, лого/тамга, бизнесийн бичилт) буцаахгүй —
// бодит өгөгдөлд хандах ганц зам нь аудитад бичигддэг дэмжлэгийн сесс.
// Устгалт нь БУЦААГДАХГҮЙ — lib/platform/org-purge.ts (нэр/ID баталгаажуулалт).
import { NextResponse } from "next/server";

import { platformActorLabel, platformFailure, platformGate } from "@/lib/api/platform-auth";
import { loadPlatformOrgDetail } from "@/lib/platform/org-detail";
import { purgeOrganizationFromPlatform } from "@/lib/platform/org-purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id)
    return NextResponse.json({ ok: false, error: "id шаардлагатай" }, { status: 400 });
  try {
    const org = await loadPlatformOrgDetail(id);
    if (!org)
      return NextResponse.json({ ok: false, error: "Байгууллага олдсонгүй" }, { status: 404 });
    return NextResponse.json({ ok: true, org });
  } catch (caught) {
    return platformFailure(caught);
  }
}

export async function DELETE(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  const params = new URL(request.url).searchParams;
  const id = params.get("id")?.trim();
  if (!id)
    return NextResponse.json({ ok: false, error: "id шаардлагатай" }, { status: 400 });
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // body-гүй DELETE — confirm нь query-д байж болно
  }
  const confirm =
    typeof body.confirm === "string" ? body.confirm : (params.get("confirm") ?? "");
  if (!confirm.trim())
    return NextResponse.json(
      { ok: false, error: "confirm (байгууллагын нэр эсвэл ID) шаардлагатай" },
      { status: 400 }
    );
  try {
    const result = await purgeOrganizationFromPlatform({
      organizationId: id,
      confirm,
      purgeOrphanUsers: body.purgeUsers === true,
      actor: platformActorLabel(body.actor),
    });
    if (!result)
      return NextResponse.json({ ok: false, error: "Байгууллага олдсонгүй" }, { status: 404 });
    return NextResponse.json({ ok: true, ...result });
  } catch (caught) {
    return platformFailure(caught);
  }
}

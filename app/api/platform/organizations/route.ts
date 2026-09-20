// Платформын API — байгууллагын ДЭЛГЭРЭНГҮЙ (Entry Console). Зөвхөн УНШИНА.
//
//   GET /api/platform/organizations?id=<uuid>   → { ok, org: PlatformOrgDetail }
//
// Нууц өгөгдөл (нууц үг, token, лого/тамга, бизнесийн бичилт) буцаахгүй —
// бодит өгөгдөлд хандах ганц зам нь аудитад бичигддэг дэмжлэгийн сесс.
import { NextResponse } from "next/server";

import { platformFailure, platformGate } from "@/lib/api/platform-auth";
import { loadPlatformOrgDetail } from "@/lib/platform/org-detail";

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

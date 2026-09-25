// Платформын API — багцын QPay төлбөрүүд (Entry Console). Зөвхөн УНШИНА.
//
//   GET /api/platform/billing-payments[?organizationId=&status=&limit=]
//       → { ok, rows: PlatformBillingPaymentRow[] }   (шинэ нь эхэнд, default 200)
//
// QR / deeplink / нууц буцаахгүй (lib/billing/platform-payments.ts).
import { NextResponse } from "next/server";

import { platformFailure, platformGate } from "@/lib/api/platform-auth";
import { listPlatformBillingPayments } from "@/lib/billing/platform-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  const params = new URL(request.url).searchParams;
  try {
    const rows = await listPlatformBillingPayments({
      organizationId: params.get("organizationId")?.trim() || null,
      status: params.get("status")?.trim() || null,
      limit: params.get("limit") ? Number(params.get("limit")) : null,
    });
    return NextResponse.json({ ok: true, rows });
  } catch (caught) {
    return platformFailure(caught);
  }
}

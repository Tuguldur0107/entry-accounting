// Платформын API — туршилтын funnel (Entry Console). Зөвхөн УНШИНА.
//
//   GET /api/platform/trial-funnel[?from=YYYY-MM-DD&to=YYYY-MM-DD&product=accounting|skills]
//       → { ok, funnel: TrialFunnel }   (default: сүүлийн 90 хоног, accounting)
//
// Бүртгүүлсэн → AI холбосон → мастер дата → анхны журнал → төлсөн; алхам бүрийн
// тоо, хувь, медиан хугацаа + байгууллага бүрийн мөр. Дүн, нууц буцаахгүй.
import { NextResponse } from "next/server";

import { platformFailure, platformGate } from "@/lib/api/platform-auth";
import { ulaanbaatarToday } from "@/lib/periods/document-date";
import { isFunnelProduct, parseFunnelRange } from "@/lib/platform/trial-funnel";
import { loadTrialFunnel } from "@/lib/platform/trial-funnel-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  const params = new URL(request.url).searchParams;
  try {
    const range = parseFunnelRange({ from: params.get("from"), to: params.get("to") }, ulaanbaatarToday());
    const product = params.get("product")?.trim() || "accounting";
    if (!isFunnelProduct(product)) throw new Error("product нь accounting эсвэл skills байна");
    const funnel = await loadTrialFunnel({ ...range, product });
    return NextResponse.json({ ok: true, funnel });
  } catch (caught) {
    return platformFailure(caught);
  }
}

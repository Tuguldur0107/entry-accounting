// Багцын ҮНИЙН тохиргоо — Entry Console эндээс уншиж, бичнэ (docs/billing §2).
// Үнэ нь ПЛАТФОРМЫН хэмжээнд нэг; байгууллагын тусгай үнэ нь subscriptions
// route-ийн `pricePerSeatMnt`.
//
//   GET  /api/platform/plan-prices   → { ok, prices, defaults }
//   PUT  /api/platform/plan-prices   body: { prices: [{planId, pricePerSeatMnt}], actor? }
import { NextResponse } from "next/server";

import {
  platformActorLabel,
  platformFailure,
  platformGate,
} from "@/lib/api/platform-auth";
import { DEFAULT_PLAN_PRICES } from "@/lib/billing/pricing";
import { loadPlanPrices, savePlanPrices, type PlanPriceInput } from "@/lib/billing/pricing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  const prices = await loadPlanPrices();
  return NextResponse.json({ ok: true, prices, defaults: DEFAULT_PLAN_PRICES });
}

export async function PUT(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  let body: { prices?: PlanPriceInput[]; actor?: string } | null = null;
  try {
    body = (await request.json()) as { prices?: PlanPriceInput[]; actor?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "JSON задлагдсангүй" }, { status: 400 });
  }
  if (!body || !Array.isArray(body.prices))
    return NextResponse.json({ ok: false, error: "prices массив шаардлагатай" }, { status: 400 });
  try {
    const { prices, changes } = await savePlanPrices(body.prices, {
      label: platformActorLabel(body.actor),
    });
    return NextResponse.json({ ok: true, prices, changes, defaults: DEFAULT_PLAN_PRICES });
  } catch (caught) {
    return platformFailure(caught);
  }
}

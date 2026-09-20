// Багцын ҮНИЙН ТҮҮХ — Entry Console эндээс уншиж, шинэ үе нэмж, устгана
// (docs/billing/00-proposal.md §5). Үнэ нь ОГНООНЫ МУЖТАЙ: багц бүрийн анхны
// үнэ, дараагийн шинэчлэлт, ирээдүйн үнэ тус тусдаа мөр.
// Байгууллагын тусгай үнэ нь subscriptions route-ийн `pricePerSeatMnt`.
//
//   GET    /api/platform/plan-prices  → { ok, periods, prices (өнөөдрийн), defaults, today }
//   POST   /api/platform/plan-prices  body: { planId, pricePerSeatMnt, effectiveFrom, effectiveTo?, note?, actor? }
//   DELETE /api/platform/plan-prices  body: { id, actor? }
import { NextResponse } from "next/server";

import {
  platformActorLabel,
  platformFailure,
  platformGate,
} from "@/lib/api/platform-auth";
import { DEFAULT_PLAN_PRICES, resolvePlanPricesAt } from "@/lib/billing/pricing";
import {
  addPlanPricePeriod,
  deletePlanPricePeriod,
  loadPlanPricePeriods,
  todayInUlaanbaatar,
  type AddPlanPriceInput,
} from "@/lib/billing/pricing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  const periods = await loadPlanPricePeriods();
  const today = todayInUlaanbaatar();
  return NextResponse.json({
    ok: true,
    periods,
    prices: resolvePlanPricesAt(periods, today),
    defaults: DEFAULT_PLAN_PRICES,
    today,
  });
}

export async function POST(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  let body: (AddPlanPriceInput & { actor?: string }) | null = null;
  try {
    body = (await request.json()) as AddPlanPriceInput & { actor?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "JSON задлагдсангүй" }, { status: 400 });
  }
  if (!body || typeof body.planId !== "string" || typeof body.effectiveFrom !== "string")
    return NextResponse.json(
      { ok: false, error: "planId ба effectiveFrom шаардлагатай" },
      { status: 400 }
    );
  try {
    const result = await addPlanPricePeriod(body, { label: platformActorLabel(body.actor) });
    const today = todayInUlaanbaatar();
    return NextResponse.json({
      ok: true,
      ...result,
      prices: resolvePlanPricesAt(result.periods, today),
      today,
    });
  } catch (caught) {
    return platformFailure(caught);
  }
}

export async function DELETE(request: Request) {
  const blocked = platformGate(request);
  if (blocked) return blocked;
  let body: { id?: string; actor?: string } | null = null;
  try {
    body = (await request.json()) as { id?: string; actor?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "JSON задлагдсангүй" }, { status: 400 });
  }
  if (!body || typeof body.id !== "string")
    return NextResponse.json({ ok: false, error: "id шаардлагатай" }, { status: 400 });
  try {
    const result = await deletePlanPricePeriod(body.id, { label: platformActorLabel(body.actor) });
    const today = todayInUlaanbaatar();
    return NextResponse.json({
      ok: true,
      ...result,
      prices: resolvePlanPricesAt(result.periods, today),
      today,
    });
  } catch (caught) {
    return platformFailure(caught);
  }
}

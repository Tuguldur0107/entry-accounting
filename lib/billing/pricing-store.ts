// Багцын үнийн DB давхарга ("use server" БИШ — action, API route, tool
// бүгд шууд дуудна). Цэвэр дүрэм `lib/billing/pricing.ts`.
//
// `platform_plan_prices` нь ПЛАТФОРМЫН лавлах: `organizationId` БАЙХГҮЙ
// (ханшийн хүснэгттэй ижил зарчим) — үнэ нь бүх харилцагчид нэг. Байгууллагын
// онцгой үнэ нь `organization_subscriptions.pricePerSeatMnt`.

import { db } from "@/lib/db";
import { platformPlanPrices } from "@/lib/db/schema";
import { isPlanId, type PlanId } from "@/lib/billing/plans";
import {
  describePlanPriceChanges,
  mergePlanPrices,
  parsePlanPriceInput,
  type PlanPriceMap,
} from "@/lib/billing/pricing";

/** Бүх багцын бодит үнэ — хүснэгт хоосон бол кодын default. */
export async function loadPlanPrices(): Promise<PlanPriceMap> {
  const rows = await db
    .select({ planId: platformPlanPrices.planId, pricePerSeatMnt: platformPlanPrices.pricePerSeatMnt })
    .from(platformPlanPrices);
  return mergePlanPrices(rows);
}

export type PlanPriceInput = { planId: string; pricePerSeatMnt: number | string | null };

/**
 * Багцын үнэ бичих — validation МОНГОЛ алдаагаар ШИДНЭ.
 * Өгөгдсөн багцуудыг л хөндөнө (бусад нь хэвээр).
 */
export async function savePlanPrices(
  input: PlanPriceInput[],
  actor: { label: string }
): Promise<{ prices: PlanPriceMap; changes: string[] }> {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Үнийн мөр өгөөгүй байна");
  const parsed = input.map((row) => {
    if (!isPlanId(row.planId)) throw new Error(`Багц буруу: ${String(row.planId)}`);
    return {
      planId: row.planId as PlanId,
      pricePerSeatMnt: parsePlanPriceInput(row.pricePerSeatMnt, `${row.planId} багцын үнэ`),
    };
  });
  const seen = new Set<string>();
  for (const row of parsed) {
    if (seen.has(row.planId)) throw new Error(`Багц давхардсан: ${row.planId}`);
    seen.add(row.planId);
  }

  const current = await loadPlanPrices();
  const now = new Date();
  for (const row of parsed) {
    await db
      .insert(platformPlanPrices)
      .values({ planId: row.planId, pricePerSeatMnt: row.pricePerSeatMnt, updatedAt: now })
      .onConflictDoUpdate({
        target: platformPlanPrices.planId,
        set: { pricePerSeatMnt: row.pricePerSeatMnt, updatedAt: now },
      });
  }
  const next = await loadPlanPrices();
  const changes = describePlanPriceChanges(current, next);
  // Платформын өөрчлөлтөд байгууллага/хэрэглэгч байхгүй тул аудитын мөр биш —
  // сервер лог (savePlatformSubscription-тай ижил зарчим).
  if (changes.length > 0) console.log(`[billing] багцын үнэ (${actor.label}): ${changes.join(" · ")}`);
  return { prices: next, changes };
}

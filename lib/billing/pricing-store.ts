// Багцын үнийн DB давхарга ("use server" БИШ — action, API route, tool
// бүгд шууд дуудна). Цэвэр дүрэм `lib/billing/pricing.ts`.
//
// `platform_plan_prices` нь ПЛАТФОРМЫН лавлах: `organizationId` БАЙХГҮЙ
// (ханшийн хүснэгттэй ижил зарчим). Мөр бүр нь ОГНООНЫ МУЖ — багц бүрийн
// үнийн ТҮҮХ энд хуримтлагдаж, тухайн өдөрт НЭГ л үе үйлчилнэ.

import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { platformPlanPrices } from "@/lib/db/schema";
import type { PlanId } from "@/lib/billing/plans";
import {
  describePeriod,
  planPriceChange,
  resolvePlanPricesAt,
  type PlanPriceMap,
  type PlanPricePeriod,
} from "@/lib/billing/pricing";

/** Улаанбаатарын өнөөдөр (YYYY-MM-DD) — үнэ хуанлийн өдрөөр мөрдөгдөнө. */
export function todayInUlaanbaatar(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ulaanbaatar" }).format(now);
}

export async function loadPlanPricePeriods(): Promise<PlanPricePeriod[]> {
  const rows = await db
    .select()
    .from(platformPlanPrices)
    .orderBy(asc(platformPlanPrices.planId), asc(platformPlanPrices.effectiveFrom));
  return rows.map((row) => ({
    id: row.id,
    planId: row.planId as PlanId,
    pricePerSeatMnt: row.pricePerSeatMnt,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    note: row.note,
  }));
}

/** Тухайн огноонд үйлчлэх бүх багцын үнэ (хамрах үегүй бол `plans.ts` default). */
export async function loadPlanPricesAt(date = todayInUlaanbaatar()): Promise<PlanPriceMap> {
  return resolvePlanPricesAt(await loadPlanPricePeriods(), date);
}

export type AddPlanPriceInput = {
  planId: string;
  pricePerSeatMnt: number | string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  note?: string | null;
};

/**
 * Шинэ үнийн үе нэмэх — давхцлыг `planPriceChange` шийднэ; хугацаагүй байсан
 * өмнөх үе автоматаар хаагдвал үр дүнд ИЛ буцаана. Validation МОНГОЛООР ШИДНЭ.
 */
export async function addPlanPricePeriod(
  input: AddPlanPriceInput,
  actor: { label: string }
): Promise<{ periods: PlanPricePeriod[]; closed: string | null; added: string }> {
  const existing = await loadPlanPricePeriods();
  const plan = planPriceChange(existing, {
    planId: input.planId,
    pricePerSeatMnt: input.pricePerSeatMnt,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
    note: input.note ?? null,
  });
  if (!plan.ok) throw new Error(plan.error);

  await db.transaction(async (tx) => {
    if (plan.closePreviousId && plan.closePreviousTo)
      await tx
        .update(platformPlanPrices)
        .set({ effectiveTo: plan.closePreviousTo, updatedAt: new Date() })
        .where(eq(platformPlanPrices.id, plan.closePreviousId));
    await tx.insert(platformPlanPrices).values(plan.period);
  });

  const closedPeriod = plan.closePreviousId
    ? existing.find((period) => period.id === plan.closePreviousId) ?? null
    : null;
  const closed =
    closedPeriod && plan.closePreviousTo
      ? describePeriod({ ...closedPeriod, effectiveTo: plan.closePreviousTo })
      : null;
  const added = `${plan.period.planId} · ${describePeriod(plan.period)}`;
  // Платформын өөрчлөлтөд org/user байхгүй тул аудитын мөр биш — сервер лог.
  console.log(`[billing] үнийн үе нэмэв (${actor.label}): ${added}${closed ? ` · өмнөх хаагдав ${closed}` : ""}`);
  return { periods: await loadPlanPricePeriods(), closed, added };
}

/** Буруу оруулсан үеийг устгана — түүх засварлах ЦОРЫН ГАНЦ зам. */
export async function deletePlanPricePeriod(
  id: string,
  actor: { label: string }
): Promise<{ periods: PlanPricePeriod[]; removed: string }> {
  const existing = await loadPlanPricePeriods();
  const period = existing.find((row) => row.id === id);
  if (!period) throw new Error("Үнийн үе олдсонгүй");
  await db.delete(platformPlanPrices).where(eq(platformPlanPrices.id, id));
  const removed = `${period.planId} · ${describePeriod(period)}`;
  console.log(`[billing] үнийн үе устгав (${actor.label}): ${removed}`);
  return { periods: await loadPlanPricePeriods(), removed };
}

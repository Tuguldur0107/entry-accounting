"use server";

// Периодын өртгийн тооцооллыг ажиллуулах.
// Тооцоолол нь ЦУВАА (C2 → дараагийн C1) тул үргэлж БҮХ периодыг дахин
// боддог — хэсэгчлэн шинэчлэх нь буруу үр дүн өгнө.

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth";
import { computePeriodCosting } from "@/lib/costing/period-close";
import { runPeriodicCosting } from "@/lib/costing/period-run";
import { loadInventoryBase } from "@/lib/inventory/load-data";
import { isPeriodCode } from "@/lib/periods/period";

export type RecalculateResult =
  | {
      ok: true;
      calculated: number;
      blocked: number;
      scopeCount: number;
      periodCodes: string[];
    }
  | { ok: false; code: "unauthenticated" | "failed"; message?: string };

export async function recalculatePeriodicCosting(): Promise<RecalculateResult> {
  const active = await requireRole("accountant").catch(() => null);
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId, userId } = active;

  try {
    const summary = await runPeriodicCosting(orgId, userId);
    revalidatePath("/costing");
    revalidatePath("/costing/reports");
    revalidatePath("/costing/control");
    return {
      ok: true,
      calculated: summary.calculated,
      blocked: summary.blocked,
      scopeCount: summary.scopeCount,
      periodCodes: summary.periodCodes,
    };
  } catch (caught) {
    return {
      ok: false,
      code: "failed",
      message: caught instanceof Error ? caught.message : "Тооцоолол амжилтгүй",
    };
  }
}

export type PeriodCostingActionResult =
  | {
      ok: true;
      valued: number;
      alreadyValued: number;
      zeroValued: number;
      blockers: { label: string; reason: string }[];
    }
  | {
      ok: false;
      code: "unauthenticated" | "invalid-period" | "failed";
      message?: string;
    };

/**
 * Сарын өртөг тооцох — зарлага, тооллогын тохируулга, буцаалтыг тухайн
 * сарын жигнэсэн дундажаар үнэлж НООРОГ бичилт болгоно. GL-д бичих нь
 * дараагийн тусдаа алхам (нягтланчийн баталгаажуулалт).
 *
 * Блоклогдсон бараа-агуулах байвал ямар ч бичилт үүсгэхгүй — өртгийг
 * зохиохгүй, шалтгааныг нь буцаана.
 */
export async function computeMonthlyCosting(
  periodCode: string
): Promise<PeriodCostingActionResult> {
  const active = await requireRole("accountant").catch(() => null);
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId, userId } = active;
  if (!isPeriodCode(periodCode)) return { ok: false, code: "invalid-period" };

  try {
    const summary = await computePeriodCosting(orgId, userId, periodCode);

    // Блоклогдсон мөрүүдийг хүнд ойлгомжтой шошготой болгоно.
    const labels = await loadScopeLabels(
      orgId,
      summary.blockers.map((entry) => entry)
    );

    revalidatePath("/costing");
    revalidatePath("/costing/entries");
    revalidatePath("/costing/control");
    revalidatePath("/costing/detail");
    return {
      ok: true,
      valued: summary.valued,
      alreadyValued: summary.alreadyValued,
      zeroValued: summary.zeroValued,
      blockers: labels,
    };
  } catch (caught) {
    return {
      ok: false,
      code: "failed",
      message: caught instanceof Error ? caught.message : "Тооцоолол амжилтгүй",
    };
  }
}

async function loadScopeLabels(
  orgId: string,
  blockers: { itemId: string; warehouseId: string; reason: string }[]
): Promise<{ label: string; reason: string }[]> {
  if (blockers.length === 0) return [];
  const { itemViews, warehouseViews } = await loadInventoryBase(orgId);
  const itemById = new Map(itemViews.map((item) => [item.id, item]));
  const warehouseById = new Map(
    warehouseViews.map((warehouse) => [warehouse.id, warehouse])
  );
  return blockers.map((entry) => {
    const item = itemById.get(entry.itemId);
    const warehouse = warehouseById.get(entry.warehouseId);
    return {
      label: `${item ? `${item.code} · ${item.name}` : entry.itemId} — ${
        warehouse ? warehouse.name : entry.warehouseId
      }`,
      reason: entry.reason,
    };
  });
}

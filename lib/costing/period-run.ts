// Периодын өртгийн тооцоолол — DB талын нэгтгэл.
//
// Хөдөлгөөн (Inventory Ledger) → PeriodicMovement → цэвэр хөдөлгөгч
// (lib/costing/periodic.ts) → cost_period_results (Cost Ledger-ийн
// периодын үр дүн). GL-ээс өртөг бодохгүй (FR-ARCH-002).
//
// Хөдөлгөөний чиглэлийн зураглал:
//   receipt / return_in / adjustment(+) → "in"
//   issue / return_out / adjustment(−)  → "out"
//   transfer                            → үнэлгээнд ОРОХГҮЙ (хамрах хүрээ
//     хооронд шилжих үнэлгээ нь OD-014 нээлттэй шийдвэр). Тоо хэмжээ нь
//     Inventory Ledger-т хэвийн хөдөлнө; өртгийн үр дүнд тусгагдахгүй тул
//     энэ нь тайланд ил ЗӨРҮҮ болж харагдана.

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  costEntries,
  costPeriodResults,
  inventoryMovements,
} from "@/lib/db/schema";
import { periodCodeOf, periodCodesBetween } from "@/lib/periods/period";
import {
  computeAllScopes,
  type PeriodicMovement,
  type PeriodicResult,
} from "./periodic";

/** Үнэлгээнд орохгүй хөдөлгөөний төрлүүд (OD-014 нээлттэй). */
const EXCLUDED_TYPES = new Set(["transfer"]);

/**
 * Орлогын үнэлгээний хэлбэр: худалдан авалт нь эх баримтаас өртөгтэй ирнэ;
 * тооллогын илүүдэл, худалдан авагчаас буцаж ирсэн бараа нь худалдан авах
 * үнэгүй тул сарын дунджаар үнэлэгдэнэ (README change-control 0.2).
 */
function inboundValuationOf(movementType: string): "priced" | "average" {
  return movementType === "receipt" ? "priced" : "average";
}

function directionOf(
  movementType: string,
  quantity: number
): "in" | "out" | null {
  if (EXCLUDED_TYPES.has(movementType)) return null;
  switch (movementType) {
    case "receipt":
    case "return_in":
      return "in";
    case "issue":
    case "return_out":
      return "out";
    case "adjustment":
      // Тэмдэгтэй: илүүдэл орлого, дутагдал зарлага.
      return quantity >= 0 ? "in" : "out";
    default:
      return null;
  }
}

export interface PeriodRunSummary {
  periodCodes: string[];
  scopeCount: number;
  calculated: number;
  blocked: number;
  /** Блоклогдсон бараа-агуулах-периодууд (UI-д ил харуулна). */
  blockedRows: {
    periodCode: string;
    itemId: string;
    warehouseId: string;
    reason: string;
  }[];
}

/**
 * Бүх (эсвэл заасан) периодын үр дүнг дахин тооцоолж хадгална.
 *
 * `throughPeriod` — үүнийг ОРУУЛААД хүртэл. Өгөхгүй бол хамгийн сүүлийн
 * хөдөлгөөний период хүртэл.
 */
export async function runPeriodicCosting(
  userId: string,
  options?: { throughPeriod?: string }
): Promise<PeriodRunSummary> {
  const movements = await db.query.inventoryMovements.findMany({
    where: and(
      eq(inventoryMovements.userId, userId),
      eq(inventoryMovements.status, "confirmed")
    ),
    columns: {
      id: true,
      date: true,
      itemId: true,
      warehouseId: true,
      movementType: true,
      quantity: true,
    },
  });

  const valued = movements.filter(
    (movement) => movement.itemId && movement.warehouseId
  );
  if (valued.length === 0)
    return {
      periodCodes: [],
      scopeCount: 0,
      calculated: 0,
      blocked: 0,
      blockedRows: [],
    };

  // Орлогын мөнгөн дүн: тухайн хөдөлгөөнд холбогдсон ИДЭВХТЭЙ (ноорог эсвэл
  // батлагдсан) ӨРТӨГТЭЙ бичилтээс — худалдан авалт ба нэмэлт зардал.
  // Тооллогын илүүдэл, буцаж ирсэн бараа нь худалдан авах үнэгүй тул
  // САРЫН ДУНДАЖААР үнэлэгдэнэ (README change-control 0.2) — тэдгээрийг
  // дундажийн тоологч/хуваарьт ОРУУЛАХГҮЙ.
  const entries = await db.query.costEntries.findMany({
    where: and(
      eq(costEntries.userId, userId),
      inArray(costEntries.status, ["draft", "posted"])
    ),
    columns: {
      movementId: true,
      entryType: true,
      quantity: true,
      unitCost: true,
      amount: true,
    },
  });
  const inboundAmountByMovement = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.movementId) continue;
    // Зөвхөн ОРЛОГЫН талын бичилт мөнгөн дүн авчирна; зарлагын дүн нь
    // периодын дунджаас гардаг тул эх өгөгдөл БИШ.
    if (
      entry.entryType === "receipt_capitalize" ||
      entry.entryType === "landed_cost"
    )
      inboundAmountByMovement.set(
        entry.movementId,
        (inboundAmountByMovement.get(entry.movementId) ?? 0) +
          Number(entry.amount)
      );
  }

  const periodic: PeriodicMovement[] = [];
  for (const movement of valued) {
    const quantity = Number(movement.quantity);
    const direction = directionOf(movement.movementType, quantity);
    if (!direction) continue;
    periodic.push({
      id: movement.id,
      date: movement.date,
      itemId: movement.itemId!,
      warehouseId: movement.warehouseId!,
      direction,
      quantity: Math.abs(quantity),
      ...(direction === "in"
        ? {
            inboundValuation: inboundValuationOf(movement.movementType),
            inboundAmount:
              inboundValuationOf(movement.movementType) === "priced"
                ? (inboundAmountByMovement.get(movement.id) ?? null)
                : undefined,
          }
        : {}),
    });
  }

  if (periodic.length === 0)
    return {
      periodCodes: [],
      scopeCount: 0,
      calculated: 0,
      blocked: 0,
      blockedRows: [],
    };

  const codes = periodic.map((movement) => periodCodeOf(movement.date)).sort();
  const first = codes[0];
  const last = options?.throughPeriod ?? codes[codes.length - 1];
  const periodCodes = periodCodesBetween(first, last);

  const byScope = computeAllScopes({ periodCodes, movements: periodic });

  // Бичилт: хамрах хүрээ бүрийн БҮХ периодыг дахин бичнэ (тооцоолол нь
  // цуваа тул хэсэгчлэн шинэчлэх нь буруу үр дүн өгнө).
  const rows: (typeof costPeriodResults.$inferInsert)[] = [];
  const blockedRows: PeriodRunSummary["blockedRows"] = [];
  let calculated = 0;
  let blocked = 0;

  for (const results of byScope.values()) {
    for (const result of results) {
      // Огт хөдөлгөөнгүй, үлдэгдэлгүй периодыг хадгалахгүй (чимээ).
      if (
        result.movementIds.length === 0 &&
        result.openingQty === 0 &&
        result.closingQty === 0
      )
        continue;

      if (result.status === "calculated") calculated += 1;
      else {
        blocked += 1;
        blockedRows.push({
          periodCode: result.periodCode,
          itemId: result.itemId,
          warehouseId: result.warehouseId,
          reason: result.blockReason ?? "Тооцоологдоогүй",
        });
      }
      rows.push(toRow(userId, result));
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(costPeriodResults)
      .where(eq(costPeriodResults.userId, userId));
    // Багцлан оруулна — мөр олон байж болно.
    for (let index = 0; index < rows.length; index += 500)
      await tx.insert(costPeriodResults).values(rows.slice(index, index + 500));
  });

  return {
    periodCodes,
    scopeCount: byScope.size,
    calculated,
    blocked,
    blockedRows,
  };
}

function toRow(
  userId: string,
  result: PeriodicResult
): typeof costPeriodResults.$inferInsert {
  const num = (value: number | null) => (value === null ? null : String(value));
  return {
    userId,
    periodCode: result.periodCode,
    itemId: result.itemId,
    warehouseId: result.warehouseId,
    openingQty: String(result.openingQty),
    openingAmount: String(result.openingAmount),
    inboundQty: String(result.inboundQty),
    inboundAmount: String(result.inboundAmount),
    outboundQty: String(result.outboundQty),
    averageUnitCost: num(result.averageUnitCost),
    outboundAmount: num(result.outboundAmount),
    closingQty: String(result.closingQty),
    closingAmount: num(result.closingAmount),
    qtyBalanced: result.qtyBalanced,
    amountBalanced: result.amountBalanced,
    status: result.status,
    blockReason: result.blockReason,
    calculatedAt: new Date(),
  };
}

/** Хадгалагдсан периодын үр дүнг унших (тайлангуудад). */
export async function loadPeriodResults(
  userId: string,
  periodCode: string
): Promise<(typeof costPeriodResults.$inferSelect)[]> {
  return db.query.costPeriodResults.findMany({
    where: and(
      eq(costPeriodResults.userId, userId),
      eq(costPeriodResults.periodCode, periodCode)
    ),
  });
}

// САРЫН ӨРТӨГ ТООЦОХ — зарлагыг сарын жигнэсэн дундажаар үнэлж GL-д бичнэ.
//
// Product owner-ийн шийдвэр (README change-control 0.3): "сар дуусаад бүх
// зардал бүртгэгдсэний дараа өртөг тооцно, дундаж өртгийн арга ашиглана,
// тэгэхээр зөрүү үүсэхгүй". Тиймээс:
//
//   • Худалдан авалтын орлого — эх баримтаас өртөгтэй ирдэг тул батлагдмагц
//     шууд GL-д бичигдэнэ (Dr бараа / Cr клиринг). Дундажийг ЭНЭ тодорхойлно.
//   • Зарлага, тооллогын тохируулга, буцаалт — сарын дундаж гарах хүртэл
//     ХҮЛЭЭНЭ. Сар тооцоход л өртөг оноож GL-д бичнэ.
//
// Ингэснээр сарын сүүлд орсон үнэтэй орлого сарын эхэнд гарсан зарлагын
// өртгийг ч зөв тусгаж, тайлан ба GL хооронд зөрүү үүсэхгүй.

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  costEntries,
  costPeriodResults,
  inventoryMovements,
  type InventoryMovement,
} from "@/lib/db/schema";
import { periodRange } from "@/lib/periods/period";
import type { CostEntryType } from "./costing";
import { runPeriodicCosting } from "./period-run";
import { scopeKey } from "./periodic";
import { roundMoney as round2 } from "@/lib/arap/accounting";

/** Сарын дундажаар үнэлэгдэх хөдөлгөөний entry төрөл. */
function averageValuedEntryType(
  movement: InventoryMovement
): CostEntryType | null {
  const quantity = Number(movement.quantity);
  switch (movement.movementType) {
    case "issue":
      return "issue_cogs";
    case "return_out":
      return "return_out";
    case "return_in":
      return "return_in";
    case "adjustment":
      return quantity >= 0 ? "adjustment_gain" : "adjustment_loss";
    // Худалдан авалт нь өртөгтэй ирдэг, шилжүүлэг үнэлэгдэхгүй (OD-014).
    default:
      return null;
  }
}

export interface PeriodCloseBlocker {
  itemId: string;
  warehouseId: string;
  reason: string;
}

export interface PeriodCostingSummary {
  periodCode: string;
  /** Дундаж дээр үндэслэн үнэлэгдсэн хөдөлгөөний тоо. */
  valued: number;
  /** Аль хэдийн үнэлэгдсэн (дахин үнэлэгдээгүй) тоо. */
  alreadyValued: number;
  /** Дундаж 0 тул бичилт үүсээгүй тоо. */
  zeroValued: number;
  blockers: PeriodCloseBlocker[];
}

const round4 = (value: number) => Math.round(value * 10000) / 10000;

/**
 * Тухайн сарын өртгийг тооцож, зарлага/тохируулга/буцаалтын өртгийн
 * бичилтүүдийг НООРОГ болгож үүсгэнэ (эсвэл байгааг шинэчилнэ).
 * Батлах (GL-д бичих) нь дараагийн тусдаа алхам — human-in-the-loop
 * (knowledge/…/human-in-the-loop.md, FR-UX-002).
 *
 * Блоклогдсон бараа-агуулах байвал бичилт үүсгэхгүй ЗОГСОНО — үнэ зохиохгүй.
 */
export async function computePeriodCosting(
  orgId: string,
  /** Үүсэх ноорог бичилтийн createdBy — дуудаж буй хэрэглэгч. */
  userId: string,
  periodCode: string
): Promise<PeriodCostingSummary> {
  // 1. Бүх сарыг дахин тооцно (C1 → C2 цуваа тул хэсэгчилж болохгүй).
  await runPeriodicCosting(orgId, userId);

  // 2. Тухайн сарын үр дүн.
  const results = await db.query.costPeriodResults.findMany({
    where: and(
      eq(costPeriodResults.organizationId, orgId),
      eq(costPeriodResults.periodCode, periodCode)
    ),
  });

  const blockers: PeriodCloseBlocker[] = results
    .filter((row) => row.status !== "calculated")
    .map((row) => ({
      itemId: row.itemId,
      warehouseId: row.warehouseId,
      reason: row.blockReason ?? "Тооцоологдоогүй",
    }));

  const averageByScope = new Map<string, number | null>();
  for (const row of results)
    averageByScope.set(
      scopeKey(row.itemId, row.warehouseId),
      row.averageUnitCost === null ? null : Number(row.averageUnitCost)
    );

  const { startDate, endDate } = periodRange(periodCode);

  // 3. Тухайн сарын батлагдсан хөдөлгөөнүүд.
  const movements = await db.query.inventoryMovements.findMany({
    where: and(
      eq(inventoryMovements.organizationId, orgId),
      eq(inventoryMovements.status, "confirmed"),
      gte(inventoryMovements.date, startDate),
      lte(inventoryMovements.date, endDate)
    ),
  });

  const targets = movements.filter(
    (movement) =>
      movement.itemId &&
      movement.warehouseId &&
      averageValuedEntryType(movement) !== null
  );
  if (targets.length === 0)
    return {
      periodCode,
      valued: 0,
      alreadyValued: 0,
      zeroValued: 0,
      blockers,
    };

  // Блоклогдсон хамрах хүрээтэй хөдөлгөөн байвал ямар ч бичилт үүсгэхгүй.
  const blockedScopes = new Set(
    blockers.map((entry) => scopeKey(entry.itemId, entry.warehouseId))
  );
  const blockedTarget = targets.find((movement) =>
    blockedScopes.has(scopeKey(movement.itemId!, movement.warehouseId!))
  );
  if (blockedTarget)
    return {
      periodCode,
      valued: 0,
      alreadyValued: 0,
      zeroValued: 0,
      blockers,
    };

  let valued = 0;
  let alreadyValued = 0;
  let zeroValued = 0;

  await db.transaction(async (tx) => {
    // Давхар тооцооллоос хамгаална (хоёр зэрэг дуудалт нэг хөдөлгөөнийг
    // хоёр удаа үнэлэхээс сэргийлнэ).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 3)`);

    const existing = await tx.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        inArray(costEntries.status, ["draft", "posted"]),
        inArray(
          costEntries.movementId,
          targets.map((movement) => movement.id)
        )
      ),
    });
    const activeByMovement = new Map(
      existing
        .filter((entry) => entry.movementId)
        .map((entry) => [entry.movementId!, entry])
    );

    for (const movement of targets) {
      const entryType = averageValuedEntryType(movement)!;
      const average = averageByScope.get(
        scopeKey(movement.itemId!, movement.warehouseId!)
      );
      if (average === undefined || average === null) continue;

      const quantity = Math.abs(Number(movement.quantity));
      const unitCost = round4(average);
      const amount = round2(quantity * average);
      const current = activeByMovement.get(movement.id);

      if (current?.status === "posted") {
        // Аль хэдийн GL-д бичигдсэн (хуучин өгөгдөл) — түүхийг дарж
        // бичихгүй. Зөрүү нь тулгалтын тайланд ил харагдана.
        alreadyValued += 1;
        continue;
      }

      if (amount === 0) {
        zeroValued += 1;
        // Дахин тооцоход 0 болсон хуучин НООРОГ бичилт хуучин дүнгээрээ
        // үлдэж батлагдах ёсгүй — устгана (энд current нь үргэлж draft:
        // posted-ыг дээр аль хэдийн алгассан).
        if (current)
          await tx.delete(costEntries).where(eq(costEntries.id, current.id));
        continue;
      }

      const values = {
        userId,
        organizationId: orgId,
        movementId: movement.id,
        itemId: movement.itemId,
        warehouseId: movement.warehouseId,
        periodCode,
        issueTypeId: movement.issueTypeId,
        entryType,
        date: movement.date,
        quantity: String(quantity),
        unitCost: String(unitCost),
        amount: String(amount),
        valuationSource: "avg_cost" as const,
      };

      if (current)
        await tx
          .update(costEntries)
          .set({
            unitCost: values.unitCost,
            amount: values.amount,
            periodCode,
            itemId: values.itemId,
            warehouseId: values.warehouseId,
            issueTypeId: values.issueTypeId,
            entryType,
            valuationSource: "avg_cost",
          })
          .where(eq(costEntries.id, current.id));
      else await tx.insert(costEntries).values(values);

      valued += 1;
    }
  });

  return { periodCode, valued, alreadyValued, zeroValued, blockers };
}

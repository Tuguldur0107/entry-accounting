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

import {
  movementCostSign,
  signedCostAmount,
  trueUpDelta,
} from "./provisional-cost";
import {
  COGS_TRUE_UP_ENTRY_TYPE,
  PROVISIONAL_VALUATION_SOURCE,
} from "@/lib/pos/constants";

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
    // Худалдан авалт нь өртөгтэй ирдэг; шилжүүлэг хүрээ хооронд дүн шилжүүлэх
    // боловч бараа материалын данс нэг тул GL бичилтгүй (OD-014, 0.9).
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
  /** Урьдчилсан COGS-ийг залруулсан (ноорог cogs_true_up үүссэн/шинэчилсэн) тоо. */
  trueUps: number;
  /** Аль хэдийн үнэлэгдсэн (дахин үнэлэгдээгүй) тоо. */
  alreadyValued: number;
  /** Дундаж 0 тул бичилт үүсээгүй тоо. */
  zeroValued: number;
  /** Блоклогдсон хүрээнд хамаарч ҮНЭЛЭГДЭЭГҮЙ хөдөлгөөний тоо. */
  blockedMovements: number;
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
  // 1. Хаагдсан үеийн зангуунаас хойшхи бүх сарыг дахин тооцно (C1 → C2
  //    цуваа тул зангууны дараахыг хэсэгчилж болохгүй; period-run.ts).
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
      trueUps: 0,
      alreadyValued: 0,
      zeroValued: 0,
      blockedMovements: 0,
      blockers,
    };

  // Блоклогдсон хүрээ нь ЗӨВХӨН өөрийн хөдөлгөөнийг зогсооно — бусад
  // бараа-агуулахыг үргэлжлүүлэн үнэлнэ (ENT-043: урьд нэг блок сарын БҮХ
  // COGS-ыг 0 болгодог байв). Сар хаалт нь closePeriod-ийн
  // `unvalued-movements` хоригоор блоклогдсон хүрээг засагдтал хориглосон
  // хэвээр тул дутуу үнэлгээ GL-д чимээгүй үлдэхгүй.
  const blockedScopes = new Set(
    blockers.map((entry) => scopeKey(entry.itemId, entry.warehouseId))
  );

  let valued = 0;
  let blockedMovements = 0;
  let trueUps = 0;
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
    // ҮНДСЭН үнэлгээний бичилт (нэг л идэвхтэй) ба залруулгууд тусдаа.
    const activeByMovement = new Map(
      existing
        .filter((entry) => entry.movementId && entry.entryType !== COGS_TRUE_UP_ENTRY_TYPE)
        .map((entry) => [entry.movementId!, entry])
    );
    const trueUpsByMovement = new Map<string, typeof existing>();
    for (const entry of existing) {
      if (!entry.movementId || entry.entryType !== COGS_TRUE_UP_ENTRY_TYPE) continue;
      trueUpsByMovement.set(entry.movementId, [
        ...(trueUpsByMovement.get(entry.movementId) ?? []),
        entry,
      ]);
    }

    for (const movement of targets) {
      const entryType = averageValuedEntryType(movement)!;
      const key = scopeKey(movement.itemId!, movement.warehouseId!);
      const average = averageByScope.get(key);
      if (blockedScopes.has(key) || average === undefined || average === null) {
        if (blockedScopes.has(key)) {
          blockedMovements += 1;
          // Өмнөх тооцооны НООРОГ дүн хуучирсан — дундаж тодорхойгүй болсон
          // тул хуучин дүнгээрээ батлагдахаас сэргийлж устгана (posted-ыг
          // хөндөхгүй).
          const stale = activeByMovement.get(movement.id);
          if (stale?.status === "draft")
            await tx.delete(costEntries).where(eq(costEntries.id, stale.id));
          for (const row of (trueUpsByMovement.get(movement.id) ?? []).filter(
            (entry) => entry.status === "draft"
          ))
            await tx.delete(costEntries).where(eq(costEntries.id, row.id));
        }
        continue;
      }

      const quantity = Math.abs(Number(movement.quantity));
      const unitCost = round4(average);
      const amount = round2(quantity * average);
      const current = activeByMovement.get(movement.id);

      if (current?.status === "posted") {
        if (current.valuationSource !== PROVISIONAL_VALUATION_SOURCE) {
          // Аль хэдийн GL-д бичигдсэн (хуучин өгөгдөл) — түүхийг дарж
          // бичихгүй. Зөрүү нь тулгалтын тайланд ил харагдана.
          alreadyValued += 1;
          continue;
        }
        // POS урьдчилсан COGS (docs/pos §3.7): posted бичилтийг ХӨНДӨХГҮЙ,
        // эцсийн дунджаас зөрүүг ТЭМДЭГТЭЙ залруулгаар (cogs_true_up, ноорог)
        // нөхнө. Σ(posted урьдчилсан + posted залруулга) + энэ ноорог = эцсийн.
        // Идемпотент: ноорог залруулга дахин бодогдоно, posted-ыг давхардуулахгүй.
        const sign = movementCostSign(movement.movementType);
        const finalSigned = round2(sign * quantity * average);
        const trueUpRows = trueUpsByMovement.get(movement.id) ?? [];
        const postedSigned = [
          signedCostAmount(current),
          ...trueUpRows
            .filter((row) => row.status === "posted")
            .map((row) => signedCostAmount(row)),
        ];
        const delta = trueUpDelta(finalSigned, postedSigned);
        const draftTrueUp = trueUpRows.find((row) => row.status === "draft") ?? null;
        if (delta === 0) {
          if (draftTrueUp)
            await tx.delete(costEntries).where(eq(costEntries.id, draftTrueUp.id));
          alreadyValued += 1;
          continue;
        }
        const trueUpValues = {
          userId,
          organizationId: orgId,
          movementId: movement.id,
          itemId: movement.itemId,
          warehouseId: movement.warehouseId,
          periodCode,
          issueTypeId: current.issueTypeId ?? movement.issueTypeId,
          entryType: COGS_TRUE_UP_ENTRY_TYPE,
          date: movement.date,
          quantity: String(quantity),
          unitCost: String(unitCost),
          amount: String(delta),
          valuationSource: "avg_cost" as const,
          trueUpOfEntryId: current.id,
          businessObjectType: current.businessObjectType,
          businessObjectId: current.businessObjectId,
        };
        if (draftTrueUp)
          await tx
            .update(costEntries)
            .set({
              unitCost: trueUpValues.unitCost,
              amount: trueUpValues.amount,
              quantity: trueUpValues.quantity,
              periodCode,
              issueTypeId: trueUpValues.issueTypeId,
              trueUpOfEntryId: current.id,
            })
            .where(eq(costEntries.id, draftTrueUp.id));
        else await tx.insert(costEntries).values(trueUpValues);
        trueUps += 1;
        continue;
      }
      // Урьдчилсан бичилтгүй хөдөлгөөнд хуучин ноорог залруулга үлдсэн бол
      // (урьдчилсан нь буцаагдсан) — хуучирсан тул устгана.
      for (const stale of (trueUpsByMovement.get(movement.id) ?? []).filter((row) => row.status === "draft"))
        await tx.delete(costEntries).where(eq(costEntries.id, stale.id));

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

  return {
    periodCode,
    valued,
    trueUps,
    alreadyValued,
    zeroValued,
    blockedMovements,
    blockers,
  };
}

// УРЬДЧИЛСАН COGS — борлуулах мөчийн ЯВЦЫН ДУНДАЖ (docs/pos/00-proposal.md §3.7,
// docs/cost/README.md change-control 0.8).
//
// Томьёо PWA-тай ИЖИЛ, зөвхөн "өнөөдрийг хүртэл":
//   provisionalAvg = (зангуу C2.amount + зангуунаас хойшхи ӨРТӨГТЭЙ орлого.amount)
//                  / (зангуу C2.qty   + зангуунаас хойшхи ӨРТӨГТЭЙ орлого.qty)
// Зангуу = тухайн бараа×агуулахын хамгийн сүүлийн ТООЦООЛОГДСОН cost_period_results
// (борлуулалтын сараас ӨМНӨХ период). Зарлага дундажид НӨЛӨӨЛӨХГҮЙ (moving
// average БИШ). Өртөгтэй тоо ≤ 0 → null: бичилт үүсэхгүй, үнэ ЗОХИОХГҮЙ —
// сар хаалтад л үнэлэгдэнэ.
//
// Сар хаалтад эцсийн дундажтай зөрүү нь cogs_true_up залруулгаар нөхөгдөнө
// (lib/costing/period-close.ts). Цэвэр функцүүд тесттэй: tests/provisional-cost.test.ts.

import { and, eq, gt, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { costEntries, costPeriodResults, inventoryMovements } from "@/lib/db/schema";
import { periodRange } from "@/lib/periods/period";
import { scopeKey } from "./periodic";

export interface ProvisionalInputs {
  /** Зангуу (сүүлийн тооцоологдсон сарын C2) — байхгүй бол 0/0. */
  anchor: { qty: number; amount: number } | null;
  /** Зангуунаас хойшхи өртөгтэй орлого (receipt_capitalize + landed_cost). */
  inbound: { qty: number; amount: number };
}

/** Явцын дундаж нэгж өртөг — өртөгтэй тоо ≤ 0 бол null (зохиохгүй). */
export function computeProvisionalAverage(inputs: ProvisionalInputs): number | null {
  const qty = (inputs.anchor?.qty ?? 0) + inputs.inbound.qty;
  const amount = (inputs.anchor?.amount ?? 0) + inputs.inbound.amount;
  if (!(qty > 0.00005)) return null;
  const average = amount / qty;
  if (!Number.isFinite(average) || average < 0) return null;
  return average;
}

/**
 * Залруулгын дүн: эцсийн (сарын дунджаар) тэмдэгтэй дүн − аль хэдийн posted
 * тэмдэгтэй дүнгүүдийн нийлбэр. |delta| < 0.01 → 0 (залруулга хэрэггүй).
 * Тэмдэг: + = Dr COGS / Cr Бараа чиглэл.
 */
export function trueUpDelta(finalSigned: number, postedSigned: number[]): number {
  const effective = postedSigned.reduce((sum, value) => sum + value, 0);
  const delta = Math.round((finalSigned - effective) * 100) / 100;
  return Math.abs(delta) < 0.01 ? 0 : delta;
}

/** Өртгийн бичилтийн ТЭМДЭГТЭЙ дүн (COGS-ийн чиглэлээр). */
export function signedCostAmount(entry: { entryType: string; amount: number | string }): number {
  const amount = Number(entry.amount);
  switch (entry.entryType) {
    case "issue_cogs":
    case "return_out":
      return amount;
    case "return_in":
      return -amount;
    case "cogs_true_up":
      return amount; // аль хэдийн тэмдэгтэй хадгалагдсан
    default:
      return 0;
  }
}

/** Хөдөлгөөний төрлөөс эцсийн тэмдэг (issue +, return_in −). */
export function movementCostSign(movementType: string): 1 | -1 | 0 {
  switch (movementType) {
    case "issue":
    case "return_out":
      return 1;
    case "return_in":
      return -1;
    default:
      return 0;
  }
}

type QueryHandle = Pick<typeof db, "query" | "select">;

/**
 * Бараа×агуулах бүрийн явцын дундаж — POS борлуулалтын транзакц дотор (tx)
 * дуудна. `beforePeriod` = борлуулалтын сар (YYYY-MM): зангуу үүнээс өмнөх
 * тооцоологдсон сар.
 */
export async function loadProvisionalUnitCosts(
  handle: QueryHandle,
  orgId: string,
  scopes: { itemId: string; warehouseId: string }[],
  beforePeriod: string
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  if (scopes.length === 0) return result;
  const itemIds = [...new Set(scopes.map((scope) => scope.itemId))];

  const rows = await handle.query.costPeriodResults.findMany({
    where: and(
      eq(costPeriodResults.organizationId, orgId),
      eq(costPeriodResults.status, "calculated"),
      inArray(costPeriodResults.itemId, itemIds)
    ),
    columns: {
      itemId: true,
      warehouseId: true,
      periodCode: true,
      closingQty: true,
      closingAmount: true,
    },
  });
  const anchors = new Map<string, { periodCode: string; qty: number; amount: number }>();
  for (const row of rows) {
    if (row.periodCode >= beforePeriod) continue;
    const key = scopeKey(row.itemId, row.warehouseId);
    const current = anchors.get(key);
    if (current && current.periodCode >= row.periodCode) continue;
    anchors.set(key, {
      periodCode: row.periodCode,
      qty: Number(row.closingQty),
      amount: Number(row.closingAmount ?? 0),
    });
  }

  // Зангуунаас хойшхи өртөгтэй орлого — хамгийн эрт зангуунаас хойшхи бүх
  // орлогыг ачаалаад scope бүрд өөрийнх нь зангуугаар шүүнэ.
  const earliest = [...anchors.values()].reduce<string | null>(
    (min, anchor) => (min === null || anchor.periodCode < min ? anchor.periodCode : min),
    null
  );
  const hasUnanchored = scopes.some((scope) => !anchors.has(scopeKey(scope.itemId, scope.warehouseId)));
  const afterDate = earliest && !hasUnanchored ? periodRange(earliest).endDate : null;
  const movements = await handle.query.inventoryMovements.findMany({
    where: and(
      eq(inventoryMovements.organizationId, orgId),
      eq(inventoryMovements.status, "confirmed"),
      eq(inventoryMovements.movementType, "receipt"),
      inArray(inventoryMovements.itemId, itemIds),
      ...(afterDate ? [gt(inventoryMovements.date, afterDate)] : [])
    ),
    columns: { id: true, itemId: true, warehouseId: true, date: true, quantity: true },
  });
  const entries =
    movements.length === 0
      ? []
      : await handle.query.costEntries.findMany({
          where: and(
            eq(costEntries.organizationId, orgId),
            inArray(costEntries.status, ["draft", "posted"]),
            inArray(costEntries.entryType, ["receipt_capitalize", "landed_cost"]),
            inArray(
              costEntries.movementId,
              movements.map((movement) => movement.id)
            )
          ),
          columns: { movementId: true, amount: true },
        });
  const amountByMovement = new Map<string, number>();
  for (const entry of entries)
    if (entry.movementId)
      amountByMovement.set(
        entry.movementId,
        (amountByMovement.get(entry.movementId) ?? 0) + Number(entry.amount)
      );

  const inbound = new Map<string, { qty: number; amount: number }>();
  for (const movement of movements) {
    if (!movement.itemId || !movement.warehouseId) continue;
    const key = scopeKey(movement.itemId, movement.warehouseId);
    const anchor = anchors.get(key);
    if (anchor && movement.date <= periodRange(anchor.periodCode).endDate) continue;
    // Өртөггүй орлого (капитализаци хийгдээгүй) дундажид ОРОХГҮЙ — PWA-тай ижил.
    const amount = amountByMovement.get(movement.id);
    if (amount == null) continue;
    const current = inbound.get(key) ?? { qty: 0, amount: 0 };
    current.qty += Number(movement.quantity);
    current.amount += amount;
    inbound.set(key, current);
  }

  for (const scope of scopes) {
    const key = scopeKey(scope.itemId, scope.warehouseId);
    result.set(
      key,
      computeProvisionalAverage({
        anchor: anchors.get(key) ?? null,
        inbound: inbound.get(key) ?? { qty: 0, amount: 0 },
      })
    );
  }
  return result;
}

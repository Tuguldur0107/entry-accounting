// Бараа × агуулахын ХУРДАН үлдэгдэл уншигч (snapshot + delta) — кассын
// lib/cash/period-balances.ts-ийн бараа материалын хувилбар.
//
//   balance(asOf) = сүүлийн хаагдсан периодын snapshot (endDate ≤ asOf)
//                 + replay(confirmed хөдөлгөөн, endDate < date ≤ asOf)
//   snapshot байхгүй бол: бүх confirmed хөдөлгөөнийг эхнээс нь replay.
//
// Үр дүн calculateQtyBalances(бүх хөдөлгөөн)-тэй ЯГ ИЖИЛ (тест:
// tests/inventory-period-balances.test.ts). Хаагдсан период руу хөдөлгөөн
// батлах/цуцлах/устгах хориотой (assertPeriodOpen) тул snapshot хуучирдаггүй.
// Хасах үлдэгдлийн шалгалт (findNegativeStock) мөн зангуунаас replay хийнэ —
// хаагдсан үе дотор шинэ зөрчил үүсэх боломжгүй.

import { and, desc, eq, gt, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accountingPeriods,
  inventoryMovements,
  inventoryPeriodBalances,
} from "@/lib/db/schema";
import { balanceKey, calculateQtyBalances, type MovementRef } from "./balances";
import { toMovementRefs } from "./load-data";

/** db эсвэл транзакц — advisory lock доторх шалгалтууд tx-ээр уншина. */
export type QueryHandle = Pick<typeof db, "query" | "select">;

export interface QtySnapshotAnchor {
  code: string;
  endDate: string;
}

/** asOf-оос өмнө/тэнцүү дуусдаг, бараа материалын snapshot-той сүүлийн хаалттай период. */
export async function findInventorySnapshotAnchor(
  orgId: string,
  asOf?: string,
  handle: QueryHandle = db
): Promise<QtySnapshotAnchor | null> {
  const conditions = [
    eq(accountingPeriods.organizationId, orgId),
    eq(accountingPeriods.status, "closed"),
    sql`exists (
      select 1 from ${inventoryPeriodBalances}
      where ${inventoryPeriodBalances.organizationId} = ${accountingPeriods.organizationId}
        and ${inventoryPeriodBalances.periodCode} = ${accountingPeriods.code}
    )`,
  ];
  if (asOf) conditions.push(lte(accountingPeriods.endDate, asOf));
  const [anchor] = await handle
    .select({ code: accountingPeriods.code, endDate: accountingPeriods.endDate })
    .from(accountingPeriods)
    .where(and(...conditions))
    .orderBy(desc(accountingPeriods.endDate))
    .limit(1);
  return anchor ?? null;
}

/** Confirmed хөдөлгөөнүүд огнооны мужаар (хилүүд сонголттой). */
export async function loadConfirmedMovementRefs(
  orgId: string,
  bounds: { gtDate?: string; lteDate?: string },
  handle: QueryHandle = db
): Promise<MovementRef[]> {
  const conditions = [
    eq(inventoryMovements.organizationId, orgId),
    eq(inventoryMovements.status, "confirmed"),
  ];
  if (bounds.gtDate) conditions.push(gt(inventoryMovements.date, bounds.gtDate));
  if (bounds.lteDate) conditions.push(lte(inventoryMovements.date, bounds.lteDate));
  const rows = await handle.query.inventoryMovements.findMany({
    where: and(...conditions),
    columns: {
      id: true,
      movementType: true,
      date: true,
      itemId: true,
      warehouseId: true,
      toWarehouseId: true,
      quantity: true,
      createdAt: true,
    },
  });
  return toMovementRefs(rows);
}

export interface QtyLedger {
  anchor: QtySnapshotAnchor | null;
  /** Зангууны үлдэгдэл (balanceKey → тоо); зангуугүй бол хоосон. */
  opening: Map<string, number>;
  /** Зангууны ДАРААХ (≤ asOf) confirmed хөдөлгөөн — replay/шалгалтад. */
  movements: MovementRef[];
}

/**
 * Зангуу + түүнээс хойшхи хөдөлгөөн — үлдэгдэл бодох, хасах үлдэгдэл шалгах
 * хоёуланд нэг л ачаалалт. asOf өгөөгүй бол өнөөдрийг оруулаад бүх хөдөлгөөн.
 */
export async function loadQtyLedgerFast(
  orgId: string,
  asOf?: string,
  handle: QueryHandle = db
): Promise<QtyLedger> {
  const anchor = await findInventorySnapshotAnchor(orgId, asOf, handle);
  const [snapshotRows, movements] = await Promise.all([
    anchor
      ? handle.query.inventoryPeriodBalances.findMany({
          where: and(
            eq(inventoryPeriodBalances.organizationId, orgId),
            eq(inventoryPeriodBalances.periodCode, anchor.code)
          ),
          columns: { itemId: true, warehouseId: true, quantity: true },
        })
      : Promise.resolve([]),
    loadConfirmedMovementRefs(
      orgId,
      { gtDate: anchor?.endDate, lteDate: asOf },
      handle
    ),
  ]);
  const opening = new Map(
    snapshotRows.map((row) => [
      balanceKey(row.itemId, row.warehouseId),
      Number(row.quantity),
    ])
  );
  return { anchor, opening, movements };
}

/** balanceKey → үлдэгдэл asOf-оор (calculateQtyBalances-ийн snapshot+delta хувилбар). */
export async function loadQtyBalancesFast(
  orgId: string,
  asOf?: string,
  handle: QueryHandle = db
): Promise<Map<string, number>> {
  const ledger = await loadQtyLedgerFast(orgId, asOf, handle);
  return calculateQtyBalances(ledger.movements, ledger.opening);
}

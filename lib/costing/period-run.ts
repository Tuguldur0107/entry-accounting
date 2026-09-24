// Периодын өртгийн тооцоолол — DB талын нэгтгэл.
//
// Хөдөлгөөн (Inventory Ledger) → PeriodicMovement → цэвэр хөдөлгөгч
// (lib/costing/periodic.ts) → cost_period_results (Cost Ledger-ийн
// периодын үр дүн). GL-ээс өртөг бодохгүй (FR-ARCH-002).
//
// Хөдөлгөөний чиглэлийн зураглал:
//   receipt / return_in / adjustment(+) → "in"
//   issue / return_out / adjustment(−)  → "out"
//   transfer (A → B)                    → A-д "out" (A-ийн сарын дунджаар),
//     B-д "in" (A-ийн ТУХАЙН САРЫН дундаж × тоо) — OD-014, README
//     change-control 0.9 (ENT-044). Урьд шилжүүлэг үнэлгээнд огт ордоггүй тул
//     хүлээн авагч агуулах өртөггүй тоотой болж дараагийн зарлага блоклогддог
//     байв. Бараа материалын данс нь барааных (агуулахгүй) тул GL бичилт
//     үүсэхгүй — зөвхөн хүрээ хоорондын дүн шилжинэ.

import { and, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accountingPeriods,
  costEntries,
  costPeriodResults,
  inventoryMovements,
} from "@/lib/db/schema";
import {
  nextPeriodCode,
  periodCodeOf,
  periodCodesBetween,
  periodRange,
} from "@/lib/periods/period";
import {
  contiguousClosedPrefix,
  pickCostingAnchor,
  seedOpeningFromResults,
  type PeriodResultMeta,
} from "./period-anchor";
import {
  computeAllScopes,
  type OpeningBalance,
  type PeriodicMovement,
  type PeriodicResult,
} from "./periodic";

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
  /** Дахин тооцоологдсон периодууд (зангууны ДАРААХ). */
  periodCodes: string[];
  /**
   * Үргэлжлүүлсэн хаагдсан период — түүнээс өмнөх үр дүн хөндөгдөөгүй.
   * null = зангуу байхгүй, бүх түүхийг эхнээс нь тооцсон.
   */
  anchorPeriod: string | null;
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

const EMPTY_SUMMARY = (anchorPeriod: string | null): PeriodRunSummary => ({
  periodCodes: [],
  anchorPeriod,
  scopeCount: 0,
  calculated: 0,
  blocked: 0,
  blockedRows: [],
});

/**
 * Хаагдсан үеийн ЭЦСИЙН үр дүнгээс үргэлжлүүлэх зангуу (period-anchor.ts):
 * зангууны код, түүний эцсийн огноо, хүрээ бүрийн C1. Зангуугүй бол null.
 */
async function loadCostingAnchor(
  orgId: string,
  firstCode: string
): Promise<{
  code: string;
  endDate: string;
  openingByScope: Map<string, OpeningBalance | null>;
} | null> {
  const [closed, metaRows] = await Promise.all([
    db.query.accountingPeriods.findMany({
      where: and(
        eq(accountingPeriods.organizationId, orgId),
        eq(accountingPeriods.status, "closed")
      ),
      columns: { code: true, closedAt: true },
    }),
    db
      .select({
        code: costPeriodResults.periodCode,
        rows: sql<number>`count(*)::int`,
        minCalculatedAt: sql<Date>`min(${costPeriodResults.calculatedAt})`,
      })
      .from(costPeriodResults)
      .where(eq(costPeriodResults.organizationId, orgId))
      .groupBy(costPeriodResults.periodCode),
  ]);
  const prefix = contiguousClosedPrefix(firstCode, closed);
  if (prefix.length === 0) return null;
  const metaByCode = new Map<string, PeriodResultMeta>(
    metaRows.map((row) => [
      row.code,
      { rows: Number(row.rows), minCalculatedAt: new Date(row.minCalculatedAt) },
    ])
  );
  const code = pickCostingAnchor(prefix, metaByCode);
  if (!code) return null;

  // Хүрээ бүрийн зангуу хүртэлх СҮҮЛИЙН мөр — index (org, item, warehouse,
  // period) дээрх DISTINCT ON; бүх түүхийн мөрийг ачаалахгүй.
  const latest = (await db.execute(sql`
    select distinct on (item_id, warehouse_id)
      item_id as "itemId", warehouse_id as "warehouseId", status,
      closing_qty as "closingQty", closing_amount as "closingAmount"
    from cost_period_results
    where organization_id = ${orgId} and period_code <= ${code}
    order by item_id, warehouse_id, period_code desc
  `)) as unknown as {
    itemId: string;
    warehouseId: string;
    status: string;
    closingQty: string;
    closingAmount: string | null;
  }[];
  return {
    code,
    endDate: periodRange(code).endDate,
    openingByScope: seedOpeningFromResults(latest),
  };
}

/**
 * Периодын үр дүнг тооцоолж хадгална — ЗАНГУУНААС хойш (хаагдсан үеийн
 * хадгалагдсан C2-оос үргэлжлүүлнэ, тэдгээр мөр хөндөгдөхгүй); зангуу
 * байхгүй бол бүх түүхийг эхнээс нь. Цуваа (C2 → дараагийн C1) хэвээр —
 * зангууны дараах БҮХ периодыг дахин бичнэ, хэсэгчлэн шинэчлэхгүй.
 *
 * `throughPeriod` — үүнийг ОРУУЛААД хүртэл. Өгөхгүй бол хамгийн сүүлийн
 * хөдөлгөөний период хүртэл.
 */
export async function runPeriodicCosting(
  orgId: string,
  /** Үр дүнгийн мөрийн createdBy — дуудаж буй хэрэглэгч. */
  userId: string,
  options?: { throughPeriod?: string }
): Promise<PeriodRunSummary> {
  const [{ firstDate } = { firstDate: null }] = await db
    .select({ firstDate: sql<string | null>`min(${inventoryMovements.date})` })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.organizationId, orgId),
        eq(inventoryMovements.status, "confirmed")
      )
    );
  if (!firstDate) return EMPTY_SUMMARY(null);

  const anchor = await loadCostingAnchor(orgId, periodCodeOf(firstDate));

  const movementScope = [
    eq(inventoryMovements.organizationId, orgId),
    eq(inventoryMovements.status, "confirmed"),
    ...(anchor ? [gt(inventoryMovements.date, anchor.endDate)] : []),
  ];
  const movements = await db.query.inventoryMovements.findMany({
    where: and(...movementScope),
    columns: {
      id: true,
      date: true,
      itemId: true,
      warehouseId: true,
      toWarehouseId: true,
      movementType: true,
      quantity: true,
    },
  });

  const valued = movements.filter(
    (movement) => movement.itemId && movement.warehouseId
  );

  // Орлогын мөнгөн дүн: тухайн хөдөлгөөнд холбогдсон ИДЭВХТЭЙ (ноорог эсвэл
  // батлагдсан) ӨРТӨГТЭЙ бичилтээс — худалдан авалт ба нэмэлт зардал.
  // Тооллогын илүүдэл, буцаж ирсэн бараа нь худалдан авах үнэгүй тул
  // САРЫН ДУНДАЖААР үнэлэгдэнэ (README change-control 0.2) — тэдгээрийг
  // дундажийн тоологч/хуваарьт ОРУУЛАХГҮЙ.
  const entries = await db.query.costEntries.findMany({
    where: and(
      eq(costEntries.organizationId, orgId),
      inArray(costEntries.status, ["draft", "posted"]),
      // Зангуутай бол зөвхөн зангууны дараах хөдөлгөөний бичилтүүд.
      inArray(
        costEntries.movementId,
        db
          .select({ id: inventoryMovements.id })
          .from(inventoryMovements)
          .where(and(...movementScope))
      )
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
    if (movement.movementType === "transfer") {
      // Хүлээн авагчгүй / ижил агуулах руу шилжүүлэг үнэлгээнд нөлөөгүй.
      if (!movement.toWarehouseId || movement.toWarehouseId === movement.warehouseId) continue;
      const base = {
        id: movement.id,
        date: movement.date,
        itemId: movement.itemId!,
        quantity: Math.abs(quantity),
      };
      periodic.push({ ...base, warehouseId: movement.warehouseId!, direction: "out" });
      periodic.push({
        ...base,
        warehouseId: movement.toWarehouseId,
        direction: "in",
        inboundValuation: "priced",
        inboundAmount: null,
        transferFromWarehouseId: movement.warehouseId!,
      });
      continue;
    }
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

  const codes = periodic.map((movement) => periodCodeOf(movement.date)).sort();
  // Зангуутай бол дараагийн сараас (хөдөлгөөнгүй ч үлдэгдэл дамжина);
  // зангуугүй бол эхний хөдөлгөөний сараас.
  const first = anchor ? nextPeriodCode(anchor.code) : codes[0];
  const last =
    options?.throughPeriod ?? codes[codes.length - 1] ?? anchor?.code ?? null;
  if (!first || !last) return EMPTY_SUMMARY(anchor?.code ?? null);
  const periodCodes = periodCodesBetween(first, last);
  if (periodCodes.length === 0) return EMPTY_SUMMARY(anchor?.code ?? null);

  const byScope = computeAllScopes({
    periodCodes,
    movements: periodic,
    openingByScope: anchor?.openingByScope,
  });

  // Бичилт: зангууны дараах БҮХ периодыг дахин бичнэ (тооцоолол нь цуваа
  // тул хэсэгчлэн шинэчлэх нь буруу үр дүн өгнө); зангуу хүртэлх мөр хэвээр.
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
      rows.push(toRow(orgId, userId, result));
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(costPeriodResults)
      .where(
        and(
          eq(costPeriodResults.organizationId, orgId),
          ...(anchor ? [gt(costPeriodResults.periodCode, anchor.code)] : [])
        )
      );
    // Багцлан оруулна — мөр олон байж болно.
    for (let index = 0; index < rows.length; index += 500)
      await tx.insert(costPeriodResults).values(rows.slice(index, index + 500));
  });

  return {
    periodCodes,
    anchorPeriod: anchor?.code ?? null,
    scopeCount: byScope.size,
    calculated,
    blocked,
    blockedRows,
  };
}

function toRow(
  orgId: string,
  userId: string,
  result: PeriodicResult
): typeof costPeriodResults.$inferInsert {
  const num = (value: number | null) => (value === null ? null : String(value));
  return {
    userId,
    organizationId: orgId,
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
  orgId: string,
  periodCode: string
): Promise<(typeof costPeriodResults.$inferSelect)[]> {
  return db.query.costPeriodResults.findMany({
    where: and(
      eq(costPeriodResults.organizationId, orgId),
      eq(costPeriodResults.periodCode, periodCode)
    ),
  });
}

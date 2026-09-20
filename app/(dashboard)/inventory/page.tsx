import { and, count, eq, isNull, ne, sql, sum } from "drizzle-orm";

import {
  InventoryDashboard,
  type InventoryEbarimtMetrics,
  type InventoryPosMetrics,
} from "@/components/inventory/inventory-dashboard";
import { ModuleGuard } from "@/components/layout/access-guard";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  costEntries,
  inventoryMovements,
  posSaleLines,
  posSales,
} from "@/lib/db/schema";
import { balanceKey } from "@/lib/inventory/balances";
import { loadInventoryBase } from "@/lib/inventory/load-data";
import { findNegativeBalances } from "@/lib/inventory/negative-stock";
import { loadQtyBalancesFast } from "@/lib/inventory/period-balances";
import type { QtyBalanceRow } from "@/lib/inventory/types";
import { ebarimtStatusSummary } from "@/lib/ebarimt/queue";
import { periodCodeOf, periodRange } from "@/lib/periods/period";
import { todayInUlaanbaatar } from "@/lib/periods/selection";
import { PROVISIONAL_VALUATION_SOURCE } from "@/lib/pos/constants";
import { ensurePosSettings, loadShiftViews } from "@/lib/pos/load-data";
import { loadSalesReport, summarize } from "@/lib/pos/reports";
import { ulaanbaatarNow } from "@/lib/pos/sale-math";

export default async function InventoryDashboardPage() {
  const { orgId, userId } = await getActiveOrg();
  const today = ulaanbaatarNow().date;
  const monthCode = periodCodeOf(today);
  const { startDate: monthStart, endDate: monthEnd } = periodRange(monthCode);

  // Үлдэгдэл = хаагдсан үеийн snapshot + түүнээс хойшхи хөдөлгөөн; тоолуурууд
  // SQL-д — хөдөлгөөний бүх түүх JS-д ачаалагдахгүй.
  // POS (docs/pos §4.6): өнөөдрийн борлуулалт, нээлттэй ээлж, урьдчилсан
  // COGS Σ (энэ сар), өртөг хүлээж буй мөр — мөн SQL-ээр.
  const [
    { itemViews, warehouseViews },
    balances,
    [draftRow],
    [unvaluedRow],
    todayReport,
    openShifts,
    [pendingCostRow],
    [provisionalRow],
  ] = await Promise.all([
    loadInventoryBase(orgId),
    loadQtyBalancesFast(orgId),
    db
      .select({ n: count() })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.organizationId, orgId),
          eq(inventoryMovements.status, "draft")
        )
      ),
    db
      .select({ n: count() })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.organizationId, orgId),
          eq(inventoryMovements.status, "confirmed"),
          ne(inventoryMovements.movementType, "transfer"),
          sql`not exists (
            select 1 from ${costEntries}
            where ${costEntries.movementId} = ${inventoryMovements.id}
              and ${costEntries.status} in ('draft', 'posted')
          )`
        )
      ),
    loadSalesReport(orgId, { from: today, to: today }),
    loadShiftViews(orgId, { openOnly: true }),
    // Урьдчилсан өртөггүй борлуулалтын мөр (явцын дундаж байгаагүй — §3.7):
    // энэ сарын цуцлагдаагүй борлуулалтууд.
    db
      .select({ n: count() })
      .from(posSaleLines)
      .innerJoin(posSales, eq(posSales.id, posSaleLines.saleId))
      .where(
        and(
          eq(posSales.organizationId, orgId),
          ne(posSales.status, "voided"),
          sql`${posSales.date} between ${monthStart} and ${monthEnd}`,
          isNull(posSaleLines.provisionalCostEntryId)
        )
      ),
    db
      .select({ total: sum(costEntries.amount) })
      .from(costEntries)
      .where(
        and(
          eq(costEntries.organizationId, orgId),
          eq(costEntries.valuationSource, PROVISIONAL_VALUATION_SOURCE),
          eq(costEntries.status, "posted"),
          eq(costEntries.periodCode, monthCode)
        )
      ),
  ]);

  const balanceRows: QtyBalanceRow[] = [];
  for (const item of itemViews) {
    for (const warehouse of warehouseViews) {
      const quantity = balances.get(balanceKey(item.id, warehouse.id)) ?? 0;
      if (quantity === 0) continue;
      balanceRows.push({
        itemId: item.id,
        itemLabel: `${item.code} · ${item.name}`,
        unit: item.unit,
        warehouseName: warehouse.name,
        quantity,
      });
    }
  }
  balanceRows.sort((a, b) => a.itemLabel.localeCompare(b.itemLabel));

  // eBarimt (docs/pos/03 §4.5): асаалттай бол дарааллын тоолуур самбарт.
  // Server Component тул дарааллын давхаргыг ШУУД уншина (action биш).
  const posSettings = await ensurePosSettings(orgId, userId);
  let ebarimt: InventoryEbarimtMetrics | undefined;
  if (posSettings.ebarimtEnabled) {
    const summary = await ebarimtStatusSummary(orgId, posSettings, todayInUlaanbaatar());
    ebarimt = { pending: summary.pending, failed: summary.failed };
  }

  const todaySummary = summarize(todayReport.lines);
  const pos: InventoryPosMetrics = {
    today,
    todayTotal: todaySummary.total,
    todayCount: todaySummary.salesCount,
    todayAverageTicket: todaySummary.averageTicket,
    openShifts: openShifts.length,
    provisionalCogs: Math.round(Number(provisionalRow?.total ?? 0) * 100) / 100,
    pendingCostLines: Number(pendingCostRow?.n ?? 0),
  };

  // Хавтасны layout inv ЭСВЭЛ pos-оор нээгддэг (кассчин) — самбар нь inv.
  return (
    <ModuleGuard moduleKeys="inv">
    <InventoryDashboard
      balances={balanceRows}
      itemCount={itemViews.filter((item) => item.isActive).length}
      warehouseCount={warehouseViews.filter((w) => w.isActive).length}
      draftCount={Number(draftRow?.n ?? 0)}
      unvaluedCount={Number(unvaluedRow?.n ?? 0)}
      pos={pos}
      ebarimt={ebarimt}
      negativeStock={findNegativeBalances(balances, itemViews, warehouseViews)}
    />
    </ModuleGuard>
  );
}

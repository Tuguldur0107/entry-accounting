import { and, eq } from "drizzle-orm";

import {
  CostControlReport,
  type CostControlRow,
} from "@/components/costing/cost-control-report";
import { getActiveOrg } from "@/lib/auth";
import { isPeriodCode } from "@/lib/periods/period";
import { getPeriodSelection } from "@/lib/periods/selection";
import { db } from "@/lib/db";
import { accountingPeriods, costPeriodResults } from "@/lib/db/schema";
import { loadInventoryBase } from "@/lib/inventory/load-data";

type SearchParams = Promise<{ period?: string }>;

export default async function CostControlPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { period } = await searchParams;

  // Зангуу сар: URL-ийн `period` (deep link) → topbar-ийн сонголт. Үр дүнгүй
  // сар руу ЧИМЭЭГҮЙ шилжихгүй — хоосон төлөв «Дахин тооцоолох»-ыг заана
  // (тайлангийн стандарт: огноо зөвхөн топбарын периодоос).
  const selection = await getPeriodSelection();
  const periodCode = period && isPeriodCode(period) ? period : selection.periodCode;

  // ЗӨВХӨН тухайн сарын үр дүн — бүх сарын мөрийг ачаалж JS-д шүүхгүй (П28).
  const [results, { itemViews, warehouseViews }, periods] = await Promise.all([
    db.query.costPeriodResults.findMany({
      where: and(
        eq(costPeriodResults.organizationId, orgId),
        eq(costPeriodResults.periodCode, periodCode)
      ),
    }),
    loadInventoryBase(orgId),
    db.query.accountingPeriods.findMany({
      where: and(
        eq(accountingPeriods.organizationId, orgId),
        eq(accountingPeriods.code, periodCode)
      ),
      columns: { code: true, status: true },
    }),
  ]);

  const itemById = new Map(itemViews.map((item) => [item.id, item]));
  const warehouseById = new Map(
    warehouseViews.map((warehouse) => [warehouse.id, warehouse])
  );

  const rows: CostControlRow[] = results
    .map((row) => {
      const item = itemById.get(row.itemId);
      const warehouse = warehouseById.get(row.warehouseId);
      const openingQty = Number(row.openingQty);
      const openingAmount = Number(row.openingAmount);
      const inboundQty = Number(row.inboundQty);
      const inboundAmount = Number(row.inboundAmount);
      return {
        id: `${row.itemId}:${row.warehouseId}`,
        rowNo: 0,
        itemCode: item?.code ?? "—",
        itemName: item?.name ?? "—",
        warehouseLabel: warehouse
          ? `${warehouse.code} · ${warehouse.name}`
          : "—",
        openingQty,
        openingUnitCost: openingQty !== 0 ? openingAmount / openingQty : null,
        openingAmount,
        inboundQty,
        inboundUnitCost: inboundQty !== 0 ? inboundAmount / inboundQty : null,
        inboundAmount,
        outboundQty: Number(row.outboundQty),
        averageUnitCost:
          row.averageUnitCost === null ? null : Number(row.averageUnitCost),
        outboundAmount:
          row.outboundAmount === null ? null : Number(row.outboundAmount),
        closingQty: Number(row.closingQty),
        closingAmount:
          row.closingAmount === null ? null : Number(row.closingAmount),
        qtyBalanced: row.qtyBalanced,
        amountBalanced: row.amountBalanced,
        status: row.status,
        blockReason: row.blockReason,
      };
    })
    .sort((a, b) =>
      a.itemCode === b.itemCode
        ? a.warehouseLabel.localeCompare(b.warehouseLabel)
        : a.itemCode.localeCompare(b.itemCode)
    )
    .map((row, index) => ({ ...row, rowNo: index + 1 }));

  const closed = periods.some(
    (row) => row.code === periodCode && row.status === "closed"
  );
  const calculatedAt =
    results.length > 0
      ? results[0].calculatedAt
          .toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" })
          .slice(0, 16)
      : null;

  return (
    <CostControlReport
      periodCode={periodCode}
      rows={rows}
      periodClosed={closed}
      calculatedAt={calculatedAt}
    />
  );
}

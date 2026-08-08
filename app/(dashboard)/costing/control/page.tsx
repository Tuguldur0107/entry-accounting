import { eq } from "drizzle-orm";

import {
  CostControlReport,
  type CostControlRow,
} from "@/components/costing/cost-control-report";
import { getActiveOrg } from "@/lib/auth";
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

  const [allResults, { itemViews, warehouseViews }, periods] =
    await Promise.all([
      db.query.costPeriodResults.findMany({
        where: eq(costPeriodResults.organizationId, orgId),
      }),
      loadInventoryBase(orgId),
      db.query.accountingPeriods.findMany({
        where: eq(accountingPeriods.organizationId, orgId),
      }),
    ]);

  // Сонгох боломжтой периодууд — тооцоологдсон үр дүн байгаа сарууд.
  const periodOptions = [
    ...new Set(allResults.map((row) => row.periodCode)),
  ].sort((a, b) => (a < b ? 1 : -1));

  // Зангуу сар: URL → topbar-ийн сонголт → үр дүнтэй сүүлийн сар.
  const selection = await getPeriodSelection();
  const periodCode =
    period && periodOptions.includes(period)
      ? period
      : periodOptions.includes(selection.periodCode)
        ? selection.periodCode
        : (periodOptions[0] ?? selection.periodCode);

  const results = allResults.filter((row) => row.periodCode === periodCode);

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
      periodOptions={periodOptions}
      rows={rows}
      periodClosed={closed}
      calculatedAt={calculatedAt}
    />
  );
}

// Нөөцийн үнэлгээ · NRV (Server Component).
//
// Үнэлгээ нь ӨРТГИЙН ХЯНАЛТЫН тайлантай ИЖИЛ сууриас гарна:
// cost_period_results-ийн хамгийн сүүлийн тооцоологдсон сарын C2
// (docs/cost FR-PR-001 — нэг л арга; RPT-PR-001 — тайлангууд Cost Ledger-
// ээс гарна). Энэ таб нь C2 дээр NRV нөөц + цэвэр дүнг нэмж үзүүлнэ.
//
// GL тулгалт энд БАЙХГҮЙ — "Гүйлгээний дэлгэрэнгүй" табд огнооны мужаар
// хийгддэг (давхардлыг арилгасан).

import { eq } from "drizzle-orm";

import { CostingReportView } from "@/components/costing/costing-report-view";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { costEntries } from "@/lib/db/schema";
import { latestClosingByItem } from "@/lib/costing/valuation";
import { loadInventoryBase } from "@/lib/inventory/load-data";
import type { ValuationRow } from "@/lib/inventory/types";

export default async function CostingValuationPage() {
  const { orgId } = await getActiveOrg();

  const [{ itemViews }, entries, closingByItem] = await Promise.all([
    loadInventoryBase(orgId),
    db.query.costEntries.findMany({
      where: eq(costEntries.organizationId, orgId),
      columns: { itemId: true, entryType: true, status: true, amount: true },
    }),
    latestClosingByItem(orgId),
  ]);

  // NRV нөөц бараагаар — идэвхтэй draft+posted (draft-ыг мөн тооцсоноор
  // хэрэглэгч нэг барааг хоёр удаа бууруулахаас сэргийлнэ).
  const nrvReserveByItem = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.itemId || entry.status === "reversed") continue;
    const sign =
      entry.entryType === "nrv_writedown"
        ? 1
        : entry.entryType === "nrv_reversal"
          ? -1
          : 0;
    if (sign === 0) continue;
    nrvReserveByItem.set(
      entry.itemId,
      (nrvReserveByItem.get(entry.itemId) ?? 0) + sign * Number(entry.amount)
    );
  }

  const valuation: ValuationRow[] = [];
  for (const item of itemViews) {
    const closing = closingByItem.get(item.id);
    if (!closing || (closing.qty === 0 && closing.amount === 0)) continue;
    const reserve =
      Math.round((nrvReserveByItem.get(item.id) ?? 0) * 100) / 100;
    const grossValue = Math.round(closing.amount * 100) / 100;
    valuation.push({
      itemId: item.id,
      itemLabel: `${item.code} · ${item.name}`,
      unit: item.unit,
      quantity: closing.qty,
      // Нэгж өртөг = C2 Дүн / C2 Тоо (сарын жигнэсэн дундаж).
      avgCost: closing.qty !== 0 ? closing.amount / closing.qty : 0,
      value: grossValue,
      nrvReserve: reserve,
      netValue: Math.round((grossValue - reserve) * 100) / 100,
    });
  }
  valuation.sort((a, b) => a.itemLabel.localeCompare(b.itemLabel));

  return <CostingReportView valuation={valuation} />;
}

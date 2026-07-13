import { and, eq, inArray } from "drizzle-orm";

import { CostingReportView } from "@/components/costing/costing-report-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  costEntries,
  costingItemSettings,
  inventoryMovements,
  journalVouchers,
} from "@/lib/db/schema";
import {
  CLEARING_ACCOUNT,
  NRV_RESERVE_ACCOUNT,
  computeCostingRun,
  type CostEntryType,
  type PostedEntryRef,
} from "@/lib/costing/costing";
import { loadInventoryBase, toMovementRefs } from "@/lib/inventory/load-data";
import type { TieOutRow, ValuationRow } from "@/lib/inventory/types";

function today() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function mainAccountOf(accountNumber: string) {
  const parts = accountNumber.split(".");
  return parts.length === 10 ? parts[2] : accountNumber;
}

export default async function CostingReportsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [{ itemViews }, movements, entries, settings, vouchers, accounts] =
    await Promise.all([
      loadInventoryBase(userId),
      db.query.inventoryMovements.findMany({
        where: and(
          eq(inventoryMovements.userId, userId),
          eq(inventoryMovements.status, "confirmed")
        ),
      }),
      db.query.costEntries.findMany({ where: eq(costEntries.userId, userId) }),
      db.query.costingItemSettings.findMany({
        where: eq(costingItemSettings.userId, userId),
      }),
      db.query.journalVouchers.findMany({
        where: and(
          eq(journalVouchers.userId, userId),
          inArray(journalVouchers.status, ["posted", "reversed"])
        ),
        with: { lines: true },
      }),
      db.query.chartOfAccounts.findMany({
        where: eq(chartOfAccounts.userId, userId),
      }),
    ]);

  // Үнэлгээ: зөвхөн POSTED бичилтийг replay хийж бараа бүрийн qty+дундаж авна.
  const postedEntries: PostedEntryRef[] = entries
    .filter((entry) => entry.status === "posted" && entry.movementId != null)
    .map((entry) => ({
      movementId: entry.movementId!,
      entryType: entry.entryType as CostEntryType,
      quantity: Number(entry.quantity),
      unitCost: Number(entry.unitCost),
      amount: Number(entry.amount),
    }));

  // NRV нөөц бараагаар (идэвхтэй draft+posted — давхар бичилтээс сэргийлж
  // draft-ыг мөн тооцно; GL тулгалтад зөвхөн posted).
  const nrvReserveByItem = new Map<string, number>();
  const nrvPostedByItem = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.itemId) continue;
    if (entry.status === "reversed") continue;
    const sign = entry.entryType === "nrv_writedown" ? 1 : entry.entryType === "nrv_reversal" ? -1 : 0;
    if (sign === 0) continue;
    const amount = sign * Number(entry.amount);
    nrvReserveByItem.set(
      entry.itemId,
      (nrvReserveByItem.get(entry.itemId) ?? 0) + amount
    );
    if (entry.status === "posted")
      nrvPostedByItem.set(
        entry.itemId,
        (nrvPostedByItem.get(entry.itemId) ?? 0) + amount
      );
  }
  // Зөвхөн БАТЛАГДСАН бичилттэй хөдөлгөөнүүдийг replay хийнэ — үнэлэгдээгүй
  // хөдөлгөөнийг таамгаар үнэлж tie-out хүснэгттэй зөрүүлэхгүй.
  const valuedMovementIds = new Set(postedEntries.map((entry) => entry.movementId));
  const { state } = computeCostingRun({
    movements: toMovementRefs(
      movements.filter((movement) => valuedMovementIds.has(movement.id))
    ),
    valuedEntries: postedEntries,
    receiptCosts: new Map(),
    asOfDate: today(),
  });

  const valuation: ValuationRow[] = [];
  for (const item of itemViews) {
    const itemState = state.get(item.id);
    if (!itemState || (itemState.qty === 0 && itemState.avgCost === 0)) continue;
    const reserve =
      Math.round((nrvReserveByItem.get(item.id) ?? 0) * 100) / 100;
    const grossValue = Math.round(itemState.qty * itemState.avgCost * 100) / 100;
    valuation.push({
      itemId: item.id,
      itemLabel: `${item.code} · ${item.name}`,
      unit: item.unit,
      quantity: itemState.qty,
      avgCost: itemState.avgCost,
      value: grossValue,
      nrvReserve: reserve,
      netValue: Math.round((grossValue - reserve) * 100) / 100,
    });
  }
  valuation.sort((a, b) => a.itemLabel.localeCompare(b.itemLabel));

  // Tie-out: батлагдсан entry-ний данс тус бүрийн цэвэр нөлөө vs GL үлдэгдэл.
  const settingByItem = new Map(settings.map((s) => [s.itemId, s]));
  const subledgerByAccount = new Map<string, number>();
  const movementItem = new Map(movements.map((m) => [m.id, m.itemId]));
  for (const entry of entries) {
    if (entry.status !== "posted") continue;
    // NRV бичилт (movement-гүй) энд орохгүй — нөөцөө тусдаа мөрөөр нэмсэн.
    if (entry.movementId == null) continue;
    const itemId = movementItem.get(entry.movementId);
    const account =
      (itemId && settingByItem.get(itemId)?.inventoryAccountNumber) || "14000001";
    const amount = Number(entry.amount);
    const delta =
      entry.entryType === "receipt_capitalize" || entry.entryType === "adjustment_gain"
        ? amount
        : -amount;
    subledgerByAccount.set(account, (subledgerByAccount.get(account) ?? 0) + delta);
  }

  // NRV-ийн posted нөлөө contra-нөөц дансанд (кредит үлдэгдэл → сөрөг).
  let nrvPostedTotal = 0;
  for (const amount of nrvPostedByItem.values()) nrvPostedTotal += amount;
  if (Math.abs(nrvPostedTotal) > 0.005)
    subledgerByAccount.set(
      NRV_RESERVE_ACCOUNT,
      Math.round(-nrvPostedTotal * 100) / 100
    );

  const glByAccount = new Map<string, number>();
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      const main = mainAccountOf(line.accountNumber);
      if (!main.startsWith("14") || main === CLEARING_ACCOUNT) continue;
      glByAccount.set(
        main,
        (glByAccount.get(main) ?? 0) + Number(line.debit) - Number(line.credit)
      );
    }
  }

  const accountName = new Map(accounts.map((a) => [a.number, a.name]));
  const tieOutAccounts = new Set([
    ...subledgerByAccount.keys(),
    ...glByAccount.keys(),
  ]);
  const tieOut: TieOutRow[] = [...tieOutAccounts]
    .sort()
    .map((accountNumber) => {
      const subledgerValue =
        Math.round((subledgerByAccount.get(accountNumber) ?? 0) * 100) / 100;
      const glBalance = Math.round((glByAccount.get(accountNumber) ?? 0) * 100) / 100;
      return {
        accountNumber,
        accountName: accountName.get(accountNumber) ?? "",
        subledgerValue,
        glBalance,
        difference: Math.round((glBalance - subledgerValue) * 100) / 100,
      };
    });

  return <CostingReportView valuation={valuation} tieOut={tieOut} />;
}

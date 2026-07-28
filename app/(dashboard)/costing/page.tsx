import { and, eq, inArray } from "drizzle-orm";

import { CostingDashboard } from "@/components/costing/costing-dashboard";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadCostingAccountSettings } from "@/lib/costing/master-data";
import {
  costEntries,
  inventoryMovements,
  journalVouchers,
} from "@/lib/db/schema";
import {
  computeCostingRun,
  type CostEntryType,
  type PostedEntryRef,
} from "@/lib/costing/costing";
import { loadInventoryBase, toMovementRefs } from "@/lib/inventory/load-data";
import type { PendingValuationView } from "@/lib/inventory/types";

function today() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function mainAccountOf(accountNumber: string) {
  const parts = accountNumber.split(".");
  return parts.length === 10 ? parts[2] : accountNumber;
}

export default async function CostingDashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [{ itemViews }, movements, entries, vouchers] = await Promise.all([
    loadInventoryBase(userId),
    db.query.inventoryMovements.findMany({
      where: and(
        eq(inventoryMovements.userId, userId),
        eq(inventoryMovements.status, "confirmed")
      ),
    }),
    db.query.costEntries.findMany({
      where: eq(costEntries.userId, userId),
    }),
    db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.userId, userId),
        inArray(journalVouchers.status, ["posted", "reversed"])
      ),
      with: { lines: true },
    }),
  ]);

  const activeEntries = entries.filter(
    (entry) =>
      (entry.status === "draft" || entry.status === "posted") &&
      entry.movementId != null
  );
  const valuedEntries: PostedEntryRef[] = activeEntries.map((entry) => ({
    movementId: entry.movementId!,
    entryType: entry.entryType as CostEntryType,
    quantity: Number(entry.quantity),
    unitCost: Number(entry.unitCost),
    amount: Number(entry.amount),
  }));

  // Pending жагсаалт: run-ыг хоосон үнийн зурагтай "хуурай" тооцоолж авна.
  const { pending } = computeCostingRun({
    movements: toMovementRefs(movements),
    valuedEntries,
    receiptCosts: new Map(),
    asOfDate: today(),
    valueAdjustments: entries
      .filter(
        (entry) =>
          entry.entryType === "landed_cost" &&
          entry.status === "posted" &&
          entry.itemId != null
      )
      .map((entry) => ({
        id: entry.id,
        itemId: entry.itemId!,
        date: entry.date,
        amount: Number(entry.amount),
        createdAt: entry.createdAt.toISOString(),
      })),
  });

  const movementById = new Map(movements.map((movement) => [movement.id, movement]));
  const itemById = new Map(itemViews.map((item) => [item.id, item]));
  const pendingViews: PendingValuationView[] = pending
    .map((p) => {
      const movement = movementById.get(p.movementId);
      if (!movement) return null;
      const item = movement.itemId ? itemById.get(movement.itemId) : undefined;
      return {
        movementId: p.movementId,
        documentNo: movement.documentNo,
        date: movement.date,
        movementType: movement.movementType,
        itemLabel: item ? `${item.code} · ${item.name}` : "⚠ Бараа сонгоогүй",
        unit: item?.unit ?? "",
        quantity: Number(movement.quantity),
        reason: p.reason,
      };
    })
    .filter((row): row is PendingValuationView => row !== null);

  // Клирингийн болон 14-дансны GL үлдэгдэл + subledger нийлбэр (зөрүү).
  // Клирингийн данс тохиргооноос ирнэ (JPR-006).
  const clearingAccount = (await loadCostingAccountSettings(userId))
    .clearingAccountNumber;
  let clearingBalance = 0;
  const glByAccount = new Map<string, number>();
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      const main = mainAccountOf(line.accountNumber);
      const delta = Number(line.debit) - Number(line.credit);
      if (main === clearingAccount) clearingBalance += delta;
      if (main.startsWith("14") && main !== clearingAccount)
        glByAccount.set(main, (glByAccount.get(main) ?? 0) + delta);
    }
  }
  clearingBalance = Math.round(clearingBalance * 100) / 100;

  // Subledger: батлагдсан entry-ний inventory дансанд үзүүлэх цэвэр нөлөө.
  // (receipt/gain нэмэгдэнэ, issue/loss хасагдана — тайлангийн хуудастай ижил
  // бүртгэлээр posted-only.)
  let subledgerTotal = 0;
  for (const entry of entries) {
    if (entry.status !== "posted") continue;
    const amount = Number(entry.amount);
    if (
      entry.entryType === "receipt_capitalize" ||
      entry.entryType === "adjustment_gain" ||
      entry.entryType === "return_in" ||
      entry.entryType === "landed_cost" ||
      entry.entryType === "nrv_reversal"
    )
      subledgerTotal += amount;
    else subledgerTotal -= amount;
  }
  const glTotal = [...glByAccount.values()].reduce((sum, v) => sum + v, 0);
  const tieOutDifference = Math.round((glTotal - subledgerTotal) * 100) / 100;

  return (
    <CostingDashboard
      pending={pendingViews}
      draftEntryCount={entries.filter((entry) => entry.status === "draft").length}
      postedEntryCount={entries.filter((entry) => entry.status === "posted").length}
      clearingBalance={clearingBalance}
      tieOutDifference={tieOutDifference}
      defaultAsOf={today()}
    />
  );
}

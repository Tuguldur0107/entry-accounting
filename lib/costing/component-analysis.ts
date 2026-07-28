// ӨРТГИЙН БҮРЭЛДЭХҮҮНИЙ ЗАДАРГАА — docs/cost 03-report-specifications §4.
//
// Барааны Орлогын дүн ЮУНААС бүрдсэнийг тайлбарлана: худалдан авах үнэ +
// хэрэглэгчийн тохируулсан бүрэлдэхүүнүүд (тээвэр, гааль, даатгал…).
//
// §4.3 хяналт: тухайн бараа-периодын бүрэлдэхүүний дүнгүүдийн нийлбэр нь
// тэдгээрээр илэрхийлэгдсэн Орлогын дүнтэй тэнцэнэ.

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  chartOfAccounts,
  costComponents,
  costEntries,
  inventoryItems,
  inventoryMovements,
  journalVouchers,
  warehouses,
} from "@/lib/db/schema";
import { extractMainAccount } from "@/lib/reports/balances";
import type { ComponentAnalysisRow } from "./component-analysis-types";

/**
 * Тухайн сарын бүрэлдэхүүний задаргаа. Худалдан авах үнэ нь бүрэлдэхүүн
 * ОНООГООГҮЙ орлогын бичилтээс гардаг тул түүнийг "Худалдан авах үнэ"
 * гэсэн үндсэн мөр болгож үзүүлнэ (тусад нь master data үүсгэх шаардлагагүй).
 */
export async function loadComponentAnalysis(
  userId: string,
  periodCode: string
): Promise<ComponentAnalysisRow[]> {
  const entries = await db.query.costEntries.findMany({
    where: and(
      eq(costEntries.userId, userId),
      eq(costEntries.periodCode, periodCode),
      inArray(costEntries.status, ["draft", "posted"]),
      inArray(costEntries.entryType, ["receipt_capitalize", "landed_cost"])
    ),
  });
  if (entries.length === 0) return [];

  const movementIds = [
    ...new Set(
      entries
        .map((entry) => entry.movementId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const voucherIds = [
    ...new Set(
      entries
        .map((entry) => entry.voucherId)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const [movements, components, items, warehouseRows, accounts, vouchers, allocationLines] =
    await Promise.all([
      movementIds.length > 0
        ? db.query.inventoryMovements.findMany({
            where: and(
              eq(inventoryMovements.userId, userId),
              inArray(inventoryMovements.id, movementIds)
            ),
            columns: {
              id: true,
              documentNo: true,
              date: true,
              sourceType: true,
              quantity: true,
            },
          })
        : Promise.resolve([]),
      db.query.costComponents.findMany({
        where: eq(costComponents.userId, userId),
        columns: { id: true, code: true, name: true },
      }),
      db.query.inventoryItems.findMany({
        where: eq(inventoryItems.userId, userId),
        columns: { id: true, code: true, name: true },
      }),
      db.query.warehouses.findMany({
        where: eq(warehouses.userId, userId),
        columns: { id: true, code: true, name: true },
      }),
      db.query.chartOfAccounts.findMany({
        where: eq(chartOfAccounts.userId, userId),
        columns: { number: true, name: true },
      }),
      voucherIds.length > 0
        ? db.query.journalVouchers.findMany({
            where: and(
              eq(journalVouchers.userId, userId),
              inArray(journalVouchers.id, voucherIds)
            ),
            columns: { id: true },
          })
        : Promise.resolve([]),
      db.query.costAllocationLines.findMany({
        with: { allocation: { columns: { documentNo: true, userId: true } } },
      }),
    ]);

  const movementById = new Map(movements.map((row) => [row.id, row]));
  const componentById = new Map(components.map((row) => [row.id, row]));
  const itemById = new Map(items.map((row) => [row.id, row]));
  const warehouseById = new Map(warehouseRows.map((row) => [row.id, row]));
  const accountName = new Map(accounts.map((row) => [row.number, row.name]));
  const postedVouchers = new Set(vouchers.map((row) => row.id));
  // Хуваарилалтын баримтын дугаар — өртгийн бичилтээс эсрэг холбоно.
  const allocationByEntry = new Map(
    allocationLines
      .filter((line) => line.allocation?.userId === userId && line.costEntryId)
      .map((line) => [line.costEntryId!, line.allocation.documentNo])
  );

  return entries
    .map((entry) => {
      const item = entry.itemId ? itemById.get(entry.itemId) : undefined;
      const warehouse = entry.warehouseId
        ? warehouseById.get(entry.warehouseId)
        : undefined;
      const movement = entry.movementId
        ? movementById.get(entry.movementId)
        : undefined;
      const component = entry.costComponentId
        ? componentById.get(entry.costComponentId)
        : undefined;
      const debit = entry.debitAccountNumber
        ? extractMainAccount(entry.debitAccountNumber)
        : null;
      const credit = entry.creditAccountNumber
        ? extractMainAccount(entry.creditAccountNumber)
        : null;
      const amount = Number(entry.amount);
      const receiptQty = movement ? Math.abs(Number(movement.quantity)) : 0;

      return {
        id: entry.id,
        periodCode,
        itemCode: item?.code ?? "—",
        itemName: item?.name ?? "—",
        warehouseLabel: warehouse
          ? `${warehouse.code} · ${warehouse.name}`
          : "—",
        // Бүрэлдэхүүн оноогоогүй орлого = худалдан авах үнэ.
        componentCode: component?.code ?? "PURCHASE",
        componentName: component?.name ?? "Худалдан авах үнэ",
        sourceDocumentType: movement
          ? movement.sourceType
          : entry.entryType === "landed_cost"
            ? "allocation"
            : "—",
        sourceDocumentNo: movement?.documentNo ?? "—",
        allocationDocumentNo: allocationByEntry.get(entry.id) ?? null,
        amount,
        /** Нэгжид үзүүлэх нөлөө — орлогын тоо хэмжээ мэдэгдэж байвал. */
        unitCostImpact: receiptQty > 0 ? amount / receiptQty : null,
        debitAccountCode: debit,
        debitAccountName: debit ? (accountName.get(debit) ?? null) : null,
        creditAccountCode: credit,
        creditAccountName: credit ? (accountName.get(credit) ?? null) : null,
        glStatus:
          entry.status === "posted"
            ? ("posted" as const)
            : ("pending" as const),
        journalNo:
          entry.voucherId && postedVouchers.has(entry.voucherId)
            ? entry.voucherId.slice(0, 8)
            : null,
        voucherId: entry.voucherId,
      };
    })
    .sort((a, b) =>
      a.itemCode === b.itemCode
        ? a.componentCode.localeCompare(b.componentCode)
        : a.itemCode.localeCompare(b.itemCode)
    );
}

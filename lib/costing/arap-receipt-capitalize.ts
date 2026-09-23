// PO-ГҮЙ АП нэхэмжлэхийн орлогыг (sourceType "arap_line") нэхэмжлэхийн мөрийн
// дүнгээр АВТОМАТААР капиталжуулна — НООРОГ `receipt_capitalize` бичилт
// (ENT-018). Батлах (GL-д бичих) нь бусад өртгийн бичилттэй ижил дараагийн
// алхам (human-in-the-loop). DB давхарга; цэвэр тооцоо arap-receipt-cost.ts.
//
// Идемпотент: тухайн хөдөлгөөнд идэвхтэй (ноорог/батлагдсан) капитализаци
// байвал хөндөхгүй — гараар өгсөн үнэ ялна.

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocumentLines,
  costEntries,
  inventoryMovements,
} from "@/lib/db/schema";
import { arapLineReceiptCost } from "./arap-receipt-cost";

type Executor = Pick<typeof db, "query" | "insert">;

export const ARAP_LINE_SOURCE_TYPE = "arap_line";

/**
 * Өгсөн (эсвэл бүх) БАТЛАГДСАН arap_line орлогод капитализацийн ноорог
 * үүсгэнэ. Буцаах нь үүссэн бичилтийн тоо.
 */
export async function capitalizeArapLineReceipts(
  executor: Executor,
  orgId: string,
  userId: string,
  movementIds?: string[]
): Promise<number> {
  if (movementIds && movementIds.length === 0) return 0;
  const movements = await executor.query.inventoryMovements.findMany({
    where: and(
      eq(inventoryMovements.organizationId, orgId),
      eq(inventoryMovements.status, "confirmed"),
      eq(inventoryMovements.movementType, "receipt"),
      eq(inventoryMovements.sourceType, ARAP_LINE_SOURCE_TYPE),
      ...(movementIds ? [inArray(inventoryMovements.id, movementIds)] : [])
    ),
  });
  const candidates = movements.filter((row) => row.sourceId && row.itemId);
  if (candidates.length === 0) return 0;

  const [active, lines] = await Promise.all([
    executor.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        inArray(costEntries.status, ["draft", "posted"]),
        inArray(
          costEntries.movementId,
          candidates.map((row) => row.id)
        )
      ),
      columns: { movementId: true, entryType: true },
    }),
    executor.query.arApDocumentLines.findMany({
      where: inArray(
        arApDocumentLines.id,
        candidates.map((row) => row.sourceId!)
      ),
      with: {
        document: {
          columns: { organizationId: true, exchangeRate: true, status: true },
        },
      },
    }),
  ]);
  // Идэвхтэй ҮНДСЭН үнэлгээтэй хөдөлгөөн (cost_entries_movement_active_uq-тай
  // ижил дүрэм) — landed_cost / cogs_true_up нь нэмэлт давхарга.
  const capitalized = new Set(
    active
      .filter((row) => row.entryType !== "landed_cost" && row.entryType !== "cogs_true_up")
      .map((row) => row.movementId)
  );
  const lineById = new Map(lines.map((line) => [line.id, line]));

  const inserts: (typeof costEntries.$inferInsert)[] = [];
  for (const movement of candidates) {
    if (capitalized.has(movement.id)) continue;
    const line = lineById.get(movement.sourceId!);
    // Өөр байгууллагын / буцаагдсан баримтын мөрөөр үнэлэхгүй.
    if (!line || line.document?.organizationId !== orgId) continue;
    if (line.document.status === "reversed" || line.document.status === "draft") continue;
    const cost = arapLineReceiptCost({
      amount: line.amount,
      quantity: line.quantity,
      exchangeRate: line.document.exchangeRate,
    });
    if (!cost) continue;
    const quantity = Math.abs(Number(movement.quantity));
    // Хөдөлгөөний тоо мөрийнхөөс зөрвөл (засварласан) нэгж өртгөөр бодно.
    const amount =
      Math.abs(quantity - Number(line.quantity)) < 1e-9
        ? cost.amount
        : Math.round(quantity * cost.unitCost * 100) / 100;
    inserts.push({
      userId,
      organizationId: orgId,
      movementId: movement.id,
      itemId: movement.itemId,
      warehouseId: movement.warehouseId,
      periodCode: movement.date.slice(0, 7),
      entryType: "receipt_capitalize",
      date: movement.date,
      quantity: String(quantity),
      unitCost: String(cost.unitCost),
      amount: String(amount),
      valuationSource: "ap_line",
      sourceLineId: line.id,
      ...(amount === 0 ? { status: "posted" as const, postedAt: new Date() } : {}),
    });
  }
  if (inserts.length > 0) await executor.insert(costEntries).values(inserts);
  return inserts.length;
}

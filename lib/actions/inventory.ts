"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  costEntries,
  inventoryIssueTypes,
  inventoryItems,
  inventoryMovements,
  warehouses,
} from "@/lib/db/schema";
import {
  balanceKey,
  calculateQtyBalances,
  findNegativeStock,
  type MovementRef,
  type MovementType,
} from "@/lib/inventory/balances";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Нэвтрэх шаардлагатай");
  return session.user.id;
}

function revalidateInventory() {
  for (const path of [
    "/inventory",
    "/inventory/movements",
    "/inventory/reports",
    "/inventory/items",
    "/costing",
    "/costing/entries",
    "/costing/reports",
  ])
    revalidatePath(path);
}

function cleanText(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

// ─── Мастер дата ─────────────────────────────────────────────────────────────

export async function createInventoryItem(data: {
  code: string;
  name: string;
  unit: string;
}) {
  const userId = await requireUser();
  const code = data.code.trim();
  const name = data.name.trim();
  const unit = data.unit.trim() || "ш";
  if (!code) throw new Error("Барааны код оруулна уу");
  if (!name) throw new Error("Барааны нэр оруулна уу");
  const duplicate = await db.query.inventoryItems.findFirst({
    where: and(eq(inventoryItems.userId, userId), eq(inventoryItems.code, code)),
    columns: { id: true },
  });
  if (duplicate) throw new Error(`"${code}" кодтой бараа бүртгэгдсэн байна`);
  await db.insert(inventoryItems).values({ userId, code, name, unit });
  revalidateInventory();
}

export async function updateInventoryItem(
  id: string,
  data: { name: string; unit: string }
) {
  const userId = await requireUser();
  const name = data.name.trim();
  if (!name) throw new Error("Барааны нэр оруулна уу");
  await db
    .update(inventoryItems)
    .set({ name, unit: data.unit.trim() || "ш" })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.userId, userId)));
  revalidateInventory();
}

export async function toggleInventoryItem(id: string, isActive: boolean) {
  const userId = await requireUser();
  await db
    .update(inventoryItems)
    .set({ isActive })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.userId, userId)));
  revalidateInventory();
}

export async function createWarehouse(data: { code: string; name: string }) {
  const userId = await requireUser();
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) throw new Error("Агуулахын код оруулна уу");
  if (!name) throw new Error("Агуулахын нэр оруулна уу");
  const duplicate = await db.query.warehouses.findFirst({
    where: and(eq(warehouses.userId, userId), eq(warehouses.code, code)),
    columns: { id: true },
  });
  if (duplicate) throw new Error(`"${code}" кодтой агуулах бүртгэгдсэн байна`);
  await db.insert(warehouses).values({ userId, code, name });
  revalidateInventory();
}

export async function toggleWarehouse(id: string, isActive: boolean) {
  const userId = await requireUser();
  await db
    .update(warehouses)
    .set({ isActive })
    .where(and(eq(warehouses.id, id), eq(warehouses.userId, userId)));
  revalidateInventory();
}

// ─── Хөдөлгөөн (зөвхөн тоо хэмжээ) ───────────────────────────────────────────

const MOVEMENT_TYPES: MovementType[] = [
  "receipt",
  "issue",
  "transfer",
  "adjustment",
  "return_in",
  "return_out",
];

type DbHandle = Pick<typeof db, "query" | "select">;

async function confirmedMovementRefs(
  handle: DbHandle,
  userId: string
): Promise<MovementRef[]> {
  const rows = await handle.query.inventoryMovements.findMany({
    where: and(
      eq(inventoryMovements.userId, userId),
      eq(inventoryMovements.status, "confirmed")
    ),
  });
  return rows.map((row) => ({
    id: row.id,
    movementType: row.movementType as MovementType,
    date: row.date,
    // Confirmed мөрөнд null байх боломжгүй (confirm-ийн шалгалт).
    itemId: row.itemId ?? "",
    warehouseId: row.warehouseId ?? "",
    toWarehouseId: row.toWarehouseId,
    quantity: Number(row.quantity),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function createInventoryMovement(data: {
  movementType: MovementType;
  date: string;
  itemId: string;
  warehouseId: string;
  toWarehouseId?: string;
  quantity: number;
  description?: string;
  documentNo?: string;
  /** Зарлагын төрөл — өртгийн дебет чиглэлийг шийднэ (FR-ISSUE-001). */
  issueTypeId?: string;
  confirmNow?: boolean;
}) {
  const userId = await requireUser();
  if (!MOVEMENT_TYPES.includes(data.movementType))
    throw new Error("Хөдөлгөөний төрөл буруу байна");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
    throw new Error("Огноо буруу байна");

  const quantity = Number(data.quantity);
  if (!Number.isFinite(quantity) || quantity === 0)
    throw new Error("Тоо хэмжээ 0 байж болохгүй");
  if (data.movementType !== "adjustment" && quantity <= 0)
    throw new Error("Тоо хэмжээ 0-ээс их байна");

  const [item, warehouse, toWarehouse] = await Promise.all([
    db.query.inventoryItems.findFirst({
      where: and(
        eq(inventoryItems.id, data.itemId),
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.isActive, true)
      ),
    }),
    db.query.warehouses.findFirst({
      where: and(
        eq(warehouses.id, data.warehouseId),
        eq(warehouses.userId, userId),
        eq(warehouses.isActive, true)
      ),
    }),
    data.toWarehouseId
      ? db.query.warehouses.findFirst({
          where: and(
            eq(warehouses.id, data.toWarehouseId),
            eq(warehouses.userId, userId),
            eq(warehouses.isActive, true)
          ),
        })
      : Promise.resolve(null),
  ]);
  if (!item) throw new Error("Идэвхтэй бараа олдсонгүй");
  if (!warehouse) throw new Error("Идэвхтэй агуулах олдсонгүй");
  if (data.movementType === "transfer") {
    if (!toWarehouse) throw new Error("Хүлээн авах агуулах сонгоно уу");
    if (data.toWarehouseId === data.warehouseId)
      throw new Error("Шилжүүлгийн агуулахууд ижил байж болохгүй");
  }

  const manualNo = cleanText(data.documentNo);
  if (manualNo && manualNo.length > 40)
    throw new Error("Баримтын дугаар 40 тэмдэгтээс хэтрэхгүй");
  if (manualNo) {
    const duplicate = await db.query.inventoryMovements.findFirst({
      where: and(
        eq(inventoryMovements.userId, userId),
        eq(inventoryMovements.documentNo, manualNo)
      ),
      columns: { id: true },
    });
    if (duplicate)
      throw new Error(`"${manualNo}" дугаартай хөдөлгөөн бүртгэгдсэн байна`);
  }
  const documentNo =
    manualNo ??
    `INV-${data.date.replaceAll("-", "")}-${crypto
      .randomUUID()
      .slice(0, 6)
      .toUpperCase()}`;

  const [movement] = await db
    .insert(inventoryMovements)
    .values({
      userId,
      documentNo,
      movementType: data.movementType,
      date: data.date,
      itemId: data.itemId,
      warehouseId: data.warehouseId,
      toWarehouseId: data.movementType === "transfer" ? data.toWarehouseId : null,
      quantity: String(quantity),
      description: data.description?.trim() ?? "",
      issueTypeId: await resolveIssueTypeId(
        userId,
        data.movementType,
        data.issueTypeId
      ),
    })
    .returning({ id: inventoryMovements.id });

  if (data.confirmNow) await confirmInventoryMovement(movement.id);
  else revalidateInventory();
  return { id: movement.id };
}


/**
 * Зарлагын төрлийг шалгана. Зөвхөн ЗАРЛАГЫН чиглэлийн хөдөлгөөнд утгатай
 * (FR-ISSUE-001); бусад төрөлд null болгоно. Идэвхтэй байх ёстой.
 */
async function resolveIssueTypeId(
  userId: string,
  movementType: MovementType,
  issueTypeId: string | undefined
): Promise<string | null> {
  const bearsIssueCost =
    movementType === "issue" || movementType === "return_out";
  if (!bearsIssueCost) return null;
  if (!issueTypeId) return null;
  const type = await db.query.inventoryIssueTypes.findFirst({
    where: and(
      eq(inventoryIssueTypes.id, issueTypeId),
      eq(inventoryIssueTypes.userId, userId),
      eq(inventoryIssueTypes.isActive, true)
    ),
    columns: { id: true },
  });
  if (!type) throw new Error("Идэвхтэй зарлагын төрөл олдсонгүй");
  return type.id;
}

// Ноорог хөдөлгөөнийг засах — sentinel (GL/касс) draft-ыг бөглөх гол зам.
export async function updateInventoryMovement(
  id: string,
  data: {
    movementType: MovementType;
    date: string;
    itemId: string;
    warehouseId: string;
    toWarehouseId?: string;
    quantity: number;
    description?: string;
    issueTypeId?: string;
  }
) {
  const userId = await requireUser();
  const movement = await db.query.inventoryMovements.findFirst({
    where: and(
      eq(inventoryMovements.id, id),
      eq(inventoryMovements.userId, userId)
    ),
    columns: { status: true },
  });
  if (!movement) throw new Error("Хөдөлгөөн олдсонгүй");
  if (movement.status !== "draft")
    throw new Error("Зөвхөн ноорог хөдөлгөөнийг засна");
  if (!MOVEMENT_TYPES.includes(data.movementType))
    throw new Error("Хөдөлгөөний төрөл буруу байна");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
    throw new Error("Огноо буруу байна");
  const quantity = Number(data.quantity);
  if (!Number.isFinite(quantity) || quantity === 0)
    throw new Error("Тоо хэмжээ 0 байж болохгүй");
  if (data.movementType !== "adjustment" && quantity <= 0)
    throw new Error("Тоо хэмжээ 0-ээс их байна");

  const [item, warehouse, toWarehouse] = await Promise.all([
    db.query.inventoryItems.findFirst({
      where: and(
        eq(inventoryItems.id, data.itemId),
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.isActive, true)
      ),
    }),
    db.query.warehouses.findFirst({
      where: and(
        eq(warehouses.id, data.warehouseId),
        eq(warehouses.userId, userId),
        eq(warehouses.isActive, true)
      ),
    }),
    data.toWarehouseId
      ? db.query.warehouses.findFirst({
          where: and(
            eq(warehouses.id, data.toWarehouseId),
            eq(warehouses.userId, userId),
            eq(warehouses.isActive, true)
          ),
        })
      : Promise.resolve(null),
  ]);
  if (!item) throw new Error("Идэвхтэй бараа олдсонгүй");
  if (!warehouse) throw new Error("Идэвхтэй агуулах олдсонгүй");
  if (data.movementType === "transfer") {
    if (!toWarehouse) throw new Error("Хүлээн авах агуулах сонгоно уу");
    if (data.toWarehouseId === data.warehouseId)
      throw new Error("Шилжүүлгийн агуулахууд ижил байж болохгүй");
  }

  await db
    .update(inventoryMovements)
    .set({
      movementType: data.movementType,
      date: data.date,
      itemId: data.itemId,
      warehouseId: data.warehouseId,
      toWarehouseId: data.movementType === "transfer" ? data.toWarehouseId : null,
      quantity: String(quantity),
      description: data.description?.trim() ?? "",
      issueTypeId: await resolveIssueTypeId(
        userId,
        data.movementType,
        data.issueTypeId
      ),
    })
    .where(
      and(
        eq(inventoryMovements.id, id),
        eq(inventoryMovements.userId, userId),
        eq(inventoryMovements.status, "draft")
      )
    );
  revalidateInventory();
}

export async function confirmInventoryMovement(id: string) {
  const userId = await requireUser();

  // Шалгалт + claim нэг транзакцад, хэрэглэгч бүрийн advisory lock дор —
  // хоёр ӨӨР ноорогийг зэрэг батлахад хоёулаа шалгалтыг давж үлдэгдлийг
  // хасах болгох race-ээс сэргийлнэ.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), 1)`);

    const movement = await tx.query.inventoryMovements.findFirst({
      where: and(
        eq(inventoryMovements.id, id),
        eq(inventoryMovements.userId, userId)
      ),
    });
    if (!movement) throw new Error("Хөдөлгөөн олдсонгүй");
    if (movement.status !== "draft")
      throw new Error("Зөвхөн ноорог хөдөлгөөнийг батална");
    // GL/кассаас үүссэн sentinel: бараа, агуулах, тоо бөглөгдөөгүй бол
    // батлахгүй — засварлаад дахин оролдоно.
    if (!movement.itemId || !movement.warehouseId)
      throw new Error("Бараа, агуулах сонгоогүй байна — засаад батална уу");
    const movementQty = Number(movement.quantity);
    if (!Number.isFinite(movementQty) || movementQty === 0)
      throw new Error("Тоо хэмжээ бөглөөгүй байна — засаад батална уу");
    if (movement.movementType !== "adjustment" && movementQty <= 0)
      throw new Error("Тоо хэмжээ 0-ээс их байна");

    // Хасах үлдэгдлийн шалгалт: он цагийн бүх цэг дээр ≥ 0 (энэ хөдөлгөөнийг
    // оруулаад, өмнөх огноогоор бичихэд дараагийн үлдэгдлүүд ч эвдрэхгүй).
    const existing = await confirmedMovementRefs(tx, userId);
    const violation = findNegativeStock(existing, {
      id: movement.id,
      movementType: movement.movementType as MovementType,
      date: movement.date,
      itemId: movement.itemId,
      warehouseId: movement.warehouseId,
      toWarehouseId: movement.toWarehouseId,
      quantity: movementQty,
      createdAt: movement.createdAt.toISOString(),
    });
    if (violation)
      throw new Error(
        `Үлдэгдэл хасах болно (${violation.date}: ${violation.balanceAfter}) — батлах боломжгүй`
      );

    const [claimed] = await tx
      .update(inventoryMovements)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(
        and(
          eq(inventoryMovements.id, id),
          eq(inventoryMovements.userId, userId),
          eq(inventoryMovements.status, "draft")
        )
      )
      .returning({ id: inventoryMovements.id });
    if (!claimed) throw new Error("Хөдөлгөөний төлөв өөрчлөгдсөн байна");
  });
  revalidateInventory();
}

// Олноор батлах — алдаатай нь алгасагдаж тайлан буцна.
export async function confirmInventoryMovements(ids: string[]) {
  const failures: { id: string; error: string }[] = [];
  let confirmed = 0;
  for (const id of ids) {
    try {
      await confirmInventoryMovement(id);
      confirmed += 1;
    } catch (caught) {
      failures.push({
        id,
        error: caught instanceof Error ? caught.message : "Батлагдсангүй",
      });
    }
  }
  return { confirmed, failures };
}

export async function deleteInventoryMovement(id: string) {
  const userId = await requireUser();
  const movement = await db.query.inventoryMovements.findFirst({
    where: and(
      eq(inventoryMovements.id, id),
      eq(inventoryMovements.userId, userId)
    ),
    columns: { status: true },
  });
  if (!movement) return;
  if (movement.status !== "draft")
    throw new Error("Зөвхөн ноорог хөдөлгөөнийг устгана");
  await db
    .delete(inventoryMovements)
    .where(and(eq(inventoryMovements.id, id), eq(inventoryMovements.userId, userId)));
  revalidateInventory();
}

// Баталсан хөдөлгөөнийг цуцлах — зөвхөн идэвхтэй cost entry-гүй үед
// (үнэлэгдсэн бол эхлээд costing талд буцаалт хийнэ — уялдааны гэрээ).
export async function cancelInventoryMovement(id: string) {
  const userId = await requireUser();
  const movement = await db.query.inventoryMovements.findFirst({
    where: and(
      eq(inventoryMovements.id, id),
      eq(inventoryMovements.userId, userId)
    ),
  });
  if (!movement) throw new Error("Хөдөлгөөн олдсонгүй");
  if (movement.status !== "confirmed")
    throw new Error("Зөвхөн баталсан хөдөлгөөнийг цуцална");

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), 1)`);

    const activeEntry = await tx.query.costEntries.findFirst({
      where: and(
        eq(costEntries.userId, userId),
        eq(costEntries.movementId, id),
        inArray(costEntries.status, ["draft", "posted"])
      ),
      columns: { id: true, status: true },
    });
    if (activeEntry)
      throw new Error(
        "Энэ хөдөлгөөн үнэлэгдсэн байна — эхлээд өртгийн бичилтийг нь буцааж/устгана уу"
      );

    // Цуцлахад бусад баталсан хөдөлгөөний үлдэгдэл эвдрэхгүй байх ёстой
    // (ж: орлогыг цуцлахад түүнээс хойшхи зарлага хасах болж болзошгүй).
    const existing = (await confirmedMovementRefs(tx, userId)).filter(
      (ref) => ref.id !== id
    );
    const violation = findNegativeStock(existing);
    if (violation)
      throw new Error(
        `Цуцалбал үлдэгдэл хасах болно (${violation.date}: ${violation.balanceAfter})`
      );

    const [claimed] = await tx
      .update(inventoryMovements)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(inventoryMovements.id, id),
          eq(inventoryMovements.userId, userId),
          eq(inventoryMovements.status, "confirmed")
        )
      )
      .returning({ id: inventoryMovements.id });
    if (!claimed) throw new Error("Хөдөлгөөний төлөв өөрчлөгдсөн байна");
  });
  revalidateInventory();
}

// ─── Тооллого ────────────────────────────────────────────────────────────────

// Тооллогын хуудас: агуулах, огноо, бараа бүрийн тоолсон тоог хүлээж авч
// системийн үлдэгдэлтэй (тухайн огнооны байдлаар, сервер талд дахин тооцно)
// харьцуулаад зөрүү бүрд ТОХИРУУЛГЫН НООРОГ хөдөлгөөн үүсгэнэ. Ноорог нь
// ердийн замаараа батлагдаж, costing run илүүдлийг 51800003, дутагдлыг
// 87100004-өөр журналдана. Advisory lock — батлах/цуцлахтай нэг цуваанд.
export async function recordInventoryCount(data: {
  date: string;
  warehouseId: string;
  counts: { itemId: string; countedQty: number }[];
}) {
  const userId = await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
    throw new Error("Огноо буруу байна");
  if (data.counts.length === 0)
    throw new Error("Тоолсон бараа алга");

  const warehouse = await db.query.warehouses.findFirst({
    where: and(
      eq(warehouses.id, data.warehouseId),
      eq(warehouses.userId, userId),
      eq(warehouses.isActive, true)
    ),
    columns: { id: true },
  });
  if (!warehouse) throw new Error("Идэвхтэй агуулах олдсонгүй");

  const itemIds = data.counts.map((count) => count.itemId);
  const items = await db.query.inventoryItems.findMany({
    where: and(
      eq(inventoryItems.userId, userId),
      eq(inventoryItems.isActive, true),
      inArray(inventoryItems.id, itemIds)
    ),
    columns: { id: true },
  });
  const ownedItems = new Set(items.map((item) => item.id));

  return await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), 1)`);

    // Системийн үлдэгдэл тооллогын огнооны байдлаар (confirmed replay).
    const refs = (await confirmedMovementRefs(tx, userId)).filter(
      (ref) => ref.date <= data.date
    );
    const balances = calculateQtyBalances(refs);

    const inserts: (typeof inventoryMovements.$inferInsert)[] = [];
    for (const count of data.counts) {
      if (!ownedItems.has(count.itemId))
        throw new Error("Идэвхтэй бараа олдсонгүй");
      const countedQty = Number(count.countedQty);
      if (!Number.isFinite(countedQty) || countedQty < 0)
        throw new Error("Тоолсон тоо 0 буюу түүнээс их байна");
      const systemQty =
        balances.get(balanceKey(count.itemId, data.warehouseId)) ?? 0;
      const difference = Math.round((countedQty - systemQty) * 10000) / 10000;
      if (difference === 0) continue;
      inserts.push({
        userId,
        documentNo: `CNT-${data.date.replaceAll("-", "")}-${crypto
          .randomUUID()
          .slice(0, 6)
          .toUpperCase()}`,
        movementType: "adjustment",
        date: data.date,
        itemId: count.itemId,
        warehouseId: data.warehouseId,
        toWarehouseId: null,
        quantity: String(difference),
        description: `Тооллого ${data.date}: систем ${systemQty}, тоолсон ${countedQty}`,
        status: "draft",
        sourceType: "manual",
        sourceId: null,
      });
    }

    if (inserts.length > 0) await tx.insert(inventoryMovements).values(inserts);
    return { created: inserts.length };
  }).then((result) => {
    revalidateInventory();
    return result;
  });
}

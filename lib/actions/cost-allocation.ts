"use server";

// Нэмэлт зардлын хуваарилалт — тээвэр, гааль, даатгал зэргийг бараанд
// хуваарилж, барааны Орлогын дүнд нэмнэ (docs/cost §10, §11, FR-ALLOC-*).
//
// Хуваарийн суурийг баримт бүрд хэрэглэгч сонгоно (OD-017, 0.3-д батлагдсан):
// үнийн дүнгээр / тоо хэмжээгээр / гараар. Хуваарилалт бүр `landed_cost`
// төрлийн НООРОГ өртгийн бичилт үүсгэнэ — GL-д бичих нь тусдаа алхам.
//
// ХАНГАМЖ (docs/procurement §3.6, contract §9): зардал нь PO-той АП
// нэхэмжлэхийн МӨРӨӨС гарвал (`sourceLineId`) хуваарилалт тухайн PO-гийн
// хүлээн авалтуудад л бууна, бүрэлдэхүүн нь мөрөөс ирнэ, нийлбэр нь мөрийн
// MNT дүнг хэтрэхгүй (`for update`-тэй шалгалт), жин нь D6 = (а) —
// ЗӨВХӨН `receipt_capitalize` дүн (өмнө хуваарилсан landed_cost жинд орохгүй).

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { roundMoney } from "@/lib/arap/accounting";
import { logAuditEvent } from "@/lib/audit";
import { getActiveOrg, requireModuleAction, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  arApDocumentLines,
  costAllocationLines,
  costAllocations,
  costComponents,
  costEntries,
  goodsReceipts,
  inventoryMovements,
  purchaseOrders,
} from "@/lib/db/schema";
import {
  allocate,
  type AllocationBase,
  type AllocationTarget,
} from "@/lib/costing/allocation";
import { reverseCostEntry } from "@/lib/actions/costing";
import { assertPeriodOpen } from "@/lib/periods/guard";
import {
  PO_BUSINESS_OBJECT,
  PO_SOURCE_TYPE,
} from "@/lib/procurement/constants";

/**
 * Хуваарилалт өртгийн дэлгэцүүд БОЛОН хангамжийн "хуваарилагдаагүй зардал"
 * worklist-д нөлөөлдөг тул хоёуланг шинэчилнэ.
 */
function revalidateAllocation() {
  for (const path of [
    "/costing",
    "/costing/allocations",
    "/costing/entries",
    "/costing/control",
    "/procurement",
    "/procurement/costs",
    "/procurement/orders",
  ])
    revalidatePath(path);
}

export interface AllocationTargetOption {
  movementId: string;
  documentNo: string;
  date: string;
  itemLabel: string;
  warehouseLabel: string;
  quantity: number;
  /** Тухайн орлогын одоогийн өртөг (үнийн дүнгээр хуваахад хэрэглэгдэнэ). */
  value: number;
}

export interface AllocationRow {
  id: string;
  documentNo: string;
  date: string;
  componentLabel: string;
  allocationBase: string;
  totalAmount: number;
  lineCount: number;
}

export type AllocationResultAction =
  | { ok: true; documentNo: string; lineCount: number }
  | {
      ok: false;
      code: "unauthenticated" | "validation" | "failed";
      message?: string;
    };

/**
 * Хуваарилах боломжтой орлогын хөдөлгөөнүүд — батлагдсан, бараа/агуулахтай,
 * тухайн огнооны мужид. `value` нь одоогийн үнэлэгдсэн дүн (өртөгтэй
 * бичилтүүдийн нийлбэр).
 */
export async function loadAllocationTargets(range: {
  from: string;
  to: string;
}): Promise<AllocationTargetOption[]> {
  const active = await getActiveOrg().catch(() => null);
  if (!active) return [];
  const { orgId } = active;

  const movements = await db.query.inventoryMovements.findMany({
    where: and(
      eq(inventoryMovements.organizationId, orgId),
      eq(inventoryMovements.status, "confirmed"),
      eq(inventoryMovements.movementType, "receipt"),
      gte(inventoryMovements.date, range.from),
      lte(inventoryMovements.date, range.to)
    ),
    with: { item: true, warehouse: true },
    orderBy: (movement, { asc }) => [asc(movement.date)],
  });
  if (movements.length === 0) return [];

  const entries = await db.query.costEntries.findMany({
    where: and(
      eq(costEntries.organizationId, orgId),
      inArray(costEntries.status, ["draft", "posted"]),
      inArray(
        costEntries.movementId,
        movements.map((movement) => movement.id)
      )
    ),
    columns: { movementId: true, entryType: true, amount: true },
  });
  const valueByMovement = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.movementId) continue;
    if (
      entry.entryType !== "receipt_capitalize" &&
      entry.entryType !== "landed_cost"
    )
      continue;
    valueByMovement.set(
      entry.movementId,
      (valueByMovement.get(entry.movementId) ?? 0) + Number(entry.amount)
    );
  }

  return movements
    .filter((movement) => movement.itemId && movement.warehouseId)
    .map((movement) => ({
      movementId: movement.id,
      documentNo: movement.documentNo,
      date: movement.date,
      itemLabel: movement.item
        ? `${movement.item.code} · ${movement.item.name}`
        : "—",
      warehouseLabel: movement.warehouse
        ? `${movement.warehouse.code} · ${movement.warehouse.name}`
        : "—",
      quantity: Math.abs(Number(movement.quantity)),
      value: valueByMovement.get(movement.id) ?? 0,
    }));
}

/**
 * ХАНГАМЖ: тухайн ЗАХИАЛГЫН (PO) хуваарилах боломжтой хүлээн авалтууд —
 * батлагдсан хүлээн авалтын мөрүүдээс үүссэн `po_receipt` орлогууд.
 *
 * `value` нь D6 = (а) дүрмээр ЗӨВХӨН `receipt_capitalize` дүн: өмнө
 * хуваарилсан `landed_cost` жинд ОРОХГҮЙ тул "үнийн дүнгээр" суурийн
 * үр дүн хуваарилалтын ДАРААЛЛААС хамаарахгүй (docs/cost README 0.6).
 */
export async function loadPoAllocationTargets(
  purchaseOrderId: string
): Promise<AllocationTargetOption[]> {
  const active = await getActiveOrg().catch(() => null);
  if (!active) return [];
  const { orgId } = active;

  // Хүлээн авалтын мөр → орлогын хөдөлгөөн (confirm хийхэд movementId
  // бөглөгддөг). Зөвхөн батлагдсан хүлээн авалт.
  const receipts = await db.query.goodsReceipts.findMany({
    where: and(
      eq(goodsReceipts.organizationId, orgId),
      eq(goodsReceipts.purchaseOrderId, purchaseOrderId),
      eq(goodsReceipts.status, "confirmed")
    ),
    with: { lines: { columns: { movementId: true } } },
  });
  const movementIds = [
    ...new Set(
      receipts
        .flatMap((receipt) => receipt.lines.map((line) => line.movementId))
        .filter((id): id is string => !!id)
    ),
  ];
  if (movementIds.length === 0) return [];

  const movements = await db.query.inventoryMovements.findMany({
    where: and(
      eq(inventoryMovements.organizationId, orgId),
      eq(inventoryMovements.status, "confirmed"),
      eq(inventoryMovements.movementType, "receipt"),
      inArray(inventoryMovements.id, movementIds)
    ),
    with: { item: true, warehouse: true },
    orderBy: (movement, { asc }) => [asc(movement.date)],
  });
  if (movements.length === 0) return [];

  const entries = await db.query.costEntries.findMany({
    where: and(
      eq(costEntries.organizationId, orgId),
      inArray(costEntries.status, ["draft", "posted"]),
      inArray(
        costEntries.movementId,
        movements.map((movement) => movement.id)
      )
    ),
    columns: { movementId: true, entryType: true, amount: true },
  });
  const valueByMovement = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.movementId) continue;
    // D6 = (а): ЗӨВХӨН капитализацийн дүн (PO нэгж үнэ × хүлээн авсан
    // өдрийн МБ ханш) — landed_cost НЭМЭГДЭХГҮЙ.
    if (entry.entryType !== "receipt_capitalize") continue;
    valueByMovement.set(
      entry.movementId,
      (valueByMovement.get(entry.movementId) ?? 0) + Number(entry.amount)
    );
  }

  return movements
    .filter((movement) => movement.itemId && movement.warehouseId)
    .map((movement) => ({
      movementId: movement.id,
      documentNo: movement.documentNo,
      date: movement.date,
      itemLabel: movement.item
        ? `${movement.item.code} · ${movement.item.name}`
        : "—",
      warehouseLabel: movement.warehouse
        ? `${movement.warehouse.code} · ${movement.warehouse.name}`
        : "—",
      quantity: Math.abs(Number(movement.quantity)),
      value: valueByMovement.get(movement.id) ?? 0,
    }));
}

/** Бүртгэгдсэн хуваарилалтууд. */
export async function loadAllocations(): Promise<AllocationRow[]> {
  const active = await getActiveOrg().catch(() => null);
  if (!active) return [];
  const { orgId } = active;

  const [rows, components] = await Promise.all([
    db.query.costAllocations.findMany({
      where: eq(costAllocations.organizationId, orgId),
      with: { lines: true },
      orderBy: (allocation, { desc }) => [desc(allocation.date)],
    }),
    db.query.costComponents.findMany({
      where: eq(costComponents.organizationId, orgId),
      columns: { id: true, code: true, name: true },
    }),
  ]);
  const componentLabel = new Map(
    components.map((component) => [
      component.id,
      `${component.code} · ${component.name}`,
    ])
  );

  return rows.map((row) => ({
    id: row.id,
    documentNo: row.documentNo,
    date: row.date,
    componentLabel: componentLabel.get(row.costComponentId) ?? "—",
    allocationBase: row.allocationBase,
    totalAmount: Number(row.totalAmount),
    lineCount: row.lines.length,
  }));
}

export async function createCostAllocation(data: {
  date: string;
  costComponentId: string;
  totalAmount: number;
  allocationBase: AllocationBase;
  description?: string;
  documentNo?: string;
  /**
   * ХАНГАМЖ: зардал гарсан АП нэхэмжлэхийн мөр (contract §9). Өгвөл
   * бүрэлдэхүүн МӨРӨӨС ирнэ, зорилт нь тухайн PO-гийн хүлээн авалтууд,
   * Σ хуваарилалт мөрийн MNT дүнгээс хэтрэхгүй.
   */
  sourceLineId?: string;
  /** Сонгосон орлогууд + гараар бичсэн дүн. */
  targets: { movementId: string; manualAmount?: number }[];
}): Promise<AllocationResultAction> {
  const active = await requireRole("accountant").catch(() => null);
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId, userId } = active;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
    return { ok: false, code: "validation", message: "Огноо буруу байна" };

  try {
    await assertPeriodOpen(orgId, data.date);
  } catch (caught) {
    return {
      ok: false,
      code: "validation",
      message: caught instanceof Error ? caught.message : "Тайлант үе хаагдсан",
    };
  }

  // ── Хангамжийн эх мөр (байвал): бүрэлдэхүүн, PO, ханш эндээс ──────────────
  const sourceLineId = data.sourceLineId?.trim() || undefined;
  let purchaseOrderId: string | null = null;
  let lineExchangeRate = 1;
  let componentId = data.costComponentId;

  if (sourceLineId) {
    const sourceLine = await db.query.arApDocumentLines.findFirst({
      where: eq(arApDocumentLines.id, sourceLineId),
      with: { document: true },
    });
    if (!sourceLine || sourceLine.document?.organizationId !== orgId)
      return {
        ok: false,
        code: "validation",
        message: "Зардлын нэхэмжлэхийн мөр олдсонгүй",
      };
    const document = sourceLine.document;
    if (document.documentType !== "ap_bill")
      return {
        ok: false,
        code: "validation",
        message: "Зөвхөн өглөгийн нэхэмжлэхийн мөрөөс хуваарилна",
      };
    if (!document.purchaseOrderId)
      return {
        ok: false,
        code: "validation",
        message: "Нэхэмжлэх худалдан авалтын захиалгатай холбогдоогүй байна",
      };
    if (!["posted", "partially_paid", "paid"].includes(document.status))
      return {
        ok: false,
        code: "validation",
        message:
          "Нэхэмжлэх батлагдаагүй байна — эхлээд нэхэмжлэхийг батална уу",
      };
    if (!sourceLine.costComponentId)
      return {
        ok: false,
        code: "validation",
        message: "Мөрд өртгийн бүрэлдэхүүн заагдаагүй байна",
      };
    if (
      data.costComponentId &&
      data.costComponentId !== sourceLine.costComponentId
    )
      return {
        ok: false,
        code: "validation",
        message: "Бүрэлдэхүүн нэхэмжлэхийн мөрөөс ирнэ — сонголт зөрж байна",
      };
    // Хаагдсан/цуцлагдсан PO-д зардал нэмэхгүй (түр дансууд аль хэдийн
    // тэгширсэн — шинэ хуваарилалт тэнцвэрийг эвдэнэ).
    const order = await db.query.purchaseOrders.findFirst({
      where: and(
        eq(purchaseOrders.id, document.purchaseOrderId),
        eq(purchaseOrders.organizationId, orgId)
      ),
      columns: { id: true, status: true, documentNo: true },
    });
    if (!order)
      return {
        ok: false,
        code: "validation",
        message: "[PO_NOT_FOUND] Захиалга олдсонгүй",
      };
    if (order.status !== "open")
      return {
        ok: false,
        code: "validation",
        message: `[PO_CLOSED] ${order.documentNo} захиалга нээлттэй биш — хуваарилалт нэмэх боломжгүй`,
      };
    purchaseOrderId = order.id;
    lineExchangeRate = Number(document.exchangeRate);
    componentId = sourceLine.costComponentId;
  }

  const component = await db.query.costComponents.findFirst({
    where: and(
      eq(costComponents.id, componentId),
      eq(costComponents.organizationId, orgId),
      // Мөрөөс ирсэн бүрэлдэхүүнийг (нэхэмжлэх бичигдсэн хойно
      // идэвхгүйжсэн байж болно) идэвхтэй байхыг шаардахгүй — эс бөгөөс
      // хуваарилалт мухардна.
      ...(sourceLineId ? [] : [eq(costComponents.isActive, true)])
    ),
  });
  if (!component)
    return {
      ok: false,
      code: "validation",
      message: "Идэвхтэй өртгийн бүрэлдэхүүн сонгоно уу",
    };

  const movementIds = data.targets.map((target) => target.movementId);
  if (movementIds.length === 0)
    return {
      ok: false,
      code: "validation",
      message: "Хуваарилах орлого сонгоно уу",
    };

  // Сонгосон орлогуудыг эзэмшил, төлөв, төрлөөр шалгана.
  const movements = await db.query.inventoryMovements.findMany({
    where: and(
      eq(inventoryMovements.organizationId, orgId),
      eq(inventoryMovements.status, "confirmed"),
      eq(inventoryMovements.movementType, "receipt"),
      inArray(inventoryMovements.id, movementIds)
    ),
  });
  if (movements.length !== movementIds.length)
    return {
      ok: false,
      code: "validation",
      message: "Сонгосон орлогуудын нэг нь батлагдаагүй эсвэл олдсонгүй",
    };

  // PO-гийн хүлээн авалтад хуваарилахдаа зардлын мөрийг ЗААВАЛ холбоно:
  // ингэснээр жин нь D6 = (а) дүрмээр бодогдож, клиринг PO объектоор
  // тэгширч, Σ ≤ мөрийн дүн шалгалт ажиллана.
  if (
    !sourceLineId &&
    movements.some((movement) => movement.sourceType === PO_SOURCE_TYPE)
  )
    return {
      ok: false,
      code: "validation",
      message:
        "Захиалгын хүлээн авалтад хуваарилахдаа зардлын нэхэмжлэхийн мөрийг холбоно уу (Хангамж → Хуваарилагдаагүй зардал)",
    };

  const options = purchaseOrderId
    ? await loadPoAllocationTargets(purchaseOrderId)
    : await loadAllocationTargets({
        from: movements.reduce(
          (min, movement) => (movement.date < min ? movement.date : min),
          movements[0].date
        ),
        to: movements.reduce(
          (max, movement) => (movement.date > max ? movement.date : max),
          movements[0].date
        ),
      });
  const optionByMovement = new Map(
    options.map((option) => [option.movementId, option])
  );
  if (
    purchaseOrderId &&
    data.targets.some((target) => !optionByMovement.has(target.movementId))
  )
    return {
      ok: false,
      code: "validation",
      message: "Зөвхөн энэ захиалгын хүлээн авалтад хуваарилна",
    };

  const targets: AllocationTarget[] = data.targets.map((target) => {
    const option = optionByMovement.get(target.movementId);
    return {
      movementId: target.movementId,
      quantity: option?.quantity ?? 0,
      value: option?.value ?? 0,
      manualAmount: target.manualAmount,
    };
  });

  const result = allocate({
    totalAmount: data.totalAmount,
    base: data.allocationBase,
    targets,
  });
  if (!result.ok)
    return { ok: false, code: "validation", message: result.error };

  const movementById = new Map(
    movements.map((movement) => [movement.id, movement])
  );
  const documentNo =
    data.documentNo?.trim() ||
    `ALLOC-${data.date.replaceAll("-", "")}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;

  const totalAmountRounded = Math.round(data.totalAmount * 100) / 100;

  try {
    await db.transaction(async (tx) => {
      // ── Σ хуваарилалт ≤ мөрийн MNT дүн (зэрэгцээ хуваарилалтаас
      // хамгаалж мөрийг ЦООЖИЛНО) ─────────────────────────────────────────
      if (sourceLineId) {
        const [lockedLine] = await tx
          .select({
            id: arApDocumentLines.id,
            amount: arApDocumentLines.amount,
          })
          .from(arApDocumentLines)
          .where(eq(arApDocumentLines.id, sourceLineId))
          .for("update");
        if (!lockedLine) throw new Error("Зардлын нэхэмжлэхийн мөр олдсонгүй");

        // Мөрийн MNT дүн = мөрийн валют дүн × баримтын ханш (АР/АП-ийн
        // calculateBaseAmount-тай ИЖИЛ). АР/АП нь бөөрөнхийллийн үлдэгдлийг
        // СҮҮЛИЙН мөрд шингээдэг тул хүлцэл 0.01 (журналын хүлцэлтэй ижил) —
        // цент зөрүүгээс болж бүтэн дүнгээ хуваарилж чадахгүй болохоос
        // сэргийлнэ.
        const lineMnt = roundMoney(Number(lockedLine.amount) * lineExchangeRate);
        const prior = await tx
          .select({ totalAmount: costAllocations.totalAmount })
          .from(costAllocations)
          .where(
            and(
              eq(costAllocations.organizationId, orgId),
              eq(costAllocations.sourceLineId, sourceLineId)
            )
          );
        const already = roundMoney(
          prior.reduce((sum, row) => sum + Number(row.totalAmount), 0)
        );
        if (already + totalAmountRounded > lineMnt + 0.01)
          throw new Error(
            `[ALLOCATION_EXCEEDS_LINE] Хуваарилалтын нийлбэр (${(
              already + totalAmountRounded
            ).toLocaleString("en-US")}₮) мөрийн дүнгээс (${lineMnt.toLocaleString(
              "en-US"
            )}₮) хэтэрч байна`
          );
      }

      const [allocation] = await tx
        .insert(costAllocations)
        .values({
          userId,
          organizationId: orgId,
          documentNo,
          date: data.date,
          costComponentId: component.id,
          totalAmount: String(totalAmountRounded),
          allocationBase: data.allocationBase,
          description: data.description?.trim() ?? "",
          sourceLineId: sourceLineId ?? null,
          purchaseOrderId,
          createdBy: userId,
        })
        .returning({ id: costAllocations.id });

      for (const line of result.lines) {
        const movement = movementById.get(line.movementId)!;
        // Барааны өртөгт нэмэгдэх ноорог бичилт. quantity = 0 —
        // тоо хэмжээ нэмэгдэхгүй, зөвхөн ДҮН нэмэгдэнэ (IAS 2.11).
        const [entry] = await tx
          .insert(costEntries)
          .values({
            userId,
            organizationId: orgId,
            movementId: movement.id,
            itemId: movement.itemId,
            warehouseId: movement.warehouseId,
            periodCode: movement.date.slice(0, 7),
            costComponentId: component.id,
            entryType: "landed_cost",
            date: data.date,
            quantity: "0",
            unitCost: "0",
            amount: String(line.amount),
            // Аудитын lineage + клирингийн бизнес объект (contract §9):
            // PO-той зардал нь нэхэмжлэхийн мөрөөс ирснийг ил тэмдэглэнэ.
            valuationSource: sourceLineId ? "ap_line" : "manual",
            sourceLineId: sourceLineId ?? null,
            businessObjectType: purchaseOrderId ? PO_BUSINESS_OBJECT : null,
            businessObjectId: purchaseOrderId,
          })
          .returning({ id: costEntries.id });

        await tx.insert(costAllocationLines).values({
          allocationId: allocation.id,
          movementId: movement.id,
          baseValue: String(line.baseValue),
          amount: String(line.amount),
          costEntryId: entry.id,
        });
      }

      await logAuditEvent(
        {
          userId,
          organizationId: orgId,
          action: "create",
          entityType: "cost_allocation",
          entityId: allocation.id,
          summary: `Нэмэлт зардал хуваарилагдав — ${documentNo}, ${data.date}, дүн ${totalAmountRounded.toLocaleString("en-US")}₮, ${result.lines.length} бараа`,
        },
        tx
      );
    });
  } catch (caught) {
    return {
      ok: false,
      code: "failed",
      message: caught instanceof Error ? caught.message : "Хадгалж чадсангүй",
    };
  }

  revalidateAllocation();
  return { ok: true, documentNo, lineCount: result.lines.length };
}

/**
 * Хуваарилалтыг БУЦААХ (contract §9) — үүссэн `landed_cost` бичилтүүдийг
 * буцааж (батлагдсаныг `reverseCostEntry`-ээр эсрэг журналтай, нооргийг
 * устгаж), хуваарилалтын баримтыг устгана.
 *
 * Баримтыг УСТГАХ нь ухамсарлагдсан шийдвэр: `cost_allocations`-д төлөв
 * байхгүй бөгөөд Σ ≤ мөрийн дүн шалгалт нь тухайн мөрийн хуваарилалтуудын
 * нийлбэрээр бодогддог тул устгаснаар мөрийн "хуваарилагдаагүй" дүн
 * зөв сэргэнэ. Үйлдэл нь аудитын мөрөөр хадгалагдана.
 */
export async function reverseCostAllocation(input: {
  allocationId: string;
}): Promise<AllocationResultAction> {
  const active = await requireModuleAction("cost", "post").catch(() => null);
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId, userId } = active;

  const allocation = await db.query.costAllocations.findFirst({
    where: and(
      eq(costAllocations.id, input.allocationId),
      eq(costAllocations.organizationId, orgId)
    ),
    with: { lines: true },
  });
  if (!allocation)
    return { ok: false, code: "validation", message: "Хуваарилалт олдсонгүй" };

  try {
    await assertPeriodOpen(orgId, allocation.date);
  } catch (caught) {
    return {
      ok: false,
      code: "validation",
      message: caught instanceof Error ? caught.message : "Тайлант үе хаагдсан",
    };
  }

  // Хаагдсан PO-гийн хуваарилалтыг буцаавал түр дансны тэнцвэр эвдэрнэ —
  // эхлээд PO-г дахин нээнэ.
  if (allocation.purchaseOrderId) {
    const order = await db.query.purchaseOrders.findFirst({
      where: and(
        eq(purchaseOrders.id, allocation.purchaseOrderId),
        eq(purchaseOrders.organizationId, orgId)
      ),
      columns: { status: true, documentNo: true },
    });
    if (order && order.status !== "open")
      return {
        ok: false,
        code: "validation",
        message: `[PO_CLOSED] ${order.documentNo} захиалга нээлттэй биш — эхлээд захиалгыг дахин нээнэ үү`,
      };
  }

  const entryIds = allocation.lines
    .map((line) => line.costEntryId)
    .filter((id): id is string => !!id);
  const entries =
    entryIds.length > 0
      ? await db.query.costEntries.findMany({
          where: and(
            eq(costEntries.organizationId, orgId),
            inArray(costEntries.id, entryIds)
          ),
          columns: { id: true, status: true },
        })
      : [];

  try {
    // Батлагдсан бичилт — эсрэг журналаар (reverseCostEntry өөрийн
    // транзакцтай, period guard-тай). Ноорог — дундажид нөлөөлөөгүй тул
    // шууд устгана (postedLandedCosts зөвхөн posted-ыг уншдаг).
    for (const entry of entries)
      if (entry.status === "posted") await reverseCostEntry(entry.id);

    const draftIds = entries
      .filter((entry) => entry.status === "draft")
      .map((entry) => entry.id);

    await db.transaction(async (tx) => {
      if (draftIds.length > 0)
        await tx
          .delete(costEntries)
          .where(
            and(
              eq(costEntries.organizationId, orgId),
              inArray(costEntries.id, draftIds),
              eq(costEntries.status, "draft")
            )
          );

      // Мөрүүд cascade-аар устана.
      const [claimed] = await tx
        .delete(costAllocations)
        .where(
          and(
            eq(costAllocations.id, allocation.id),
            eq(costAllocations.organizationId, orgId)
          )
        )
        .returning({ id: costAllocations.id });
      if (!claimed) throw new Error("Хуваарилалт аль хэдийн буцаагдсан байна");

      await logAuditEvent(
        {
          userId,
          organizationId: orgId,
          action: "reverse",
          entityType: "cost_allocation",
          entityId: allocation.id,
          summary: `Нэмэлт зардлын хуваарилалт буцаагдав — ${allocation.documentNo}, ${allocation.date}, дүн ${Number(allocation.totalAmount).toLocaleString("en-US")}₮, ${allocation.lines.length} бараа`,
        },
        tx
      );
    });
  } catch (caught) {
    return {
      ok: false,
      code: "failed",
      message: caught instanceof Error ? caught.message : "Буцаагдсангүй",
    };
  }

  revalidateAllocation();
  return {
    ok: true,
    documentNo: allocation.documentNo,
    lineCount: allocation.lines.length,
  };
}

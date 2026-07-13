// Эх үүсвэрээс inventory-ийн ТОО ХЭМЖЭЭНИЙ draft үүсгэгч (plain server
// модуль — "use server" БИШ: server-to-server дуудахад шууд ажиллана,
// cash-ийн sync-voucher.ts-тэй ижил шалтгаанаар).
//
// Хоёр эх үүсвэр:
//   1. АР/АП баримтын бараатай мөр (itemId + quantity) батлагдах үед —
//      АП → орлого (receipt), АР → зарлага (issue) draft, мөр бүрд 1:1.
//   2. GL воучер 14-бүлгийн данс хөндөх үед — бараа/тоо нь үл мэдэгдэх
//      SENTINEL draft (qty 0, item null): хэрэглэгч бөглөж батална.
//      Costing-ийн өөрийн воучер болон бараатай мөрөөр аль хэдийн
//      хамрагдсан АР/АП воучерыг алгасна (давхар draft үүсэхгүй).
//
// Бүгд best-effort: алдаа нь эх үйлдлийг (АП батлах, GL post) унагахгүй.

import { and, eq, inArray, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  costEntries,
  inventoryMovements,
  journalVouchers,
} from "@/lib/db/schema";

function autoDocumentNo(prefix: string, date: string) {
  return `${prefix}-${date.replaceAll("-", "")}-${crypto
    .randomUUID()
    .slice(0, 6)
    .toUpperCase()}`;
}

function revalidateInventoryPaths() {
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  revalidatePath("/costing");
}

function mainAccountOf(accountNumber: string) {
  const parts = accountNumber.split(".");
  return parts.length === 10 ? parts[2] : accountNumber;
}

// Клирингийн данс — худалдан авалтын суваг бүр ЭНД бичих ёстой (өртгийн
// модуль Dr бараа данс / Cr клиринг гэж капитализаци хийдэг). 14000001 г.м.
// бараа дансанд шууд бичсэн журналд sentinel ҮҮСГЭХГҮЙ — costing давхарлана;
// тийм бичилт GL тулгалтын тайланд зөрүү болж илэрнэ.
const CLEARING_MAIN = "14000099";

/** АР/АП баримтын бараатай мөр бүрд тоо хэмжээний draft (идемпотент). */
export async function createMovementDraftsForArApDocument(documentId: string) {
  try {
    const document = await db.query.arApDocuments.findFirst({
      where: eq(arApDocuments.id, documentId),
      with: { lines: true },
    });
    if (!document) return 0;

    const itemLines = document.lines.filter(
      (line) => line.itemId && Number(line.quantity) > 0
    );
    if (itemLines.length === 0) return 0;

    const existing = await db.query.inventoryMovements.findMany({
      where: and(
        eq(inventoryMovements.userId, document.userId),
        eq(inventoryMovements.sourceType, "arap_line"),
        inArray(
          inventoryMovements.sourceId,
          itemLines.map((line) => line.id)
        )
      ),
      columns: { sourceId: true },
    });
    const linked = new Set(existing.map((row) => row.sourceId));

    const movementType =
      document.documentType === "ap_bill" ? "receipt" : "issue";
    const inserts = itemLines
      .filter((line) => !linked.has(line.id))
      .map((line) => ({
        userId: document.userId,
        documentNo: autoDocumentNo("INV", document.date),
        movementType,
        date: document.date,
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        toWarehouseId: null,
        quantity: String(Number(line.quantity)),
        description: `[${document.documentNo}] ${line.description || document.description}`,
        status: "draft",
        sourceType: "arap_line",
        sourceId: line.id,
      }));
    if (inserts.length === 0) return 0;

    await db.insert(inventoryMovements).values(inserts);
    revalidateInventoryPaths();
    return inserts.length;
  } catch (error) {
    console.error("[createMovementDraftsForArApDocument]", error);
    return 0;
  }
}

/**
 * GL воучер КЛИРИНГИЙН данс (14000099) руу Dr бичсэн бол sentinel draft —
 * энэ нь "бараа ирсэн, тоо хэмжээ нь бүртгэгдээгүй" гэсэн дохио. Клирингээс
 * гадуурх 14-данс руу шууд бичсэн журналд draft үүсгэхгүй (costing-ийн
 * капитализацитай давхарлана) — тэдгээр нь тулгалтын тайланд илэрнэ.
 */
export async function syncInventoryDraftForVoucher(voucherId: string) {
  try {
    const voucher = await db.query.journalVouchers.findFirst({
      where: eq(journalVouchers.id, voucherId),
      with: { lines: true },
    });
    if (!voucher || voucher.status !== "posted") return;
    const userId = voucher.userId;

    // Клирингийн цэвэр Dr нөлөө (худалдан авалт клирингт суусан дүн)
    let net = 0;
    for (const line of voucher.lines) {
      if (mainAccountOf(line.accountNumber) !== CLEARING_MAIN) continue;
      net += Number(line.debit) - Number(line.credit);
    }
    net = Math.round(net * 100) / 100;
    if (net <= 0) return;

    // Идемпотент + давхардлаас хамгаалах шүүлтүүрүүд:
    const [alreadySynced, costingOwned, arApDoc] = await Promise.all([
      db.query.inventoryMovements.findFirst({
        where: and(
          eq(inventoryMovements.userId, userId),
          eq(inventoryMovements.sourceType, "gl_voucher"),
          eq(inventoryMovements.sourceId, voucherId)
        ),
        columns: { id: true },
      }),
      // Costing-ийн өөрийн журнал (үнэлгээ өөрөө) — sentinel хэрэггүй.
      db.query.costEntries.findFirst({
        where: and(
          eq(costEntries.userId, userId),
          or(
            eq(costEntries.voucherId, voucherId),
            eq(costEntries.reversalVoucherId, voucherId)
          )
        ),
        columns: { id: true },
      }),
      db.query.arApDocuments.findFirst({
        where: and(
          eq(arApDocuments.userId, userId),
          eq(arApDocuments.voucherId, voucherId)
        ),
        columns: { id: true, exchangeRate: true },
      }),
    ]);
    if (alreadySynced || costingOwned) return;

    // АР/АП воучер: бараатай мөрүүд line-түвшний draft-аар хамрагдана.
    // Клирингийн цэвэр Dr-ийг бараатай мөрүүдийн дүн бүрэн нөхөж байвал
    // sentinel хэрэггүй; дутуу бол (холимог баримт — бараагүй клиринг мөр
    // байгаа) сануулга болгож sentinel үүсгэнэ.
    if (arApDoc) {
      const documentLines = await db.query.arApDocumentLines.findMany({
        where: eq(arApDocumentLines.documentId, arApDoc.id),
      });
      const exchangeRate = Number(arApDoc.exchangeRate) || 1;
      const coveredBase = documentLines
        .filter((line) => line.itemId && Number(line.quantity) > 0)
        .reduce(
          (sum, line) =>
            sum + Math.round(Number(line.amount) * exchangeRate * 100) / 100,
          0
        );
      // Rounding residual (сүүлийн мөрөнд шингэдэг) багтаах бага зөрөөс.
      if (net - coveredBase <= 0.05) return;
    }

    await db.insert(inventoryMovements).values({
      userId,
      documentNo: autoDocumentNo("INV", voucher.date),
      movementType: net > 0 ? "receipt" : "issue",
      date: voucher.date,
      itemId: null,
      warehouseId: null,
      toWarehouseId: null,
      quantity: "0", // sentinel — бараа/тоог бөглөтөл батлагдахгүй
      description: `[GL] ${voucher.description}`,
      status: "draft",
      sourceType: "gl_voucher",
      sourceId: voucherId,
    });
    revalidateInventoryPaths();
  } catch (error) {
    console.error("[syncInventoryDraftForVoucher]", error);
  }
}

/**
 * Воучер буцаагдахад (unpost/сторно) түүнээс үүссэн БӨГЛӨГДӨӨГҮЙ draft-уудыг
 * устгана — эх бичилт нь 0 болсон гүйлгээг хэрэглэгч андуурч баталж,
 * үнэлүүлэхээс сэргийлнэ. Confirmed хөдөлгөөнд гар хүрэхгүй (нягтлан өөрөө
 * шийднэ — тайланд зөрүү болж харагдана).
 */
export async function removeDraftMovementsForVoucher(voucherId: string) {
  try {
    await db
      .delete(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.sourceType, "gl_voucher"),
          eq(inventoryMovements.sourceId, voucherId),
          eq(inventoryMovements.status, "draft")
        )
      );
    revalidateInventoryPaths();
  } catch (error) {
    console.error("[removeDraftMovementsForVoucher]", error);
  }
}

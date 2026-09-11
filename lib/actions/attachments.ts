"use server";

// Хавсралтын server action-ууд — ЖАГСААХ ба УСТГАХ.
//
// Хуулах (upload) нь ЭНД БАЙХГҮЙ: server action-ы body 1MB-аар
// хязгаарлагдсан (next.config.ts-д serverActions.bodySizeLimit байхгүй) тул
// 8MB файл multipart route handler-аар явна — app/api/attachments/route.ts.
//
// ⚠️ "use server" файл ЗӨВХӨН async функц export хийнэ (const export нь dev
// серверийг унагадаг). Тогтмолууд lib/attachments/constants.ts-д.
//
// Гэрээ: docs/procurement/01-implementation-contract.md §7.

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";

import { actionError, type ActionResult } from "@/lib/action-result";
import {
  attachmentKindLabel,
  attachmentModuleKeyOf,
  isUuidLike,
} from "@/lib/attachments/constants";
import { logAuditEvent } from "@/lib/audit";
import { getActiveOrg, requireModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentAttachments, purchaseOrders, users } from "@/lib/db/schema";
import { PO_BUSINESS_OBJECT } from "@/lib/procurement/constants";

/** Жагсаалтын мөр — `data` (base64) ХЭЗЭЭ Ч оролцохгүй. */
export type AttachmentView = {
  id: string;
  kind: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  /** "YYYY-MM-DD HH:mm" — Улаанбаатарын цагаар (lib/actions/mcp-tokens.ts хэв маяг). */
  createdAt: string;
  /** Хавсаргасан хэрэглэгчийн нэр. */
  uploadedBy: string;
};

function fmtTime(value: Date): string {
  return value
    .toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" })
    .slice(0, 16);
}

function revalidateAttachments() {
  revalidatePath("/procurement");
  revalidatePath("/procurement/orders");
  revalidatePath("/procurement/receipts");
}

/**
 * Тухайн объектын хавсралтууд (шинээс хуучин руу).
 *
 * `data` багана СОНГОГДОХГҮЙ — 8MB файлууд жагсаалт болгонд memory-д
 * ачаалагдахаас сэргийлнэ (app/api/ai/chat/route.ts-ийн explicit columns
 * хэв маяг).
 */
export async function listAttachments(
  entityType: string,
  entityId: string
): Promise<ActionResult<{ items: AttachmentView[] }>> {
  try {
    const moduleKey = attachmentModuleKeyOf(entityType);
    if (!moduleKey) throw new Error("Хавсралт дэмжигдээгүй объект");
    const { orgId } = await requireModuleAction(moduleKey, "read");
    if (!isUuidLike(entityId)) return { items: [] };

    const rows = await db
      .select({
        id: documentAttachments.id,
        kind: documentAttachments.kind,
        name: documentAttachments.name,
        mediaType: documentAttachments.mediaType,
        sizeBytes: documentAttachments.sizeBytes,
        createdAt: documentAttachments.createdAt,
        uploadedBy: users.name,
      })
      .from(documentAttachments)
      .leftJoin(users, eq(documentAttachments.userId, users.id))
      .where(
        and(
          eq(documentAttachments.organizationId, orgId),
          eq(documentAttachments.entityType, entityType),
          eq(documentAttachments.entityId, entityId)
        )
      )
      .orderBy(desc(documentAttachments.createdAt));

    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        mediaType: row.mediaType,
        sizeBytes: row.sizeBytes,
        createdAt: fmtTime(row.createdAt),
        uploadedBy: row.uploadedBy ?? "",
      })),
    };
  } catch (caught) {
    return actionError("listAttachments", caught, "Хавсралт ачаалж чадсангүй");
  }
}

/**
 * Хавсралт устгах. Хаагдсан/цуцлагдсан захиалгын хавсралтыг устгахыг
 * ХОРИГЛОНО (аудитын мөр хэвээр байх ёстой — 00-proposal.md §3.6a);
 * нэмэх нь зөвшөөрөгдөнө.
 */
export async function deleteAttachment(id: string): Promise<ActionResult> {
  try {
    if (!isUuidLike(id)) throw new Error("Хавсралт олдсонгүй");
    const { orgId } = await getActiveOrg();

    const attachment = await db.query.documentAttachments.findFirst({
      where: and(
        eq(documentAttachments.id, id),
        eq(documentAttachments.organizationId, orgId)
      ),
      columns: {
        id: true,
        entityType: true,
        entityId: true,
        kind: true,
        name: true,
      },
    });
    if (!attachment) throw new Error("Хавсралт олдсонгүй");

    const moduleKey = attachmentModuleKeyOf(attachment.entityType);
    if (!moduleKey) throw new Error("Хавсралт дэмжигдээгүй объект");
    const { userId } = await requireModuleAction(moduleKey, "write");

    if (attachment.entityType === PO_BUSINESS_OBJECT) {
      const order = await db.query.purchaseOrders.findFirst({
        where: and(
          eq(purchaseOrders.id, attachment.entityId),
          eq(purchaseOrders.organizationId, orgId)
        ),
        columns: { status: true, documentNo: true },
      });
      if (order && (order.status === "closed" || order.status === "cancelled"))
        throw new Error(
          `${order.documentNo}: хаагдсан/цуцлагдсан захиалгын хавсралтыг устгах боломжгүй`
        );
    }

    await db
      .delete(documentAttachments)
      .where(
        and(
          eq(documentAttachments.id, attachment.id),
          eq(documentAttachments.organizationId, orgId)
        )
      );

    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "detach",
      entityType: attachment.entityType,
      entityId: attachment.entityId,
      summary: `${attachment.name} · ${attachmentKindLabel(attachment.kind)}`,
    });
    revalidateAttachments();
    return {};
  } catch (caught) {
    return actionError("deleteAttachment", caught, "Хавсралт устгаж чадсангүй");
  }
}

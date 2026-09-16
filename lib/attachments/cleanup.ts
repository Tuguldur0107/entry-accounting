// Баримт устгагдахад хавсралтыг нь хамт цэвэрлэнэ. document_attachments
// polymorphic (FK-гүй) тул модуль бүрийн delete зам ҮҮНИЙГ өөрөө дуудна —
// эс бөгөөс orphan хавсралт үлдэнэ (гэрээ §7, PO-ийн хэв маяг).
// ЭНГИЙН модуль ("use server" биш) — action дотроос шууд дуудагдана.

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { documentAttachments } from "@/lib/db/schema";

export async function deleteAttachmentsFor(
  orgId: string,
  entityType: string,
  entityId: string
) {
  await db
    .delete(documentAttachments)
    .where(
      and(
        eq(documentAttachments.organizationId, orgId),
        eq(documentAttachments.entityType, entityType),
        eq(documentAttachments.entityId, entityId)
      )
    );
}

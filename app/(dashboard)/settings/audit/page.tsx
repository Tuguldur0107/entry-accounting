// Аудитын мөр — хэн, хэзээ, юу хийснийг харах хуудас (зөвхөн унших).
// Статус шилжилт бүрд lib/audit.ts-ийн logAuditEvent нэг мөр бичдэг;
// энд тухайн хэрэглэгчийн сүүлийн 500 тэмдэглэлийг шинээс нь харуулна.

import { desc, eq } from "drizzle-orm";

import { AuditLogView, type AuditLogRow } from "@/components/audit/audit-log-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";

export default async function AuditLogPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Нэвтрэх шаардлагатай");

  const events = await db.query.auditEvents.findMany({
    where: eq(auditEvents.userId, userId),
    orderBy: [desc(auditEvents.createdAt)],
    limit: 500,
  });

  const rows: AuditLogRow[] = events.map((event) => ({
    id: event.id,
    createdAt: event.createdAt.toISOString(),
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    summary: event.summary,
  }));

  return <AuditLogView rows={rows} />;
}

// Аудитын мөрдөлт — статус шилжилт бүрд нэг тэмдэглэл.
//
// Дүрэм: logAuditEvent нь БИЗНЕСИЙН урсгалыг хэзээ ч унагахгүй (аудит
// бичигдэхгүй байх нь бичилт бүтэлгүйтэхээс дээр) — алдааг console-д
// логлоод залгина. Транзакц дотор дуудвал tx-ээ дамжуулна (commit-тэй
// хамт бичигдэнэ); гадна нь бол db-гээр шууд.

import { db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";

type DbLike = Pick<typeof db, "insert">;

export type AuditEventInput = {
  /** Хэн хийсэн (createdBy). */
  userId: string;
  /** Фаз 01: аль байгууллагад — заавал. */
  organizationId: string;
  /** post | unpost | reverse | delete | close | reopen | create_voucher ... */
  action: string;
  /** journal | cash | arap | fa | cost | period | payroll | vat ... */
  entityType: string;
  entityId: string;
  /** Хүнд уншигдах товч тайлбар (дугаар, дүн, огноо). */
  summary?: string;
};

export async function logAuditEvent(
  event: AuditEventInput,
  executor: DbLike = db
): Promise<void> {
  try {
    await executor.insert(auditEvents).values({
      userId: event.userId,
      organizationId: event.organizationId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      summary: event.summary ?? "",
    });
  } catch (error) {
    console.error("[audit] бичиж чадсангүй:", event.action, event.entityType, error);
  }
}

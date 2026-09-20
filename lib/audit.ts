// Аудитын мөрдөлт — статус шилжилт бүрд нэг тэмдэглэл.
//
// Дүрэм: logAuditEvent нь БИЗНЕСИЙН урсгалыг хэзээ ч унагахгүй (аудит
// бичигдэхгүй байх нь бичилт бүтэлгүйтэхээс дээр) — алдааг console-д
// логлоод залгина. Транзакц дотор дуудвал tx-ээ дамжуулна (commit-тэй
// хамт бичигдэнэ); гадна нь бол db-гээр шууд.

import { db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";
import { notifyFromAudit } from "@/lib/notifications/bridge";
import { applyAuditToOutcomes } from "@/lib/ai-logging/service";

// "update" нь AI бүртгэлийн гүүрт хэрэгтэй (applyAuditToOutcomes).
type DbLike = Pick<typeof db, "insert" | "select" | "update">;

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
    return;
  }
  // AI бүртгэлийн гүүр (docs/ai-logging.md §6): батлалт / буцаалт / устгалт
  // нь AI-ийн саналын ҮР ДҮНГИЙН шошгыг өөрчилнө. Энд дэгээдсэнээр 20 гаруй
  // post зам, 8 хүснэгтийн буцаалтыг тус тусад нь хөөх шаардлагагүй —
  // зам бүр аль хэдийн logAuditEvent дууддаг. Ижил executor: tx дотор бол
  // бичилттэйгээ хамт commit/rollback. Хэзээ ч шидэхгүй.
  await applyAuditToOutcomes(
    {
      organizationId: event.organizationId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
    },
    executor
  );
  // Мэдэгдлийн гүүр (docs/notifications §4): аудитын үйл явдал мэдэгдэл
  // болох эсэхийг lib/notifications/rules.ts шийднэ. Ижил executor — tx
  // дотор бол мэдэгдэл бичилттэйгээ хамт commit/rollback. Хэзээ ч шидэхгүй.
  await notifyFromAudit(event, executor);
}

// Аудит → мэдэгдлийн ГҮҮР (DB давхарга). logAuditEvent-ийн хажууд дуудагдана
// (lib/audit.ts) — 74 бичих цэг хөндөгдөхгүй. Дүрэм нь цэвэр rules.ts-д;
// энд зөвхөн «entity-owner» audience-ийг DB-ээс шийднэ (ноорогийг хэн
// үүсгэсэн бэ, эрх нь өөрчлөгдсөн гишүүн хэн бэ) ба АП баримтын замыг
// нарийвчилна. Хэзээ ч шидэхгүй.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocuments,
  cashDocuments,
  journalVouchers,
  memberships,
} from "@/lib/db/schema";

import { emitNotification, type NotificationExecutor } from "./emit";
import { notificationFromAudit, type AuditLikeEvent } from "./rules";
import type { NotificationDraft } from "./types";

export interface AuditBridgeEvent extends AuditLikeEvent {
  organizationId: string;
}

/** Объектын эзэн (createdBy / гишүүн) + АР/АП-д зам нарийвчлал. */
async function resolveEntityOwner(
  event: AuditBridgeEvent
): Promise<{ userId: string; href?: string } | null> {
  switch (event.entityType) {
    case "journal": {
      const row = await db.query.journalVouchers.findFirst({
        where: eq(journalVouchers.id, event.entityId),
        columns: { userId: true, organizationId: true },
      });
      return row && row.organizationId === event.organizationId
        ? { userId: row.userId }
        : null;
    }
    case "arap": {
      const row = await db.query.arApDocuments.findFirst({
        where: eq(arApDocuments.id, event.entityId),
        columns: { userId: true, organizationId: true, documentType: true },
      });
      if (!row || row.organizationId !== event.organizationId) return null;
      return {
        userId: row.userId,
        href: row.documentType.startsWith("ap_")
          ? "/payables/documents"
          : "/receivables/documents",
      };
    }
    case "cash": {
      const row = await db.query.cashDocuments.findFirst({
        where: eq(cashDocuments.id, event.entityId),
        columns: { userId: true, organizationId: true },
      });
      return row && row.organizationId === event.organizationId
        ? { userId: row.userId }
        : null;
    }
    case "membership": {
      const row = await db.query.memberships.findFirst({
        where: eq(memberships.id, event.entityId),
        columns: { userId: true, organizationId: true },
      });
      return row && row.organizationId === event.organizationId
        ? { userId: row.userId }
        : null;
    }
    default:
      return null;
  }
}

/**
 * Аудитын бичилтээс мэдэгдэл үүсгэнэ (шаардлагатай бол). Транзакц дотроос
 * дуудахад executor (tx) дамжуулна — мэдэгдэл бичилттэйгээ хамт commit болно.
 */
export async function notifyFromAudit(
  event: AuditBridgeEvent,
  executor?: NotificationExecutor
): Promise<number> {
  try {
    const draft = notificationFromAudit(event);
    if (!draft) return 0;

    let resolved: NotificationDraft = draft;
    if (draft.audience.kind === "entity-owner") {
      const owner = await resolveEntityOwner(event);
      if (!owner) return 0;
      resolved = {
        ...draft,
        href: owner.href ?? draft.href,
        audience: { kind: "users", userIds: [owner.userId] },
      };
    } else if (event.entityType === "arap") {
      // Буцаалт г.м — АП баримт бол өглөгийн жагсаалт руу.
      const owner = await resolveEntityOwner(event);
      if (owner?.href) resolved = { ...draft, href: owner.href };
    }

    return await emitNotification(event.organizationId, resolved, {
      actorUserId: event.userId,
      executor,
    });
  } catch (error) {
    console.error("[notifications] аудитын гүүр:", event.action, event.entityType, error);
    return 0;
  }
}

// Аудит → мэдэгдлийн ГҮҮР (DB давхарга). logAuditEvent-ийн хажууд дуудагдана
// (lib/audit.ts) — 74 бичих цэг хөндөгдөхгүй. Дүрэм нь цэвэр rules.ts-д;
// энд зөвхөн «entity-owner» audience-ийг DB-ээс шийднэ (ноорогийг хэн
// үүсгэсэн бэ, эрх нь өөрчлөгдсөн гишүүн хэн бэ) ба АП баримтын замыг
// нарийвчилна. Хэзээ ч шидэхгүй.

import { eq, sum } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocuments,
  cashDocuments,
  companySettings,
  journalLines,
  journalVouchers,
  memberships,
} from "@/lib/db/schema";

import { emitNotification, type NotificationExecutor } from "./emit";
import {
  DEFAULT_LARGE_AMOUNT_MNT,
  largeAmountNotification,
  notificationFromAudit,
  type AuditLikeEvent,
} from "./rules";
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

/** Батлагдсан баримтын MNT дүн (D2 — том дүнгийн мэдэгдэлд). Олдохгүй бол null.
 *  create_posted үед мөрүүд tx дотор (commit-оос өмнө) тул executor-оор уншина. */
async function resolveAmountMnt(
  event: AuditBridgeEvent,
  executor: NotificationExecutor
): Promise<number | null> {
  switch (event.entityType) {
    case "journal": {
      const [row] = await executor
        .select({ total: sum(journalLines.debit) })
        .from(journalLines)
        .where(eq(journalLines.voucherId, event.entityId));
      return row?.total == null ? null : Number(row.total);
    }
    case "arap": {
      const [row] = await executor
        .select({ totalAmount: arApDocuments.totalAmount, exchangeRate: arApDocuments.exchangeRate })
        .from(arApDocuments)
        .where(eq(arApDocuments.id, event.entityId));
      return row ? Number(row.totalAmount) * Number(row.exchangeRate || 1) : null;
    }
    case "cash": {
      const [row] = await executor
        .select({
          amount: cashDocuments.amount,
          exchangeRate: cashDocuments.exchangeRate,
          baseAmount: cashDocuments.baseAmount,
        })
        .from(cashDocuments)
        .where(eq(cashDocuments.id, event.entityId));
      if (!row) return null;
      return row.baseAmount != null
        ? Number(row.baseAmount)
        : Number(row.amount) * Number(row.exchangeRate || 1);
    }
    default:
      return null;
  }
}

async function largeAmountThreshold(organizationId: string): Promise<number> {
  const row = await db.query.companySettings.findFirst({
    where: eq(companySettings.organizationId, organizationId),
    columns: { largeAmountAlertMnt: true },
  });
  const value = row?.largeAmountAlertMnt == null ? NaN : Number(row.largeAmountAlertMnt);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_LARGE_AMOUNT_MNT;
}

/** D2: том дүнгийн мэдэгдэл — post/create_posted үед, эзэн/админд. */
async function notifyLargeAmount(
  event: AuditBridgeEvent,
  executor?: NotificationExecutor
): Promise<number> {
  try {
    if (!["post", "create_posted"].includes(event.action)) return 0;
    if (!["journal", "arap", "cash"].includes(event.entityType)) return 0;
    const [amount, threshold] = await Promise.all([
      resolveAmountMnt(event, executor ?? db),
      largeAmountThreshold(event.organizationId),
    ]);
    const draft = largeAmountNotification(event, amount, threshold);
    if (!draft) return 0;
    return await emitNotification(event.organizationId, draft, {
      actorUserId: event.userId,
      executor,
    });
  } catch (error) {
    console.error("[notifications] том дүн:", event.entityType, error);
    return 0;
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
  const large = await notifyLargeAmount(event, executor);
  try {
    const draft = notificationFromAudit(event);
    if (!draft) return large;

    let resolved: NotificationDraft = draft;
    if (draft.audience.kind === "entity-owner") {
      const owner = await resolveEntityOwner(event);
      if (!owner) return large;
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

    return (
      large +
      (await emitNotification(event.organizationId, resolved, {
        actorUserId: event.userId,
        executor,
      }))
    );
  } catch (error) {
    console.error("[notifications] аудитын гүүр:", event.action, event.entityType, error);
    return large;
  }
}

// Аудит → мэдэгдлийн ГҮҮРИЙН ДҮРЭМ — ЦЭВЭР (тесттэй, DB-гүй).
//
// logAuditEvent-ийн 74 бичих цэгийг хөндөхгүй: бичилт бүр энд нэг удаа
// «мэдэгдэл болох уу, хэнд очих вэ» гэж тайлагдана. Таарахгүй үйл явдал
// (delete, update, sync …) чимээгүй null. Шинэ мэдэгдэл нэмэхдээ call site-д
// emit ГАР дуудахгүй — энд дүрэм нэмнэ (CLAUDE.md §9d).

import type { NotificationType } from "./catalog";
import type { NotificationAudience, NotificationDraft } from "./types";

/** logAuditEvent-ийн оролттой ижил хэсэг (lib/audit.ts AuditEventInput). */
export interface AuditLikeEvent {
  /** Үйлдлийг хийсэн хүн (actor). */
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  summary?: string;
}

/** Аудитын entityType → модулийн түлхүүр(үүд) (lib/constants/app-modules.ts). */
export const ENTITY_MODULE_KEYS: Record<string, string[]> = {
  journal: ["gl"],
  arap: ["ar", "ap"],
  cash: ["cash"],
  fa: ["fa"],
  cost: ["cost"],
  cost_allocation: ["cost"],
  inventory: ["inv"],
  purchase_order: ["proc"],
  goods_receipt: ["proc"],
  payroll: ["payroll"],
};

/** Панельгүй (эсвэл панель нээгдэхгүй) үед очих жагсаалтын зам. */
export const ENTITY_HREF: Record<string, string> = {
  journal: "/gl/journal",
  arap: "/receivables/documents",
  cash: "/cash/transactions",
  fa: "/fa/assets",
  cost: "/costing",
  cost_allocation: "/costing/allocations",
  inventory: "/inventory/movements",
  purchase_order: "/procurement/orders",
  goods_receipt: "/procurement/receipts",
  payroll: "/payroll",
  period: "/settings/periods",
  membership: "/settings/permissions",
};

const ENTITY_LABEL: Record<string, string> = {
  journal: "Журнал",
  arap: "АР/АП баримт",
  cash: "Кассын баримт",
  fa: "Элэгдлийн бичилт",
  cost: "Өртгийн бичилт",
  cost_allocation: "Зардлын хуваарилалт",
  inventory: "Барааны хөдөлгөөн",
};

/** D2: «том дүн» мэдэгдлийн default босго (MNT) — company_settings.largeAmountAlertMnt дарна. */
export const DEFAULT_LARGE_AMOUNT_MNT = 10_000_000;

const POST_ACTIONS = new Set(["post", "create_posted"]);

const REVERSE_ACTIONS = new Set(["reverse", "unpost", "fx_reverse"]);
const POSTABLE_ENTITIES = new Set(["journal", "arap", "cash"]);
const REVERSIBLE_ENTITIES = new Set([
  "journal",
  "arap",
  "cash",
  "fa",
  "cost",
  "cost_allocation",
  "inventory",
]);

/** Минутын нарийвчлалтай тамга — ижил объект дээрх ижил үйлдэл нэг минутын
 *  дотор давтагдвал (retry) нэг л мэдэгдэл; reopen→close дахин хийвэл шинэ. */
export function minuteStamp(now: Date): string {
  return now.toISOString().slice(0, 16);
}

function moduleAudience(
  entityType: string,
  minLevel: "read" | "write" | "post"
): NotificationAudience | null {
  const moduleKeys = ENTITY_MODULE_KEYS[entityType];
  return moduleKeys ? { kind: "module", moduleKeys, minLevel } : null;
}

function draft(
  event: AuditLikeEvent,
  now: Date,
  type: NotificationType,
  title: string,
  audience: NotificationAudience,
  extra?: Partial<NotificationDraft>
): NotificationDraft {
  return {
    type,
    title,
    body: event.summary ?? "",
    href: ENTITY_HREF[event.entityType],
    entityType: event.entityType,
    entityId: event.entityId,
    dedupeKey: `${event.action}:${event.entityType}:${event.entityId}:${minuteStamp(now)}`,
    // UI-ийн панель dispatcher-т: fx_reverse г.м entityId нь баримт биш.
    payload: { action: event.action },
    audience,
    ...extra,
  };
}

/**
 * D2: батлагдсан баримтын MNT дүн босгоос ≥ бол эзэн/админд (actor-оос бусад).
 * Дүнг гүүр (bridge.ts) DB-ээс уншиж өгнө — энд зөвхөн дүрэм.
 */
export function largeAmountNotification(
  event: AuditLikeEvent,
  amountMnt: number | null,
  thresholdMnt: number,
  now: Date = new Date()
): NotificationDraft | null {
  if (!POST_ACTIONS.has(event.action) || !POSTABLE_ENTITIES.has(event.entityType)) return null;
  if (amountMnt === null || !Number.isFinite(amountMnt) || thresholdMnt <= 0) return null;
  if (amountMnt < thresholdMnt) return null;
  return draft(
    event,
    now,
    "doc.large_amount",
    `${ENTITY_LABEL[event.entityType]} — том дүн (${Math.round(amountMnt).toLocaleString("en-US")}₮)`,
    { kind: "roles", roles: ["owner", "admin"] },
    {
      severity: "warning",
      dedupeKey: `large:${event.entityType}:${event.entityId}`,
      payload: { action: event.action, amountMnt, thresholdMnt },
    }
  );
}

/**
 * Аудитын үйл явдлыг мэдэгдэл болгоно; мэдэгдэл шаардахгүй бол null.
 * Actor-ыг хасах ажил хүлээн авагчийн шүүлтэд (selectRecipients).
 */
export function notificationFromAudit(
  event: AuditLikeEvent,
  now: Date = new Date()
): NotificationDraft | null {
  const { action, entityType } = event;

  // D4: батлагдсан ноорог → зөвхөн ноорог үүсгэсэн хүнд («таны ноорог
  // батлагдлаа»). create_posted нь ноорог хүлээж байгаагүй тул алгасна.
  if (action === "post" && POSTABLE_ENTITIES.has(entityType))
    return draft(
      event,
      now,
      "doc.posted",
      `${ENTITY_LABEL[entityType]} батлагдлаа`,
      { kind: "entity-owner" }
    );

  // Буцаалт нь ховор бөгөөд чухал — модулийн батлах эрхтэй бүх гишүүнд.
  if (REVERSE_ACTIONS.has(action) && REVERSIBLE_ENTITIES.has(entityType)) {
    const audience = moduleAudience(entityType, "post");
    if (!audience) return null;
    return draft(
      event,
      now,
      "doc.reversed",
      `${ENTITY_LABEL[entityType] ?? "Баримт"} буцаагдлаа`,
      audience,
      { severity: "warning" }
    );
  }

  if (entityType === "purchase_order" && action === "approve")
    return draft(event, now, "po.approved", "Захиалга батлагдлаа", {
      kind: "module",
      moduleKeys: ["proc"],
      minLevel: "read",
    });
  if (entityType === "purchase_order" && action === "close")
    return draft(event, now, "po.closed", "Захиалга хаагдлаа", {
      kind: "module",
      moduleKeys: ["proc"],
      minLevel: "read",
    });
  if (entityType === "goods_receipt" && action === "confirm")
    return draft(event, now, "gr.confirmed", "Хүлээн авалт батлагдлаа", {
      kind: "module",
      moduleKeys: ["proc"],
      minLevel: "read",
    });

  // D5: тайлант үеийн хаалт/нээлт бүх гишүүнд (02-period-close.md §8.3).
  if (entityType === "period" && action === "close")
    return draft(
      event,
      now,
      "period.closed",
      `${event.entityId} тайлант үе хаагдлаа`,
      { kind: "everyone" }
    );
  if (entityType === "period" && action === "reopen")
    return draft(
      event,
      now,
      "period.reopened",
      `${event.entityId} тайлант үе дахин нээгдлээ`,
      { kind: "everyone" },
      { severity: "warning" }
    );

  if (entityType === "payroll" && action === "create_voucher")
    return draft(
      event,
      now,
      "payroll.voucher_created",
      "Цалингийн журнал (ноорог) үүслээ",
      { kind: "module", moduleKeys: ["payroll"], minLevel: "post" }
    );

  if (entityType === "membership" && action === "permissions")
    return draft(
      event,
      now,
      "member.role_changed",
      "Таны модулийн эрх өөрчлөгдлөө",
      { kind: "entity-owner" }
    );

  return null;
}

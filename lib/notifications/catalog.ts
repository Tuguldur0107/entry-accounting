// Мэдэгдлийн КАТАЛОГ — төрөл бүрийн категори, default severity, монгол шошго,
// default суваг. ЦЭВЭР модуль (client-safe): UI, тохиргооны хуудас, rules,
// scheduler бүгд эндээс уншина. Дизайн: docs/notifications/00-proposal.md §3.
//
// Батлагдсан шийдвэрүүд (D1–D7, 2026-09-19):
//   D1 — и-мэйл default: ⚑ (хугацаа, аюулгүй байдал, хаалт) instant, бусад digest
//   D4 — doc.posted зөвхөн ноорог үүсгэсэн хүнд («таны ноорог батлагдлаа»);
//        бүх посттой мэдэгдлийг хийхгүй (exception-first)
//   D5 — period.closed/reopened БҮХ гишүүнд (viewer-т ч)

export type NotificationSeverity = "info" | "warning" | "danger";

export type NotificationCategory =
  | "documents"
  | "deadlines"
  | "close"
  | "team"
  | "security"
  | "procurement";

export type EmailMode = "off" | "instant" | "digest";

export interface NotificationTypeDef {
  category: NotificationCategory;
  severity: NotificationSeverity;
  /** Тохиргооны хуудас, каталогийн шошго. */
  label: string;
  /** Фаз 1 — и-мэйлийн default горим (тохиргоогоор дарагдана). */
  email: EmailMode;
  /** In-app default (тохиргоогоор дарагдана). */
  inApp: boolean;
}

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> =
  {
    documents: "Баримт",
    deadlines: "Хугацаа",
    close: "Сар хаалт",
    team: "Хамт олон",
    security: "Аюулгүй байдал",
    procurement: "Хангамж",
  };

export const NOTIFICATION_CATALOG = {
  // ── Үйл явдал (audit_events гүүр) ──────────────────────────────────────────
  "doc.posted": {
    category: "documents",
    severity: "info",
    label: "Миний ноорог батлагдлаа",
    email: "digest",
    inApp: true,
  },
  "doc.reversed": {
    category: "documents",
    severity: "warning",
    label: "Баримт буцаагдлаа",
    email: "digest",
    inApp: true,
  },
  "po.approved": {
    category: "procurement",
    severity: "info",
    label: "Захиалга батлагдлаа",
    email: "digest",
    inApp: true,
  },
  "po.closed": {
    category: "procurement",
    severity: "info",
    label: "Захиалга хаагдлаа",
    email: "digest",
    inApp: true,
  },
  "gr.confirmed": {
    category: "procurement",
    severity: "info",
    label: "Хүлээн авалт батлагдлаа",
    email: "digest",
    inApp: true,
  },
  "period.closed": {
    category: "close",
    severity: "info",
    label: "Тайлант үе хаагдлаа",
    email: "instant",
    inApp: true,
  },
  "period.reopened": {
    category: "close",
    severity: "warning",
    label: "Тайлант үе дахин нээгдлээ",
    email: "instant",
    inApp: true,
  },
  "payroll.voucher_created": {
    category: "documents",
    severity: "info",
    label: "Цалингийн журнал үүслээ",
    email: "digest",
    inApp: true,
  },
  "member.role_changed": {
    category: "team",
    severity: "info",
    label: "Миний эрх өөрчлөгдлөө",
    email: "instant",
    inApp: true,
  },
  "doc.large_amount": {
    category: "documents",
    severity: "warning",
    label: "Том дүнтэй бичилт батлагдлаа",
    email: "instant",
    inApp: true,
  },
  "ai.drafts_created": {
    category: "documents",
    severity: "info",
    label: "AI ноорог үүсгэлээ — шалгана уу",
    email: "digest",
    inApp: true,
  },
  "invoice.viewed": {
    category: "documents",
    severity: "info",
    label: "Харилцагч нэхэмжлэх үзлээ",
    email: "digest",
    inApp: true,
  },
  // ── Хуваарьт (өдөр бүр 08:00 Улаанбаатар) ─────────────────────────────────
  "tax.deadline": {
    category: "deadlines",
    severity: "warning",
    label: "Татварын хугацаа ойртлоо",
    email: "instant",
    inApp: true,
  },
  "tax.overdue": {
    category: "deadlines",
    severity: "danger",
    label: "Татварын хугацаа хэтэрлээ",
    email: "instant",
    inApp: true,
  },
  "arap.overdue": {
    category: "deadlines",
    severity: "warning",
    label: "Авлага / өглөгийн хугацаа хэтэрсэн",
    email: "digest",
    inApp: true,
  },
  "drafts.stale": {
    category: "documents",
    severity: "warning",
    label: "Хуучирсан ноорог",
    email: "digest",
    inApp: true,
  },
  "close.due": {
    category: "close",
    severity: "info",
    label: "Сар хаалт хийх цаг боллоо",
    email: "digest",
    inApp: true,
  },
  "bank.unmatched": {
    category: "documents",
    severity: "warning",
    label: "Тулгагдаагүй банкны мөр",
    email: "digest",
    inApp: true,
  },
  "fx.reval_due": {
    category: "close",
    severity: "info",
    label: "Ханшийн тэгшитгэл хийх цаг боллоо",
    email: "digest",
    inApp: true,
  },
  "fx.rate_missing": {
    category: "close",
    severity: "warning",
    label: "Өнөөдрийн ханш татагдаагүй",
    email: "digest",
    inApp: true,
  },
  "stock.negative": {
    category: "documents",
    severity: "danger",
    label: "Хасах үлдэгдэлтэй бараа",
    email: "digest",
    inApp: true,
  },
  "pos.ebarimt_failed": {
    category: "documents",
    severity: "danger",
    label: "eBarimt илгээгдсэнгүй",
    email: "instant",
    inApp: true,
  },
  "license.expiring": {
    category: "security",
    severity: "warning",
    label: "Лиценз дуусах гэж байна",
    email: "instant",
    inApp: true,
  },
  "token.expiring": {
    category: "security",
    severity: "info",
    label: "API token дуусах гэж байна",
    email: "digest",
    inApp: true,
  },
  // AI-ийн шууд батлах хязгаар өөрчлөгдсөн — эзэн/админд ЯГ ОДОО мэдэгдэнэ
  // (агент өөрөө өсгөсөн бол хүн тэр даруй харна, lib/ai/post-limit.ts).
  "settings.ai_limit_changed": {
    category: "security",
    severity: "warning",
    label: "AI-ийн батлах хязгаар өөрчлөгдлөө",
    email: "instant",
    inApp: true,
  },
} as const satisfies Record<string, NotificationTypeDef>;

export type NotificationType = keyof typeof NOTIFICATION_CATALOG;

export const NOTIFICATION_TYPES = Object.keys(
  NOTIFICATION_CATALOG
) as NotificationType[];

export function isNotificationType(value: string): value is NotificationType {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_CATALOG, value);
}

export function notificationTypeDef(type: NotificationType): NotificationTypeDef {
  return NOTIFICATION_CATALOG[type];
}

/** Танигдахгүй төрлийг (хуучин мөр, custom/) fail-safe шошголно. */
export function notificationTypeLabel(type: string): string {
  return isNotificationType(type) ? NOTIFICATION_CATALOG[type].label : type;
}

export function notificationCategoryLabel(category: string): string {
  return (
    (NOTIFICATION_CATEGORY_LABELS as Record<string, string>)[category] ?? category
  );
}

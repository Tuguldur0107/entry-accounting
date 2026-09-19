// «Анхаарах шаардлагатай» дохионууд — ЦЭВЭР (тесттэй), НЭГ ЭХ СУРВАЛЖ.
//
// Нүүрний самбар (app/(dashboard)/page.tsx) ба өдөр тутмын мэдэгдлийн
// scheduler (lib/notifications/scheduler.ts) хоёул ЭНЭ функцээс уншина —
// «хугацаа хэтэрсэн», «хуучирсан ноорог», «хугацаа ойртлоо» гэдгийн
// тодорхойлолт хоёр газар зөрөхгүй. Дохио бүр аль гадаргуу дээр харагдахаа
// (surfaces) өөрөө хэлнэ; мэдэгдэл болох дохио `notify` хэсэгтэй.
//
// Хатуу дүрэм: дүн, дугаар ЗОХИОХГҮЙ — оролтод ирснийг л уншина.

import type { TaxDeadline, TaxDeadlineKey } from "@/lib/tax/calendar";

import type { NotificationSeverity, NotificationType } from "./catalog";
import type { NotificationAudience, NotificationDraft } from "./types";

export type AttentionTone = "default" | "warning" | "danger";
export type AttentionSurface = "dashboard" | "daily";

export type DraftModule = "journal" | "arap" | "cash" | "inventory" | "fa";

export interface DraftSummary {
  module: DraftModule;
  count: number;
  /** Зөвхөн журналд — Дт ≠ Кт ноорог. */
  unbalanced?: number;
  /** Хамгийн эртний ноорогийн огноо (YYYY-MM-DD) — хуучрал шалгахад. */
  oldestDate?: string | null;
}

export interface AttentionInput {
  /** Улаанбаатарын өнөөдөр. */
  today: string;
  /** Самбарын сонгосон (эсвэл одоогийн) сар. */
  periodCode: string;
  periodStatus: "open" | "closed" | "missing";
  drafts: DraftSummary[];
  arOverdue: number;
  apOverdue: number;
  /** computeTaxDeadlines(today). */
  taxDeadlines: TaxDeadline[];
  /** Системд бий externalRef marker-ууд: vat-settlement:YYYY-MM, payroll:YYYY-MM. */
  preparedMarkers: string[];
  /** Өмнөх сар — сар хаалтын сануулгад. */
  previousPeriod?: {
    code: string;
    status: "open" | "closed" | "missing";
    /** Тэр сард батлагдсан бичилт бий эсэх (хоосон сарыг хаах шаардлагагүй). */
    hasActivity: boolean;
  };
  /** deploymentLicenseStatus().expiresAt (YYYY-MM-DD) — байхгүй бол null. */
  licenseExpiresAt?: string | null;
  /** Хугацаатай API token-ууд (expiresAt YYYY-MM-DD). */
  tokens?: { id: string; name: string; userId: string; expiresAt: string }[];
}

export interface AttentionSignal {
  key: string;
  tone: AttentionTone;
  title: string;
  detail: string;
  href: string;
  action: string;
  surfaces: AttentionSurface[];
  /** Байвал өдөр тутмын scheduler мэдэгдэл болгоно. */
  notify?: {
    type: NotificationType;
    dedupeKey: string;
    audience: NotificationAudience;
    severity?: NotificationSeverity;
    entityType?: string;
    entityId?: string;
    payload?: Record<string, unknown>;
  };
}

/** Ноорог энэ хоногоос дээш хүлээгдвэл «хуучирсан». */
export const STALE_DRAFT_DAYS = 7;
/** Татварын хугацааны сануулгын шат (үлдсэн хоног). */
export const TAX_ALERT_BUCKETS = [7, 3, 1, 0] as const;
/** Лицензийн сануулгын шат. */
export const LICENSE_ALERT_BUCKETS = [30, 7, 1, 0] as const;
/** API token дуусахаас өмнөх сануулгын хоног. */
export const TOKEN_ALERT_DAYS = 7;
/** Сарын хэд хүртэл «өмнөх сараа хаа» гэж сануулах вэ. */
export const CLOSE_DUE_DAY_LIMIT = 5;
/** Хугацаа хэтэрсэн татварыг хэдэн хоног сануулах вэ (нэг удаа, dedupe). */
export const TAX_OVERDUE_WINDOW_DAYS = 20;

const DRAFT_LABEL: Record<DraftModule, { title: string; href: string; action: string }> = {
  journal: { title: "ноорог журнал", href: "/gl/journal", action: "Журнал руу" },
  arap: { title: "ноорог АР/АП баримт", href: "/receivables/documents", action: "Харах" },
  cash: { title: "ноорог кассын баримт", href: "/cash/transactions", action: "Касс руу" },
  inventory: {
    title: "ноорог барааны хөдөлгөөн",
    href: "/inventory/movements",
    action: "Хөдөлгөөн руу",
  },
  fa: { title: "ноорог хөрөнгийн карт", href: "/fa/assets", action: "Хөрөнгө рүү" },
};

const DRAFT_MODULE_KEYS: Record<DraftModule, string[]> = {
  journal: ["gl"],
  arap: ["ar", "ap"],
  cash: ["cash"],
  inventory: ["inv"],
  fa: ["fa"],
};

/** Татварын түлхүүр → тохиргооны модуль (эрхээр шүүхэд). */
const TAX_MODULE_KEYS: Record<TaxDeadlineKey, string[]> = {
  vat: ["tax"],
  cit: ["tax"],
  si: ["payroll", "tax"],
  pit: ["payroll", "tax"],
};

const TAX_HREF: Record<TaxDeadlineKey, (period: string) => string> = {
  vat: (period) => `/tax/vat?period=${period}`,
  cit: () => "/tax/cit",
  si: () => "/payroll",
  pit: () => "/payroll",
};

// ── Огнооны туслахууд (UTC, цагийн бүсээс хамаарахгүй) ─────────────────────

function utcMs(date: string) {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10))
  );
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000);
}

/** ISO долоо хоногийн түлхүүр — "2026-W38". Долоо хоног тутмын dedupe-д. */
export function isoWeekKey(date: string): string {
  const d = new Date(utcMs(date));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Үлдсэн хоног аль шатанд байна вэ (хамгийн ойрын шат) — өдөр алгасагдсан ч
 *  дараагийн ажиллалт тухайн шатыг барина; null бол шатнаас гадна. */
export function alertBucket(daysLeft: number, buckets: readonly number[]): number | null {
  if (daysLeft < 0) return null;
  const sorted = [...buckets].sort((a, b) => a - b);
  for (const bucket of sorted) if (daysLeft <= bucket) return bucket;
  return null;
}

/** Татварын «тайлан бэлтгэгдсэн» marker (externalRef) — vat/pit/si-д л бий. */
export function taxPreparedMarker(key: TaxDeadlineKey, period: string): string | null {
  if (key === "vat") return `vat-settlement:${period}`;
  if (key === "pit" || key === "si") return `payroll:${period}`;
  return null;
}

/**
 * Хугацаа нь ӨНГӨРСӨН сарын татварууд (computeTaxDeadlines зөвхөн ойрынхыг
 * өгдөг тул энд урвуугаар): энэ сарын D-ний өдөр өнгөрсөн бол тэр хугацаа
 * = өмнөх сарын тайлан. Цонх TAX_OVERDUE_WINDOW_DAYS.
 */
export function overdueTaxDeadlines(
  today: string
): { key: TaxDeadlineKey; label: string; period: string; dueDate: string; daysOver: number }[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const monthly: { key: TaxDeadlineKey; label: string; day: number }[] = [
    { key: "si", label: "НДШ", day: 5 },
    { key: "vat", label: "НӨАТ", day: 10 },
    { key: "pit", label: "ХАОАТ", day: 10 },
  ];
  const out = [];
  for (const tax of monthly) {
    const dueDate = `${today.slice(0, 7)}-${String(tax.day).padStart(2, "0")}`;
    const daysOver = daysBetween(dueDate, today);
    if (daysOver > 0 && daysOver <= TAX_OVERDUE_WINDOW_DAYS)
      out.push({ key: tax.key, label: tax.label, period: prev, dueDate, daysOver });
  }
  return out;
}

// ── Дохионууд ────────────────────────────────────────────────────────────────

export function attentionSignals(input: AttentionInput): AttentionSignal[] {
  const signals: AttentionSignal[] = [];
  const { today } = input;
  const week = isoWeekKey(today);
  const markers = new Set(input.preparedMarkers);

  const journal = input.drafts.find((d) => d.module === "journal");
  const unbalanced = journal?.unbalanced ?? 0;
  const draftCount = journal?.count ?? 0;

  /* ── Самбарын дохионууд (одоогийн 8 дүрэм — өөрчлөлтгүй) ────────────────── */
  if (unbalanced > 0)
    signals.push({
      key: "gl-unbalanced",
      tone: "danger",
      title: `${unbalanced} ноорог журнал тэнцэхгүй`,
      detail: "Дебет ≠ Кредит — бичихээс өмнө засна.",
      href: "/gl/journal",
      action: "Журнал руу",
      surfaces: ["dashboard"],
    });
  if (draftCount > 0)
    signals.push({
      key: "gl-drafts",
      tone: "warning",
      title: `${draftCount} ноорог журнал хүлээгдэж байна`,
      detail: "Ноорог нь тайланд ороогүй — шалгаад бичнэ.",
      href: "/gl/journal",
      action: "Журнал руу",
      surfaces: ["dashboard"],
    });
  if (input.periodStatus === "missing")
    signals.push({
      key: "period-missing",
      tone: "warning",
      title: `${input.periodCode} тайлант үе үүсээгүй`,
      detail: "Тайлант үе үүсгэвэл хаалт, бичилтийн хяналт бүрэн ажиллана.",
      href: "/settings/periods",
      action: "Тайлант үе рүү",
      surfaces: ["dashboard"],
    });
  if (input.periodStatus === "closed")
    signals.push({
      key: "period-closed",
      tone: "default",
      title: `${input.periodCode} тайлант үе хаагдсан`,
      detail: "Хаагдсан тайлант үед шинэ бичилт хийхгүй.",
      href: "/settings/periods",
      action: "Тайлант үе рүү",
      surfaces: ["dashboard"],
    });
  if (input.arOverdue > 0)
    signals.push({
      key: "ar-overdue",
      tone: "warning",
      title: `${input.arOverdue} авлагын хугацаа хэтэрсэн`,
      detail: "Төлөгдөх хугацаа өнгөрсөн нэхэмжлэл.",
      href: "/receivables/documents",
      action: "Авлага руу",
      surfaces: ["dashboard", "daily"],
      notify: {
        type: "arap.overdue",
        // Хэтэрсэн ӨДӨР нэг удаа + долоо хоног тутам (dedupe = ISO долоо хоног).
        dedupeKey: `overdue:ar:${week}`,
        audience: { kind: "module", moduleKeys: ["ar"], minLevel: "read" },
        payload: { count: input.arOverdue, side: "ar" },
      },
    });
  if (input.apOverdue > 0)
    signals.push({
      key: "ap-overdue",
      tone: "warning",
      title: `${input.apOverdue} өглөгийн хугацаа хэтэрсэн`,
      detail: "Төлөх хугацаа өнгөрсөн нэхэмжлэх.",
      href: "/payables/documents",
      action: "Өглөг руу",
      surfaces: ["dashboard", "daily"],
      notify: {
        type: "arap.overdue",
        dedupeKey: `overdue:ap:${week}`,
        audience: { kind: "module", moduleKeys: ["ap"], minLevel: "read" },
        payload: { count: input.apOverdue, side: "ap" },
      },
    });
  for (const draftModule of ["arap", "inventory"] as const) {
    const summary = input.drafts.find((d) => d.module === draftModule);
    if (!summary || summary.count <= 0) continue;
    const label = DRAFT_LABEL[draftModule];
    signals.push({
      key: `${draftModule}-drafts`,
      tone: "default",
      title: `${summary.count} ${label.title}`,
      detail:
        draftModule === "arap"
          ? "Авлага/өглөгийн ноорог документ."
          : "Бичигдээгүй хөдөлгөөн өртөгт ороогүй.",
      href: label.href,
      action: label.action,
      surfaces: ["dashboard"],
    });
  }

  /* ── Хуваарьт дохионууд (өдөр бүр) ──────────────────────────────────────── */

  // Хуучирсан ноорог — модуль бүрд, долоо хоног тутам (батлах эрхтэй хүнд).
  for (const summary of input.drafts) {
    if (summary.count <= 0 || !summary.oldestDate) continue;
    const age = daysBetween(summary.oldestDate, today);
    if (age < STALE_DRAFT_DAYS) continue;
    const label = DRAFT_LABEL[summary.module];
    signals.push({
      key: `stale-${summary.module}`,
      tone: "warning",
      title: `${summary.count} ${label.title} ${STALE_DRAFT_DAYS}+ хоног хүлээгдэж байна`,
      detail: `Хамгийн эртнийх ${summary.oldestDate} (${age} хоног). Батлах эсвэл устгана.`,
      href: label.href,
      action: label.action,
      surfaces: ["daily"],
      notify: {
        type: "drafts.stale",
        dedupeKey: `stale:${summary.module}:${week}`,
        audience: {
          kind: "module",
          moduleKeys: DRAFT_MODULE_KEYS[summary.module],
          minLevel: "post",
        },
        payload: { module: summary.module, count: summary.count, oldestDate: summary.oldestDate },
      },
    });
  }

  // Татварын хугацаа — 7/3/1/0 хоногийн шатанд, шат бүрд нэг удаа.
  for (const deadline of input.taxDeadlines) {
    const bucket = alertBucket(deadline.daysLeft, TAX_ALERT_BUCKETS);
    if (bucket === null) continue;
    const marker = taxPreparedMarker(deadline.key, deadline.period);
    const prepared = marker ? markers.has(marker) : null;
    const when =
      deadline.daysLeft === 0
        ? "ӨНӨӨДӨР дуусна"
        : `${deadline.daysLeft} хоног үлдлээ`;
    signals.push({
      key: `tax-${deadline.key}-${deadline.period}`,
      tone: prepared ? "default" : bucket <= 1 ? "danger" : "warning",
      title: `${deadline.label} (${deadline.period}) — ${when}`,
      detail:
        prepared === false
          ? `Тооцооны журнал үүсээгүй. Тайлан, төлбөрийг ${deadline.dueDate}-ны дотор.`
          : prepared
            ? `Тооцооны ноорог бэлэн — батлаад ${deadline.dueDate}-ны дотор төлнө.`
            : `Тайлан, төлбөрийг ${deadline.dueDate}-ны дотор.`,
      href: TAX_HREF[deadline.key](deadline.period),
      action: "Татвар руу",
      surfaces: ["daily"],
      notify: {
        type: "tax.deadline",
        dedupeKey: `tax:${deadline.key}:${deadline.period}:${bucket}`,
        audience: { kind: "module", moduleKeys: TAX_MODULE_KEYS[deadline.key], minLevel: "write" },
        severity: prepared ? "info" : bucket <= 1 ? "danger" : "warning",
        payload: { key: deadline.key, period: deadline.period, dueDate: deadline.dueDate, daysLeft: deadline.daysLeft, prepared },
      },
    });
  }

  // Хугацаа хэтэрсэн татвар — marker байхгүй бол (vat/pit/si), нэг удаа.
  for (const overdue of overdueTaxDeadlines(today)) {
    const marker = taxPreparedMarker(overdue.key, overdue.period);
    if (!marker || markers.has(marker)) continue;
    signals.push({
      key: `tax-overdue-${overdue.key}-${overdue.period}`,
      tone: "danger",
      title: `${overdue.label} (${overdue.period}) — хугацаа ${overdue.daysOver} хоног хэтэрлээ`,
      detail: `${overdue.dueDate}-ны хугацаа өнгөрсөн, тооцооны журнал үүсээгүй. Хоцролтод 0.1%/хоног алданги.`,
      href: TAX_HREF[overdue.key](overdue.period),
      action: "Татвар руу",
      surfaces: ["daily"],
      notify: {
        type: "tax.overdue",
        dedupeKey: `tax-overdue:${overdue.key}:${overdue.period}`,
        audience: { kind: "module", moduleKeys: TAX_MODULE_KEYS[overdue.key], minLevel: "post" },
        severity: "danger",
        payload: { key: overdue.key, period: overdue.period, dueDate: overdue.dueDate },
      },
    });
  }

  // Сар хаалт — сарын 1–5-нд өмнөх сар хаагдаагүй, бичилттэй бол.
  const dayOfMonth = Number(today.slice(8, 10));
  const prev = input.previousPeriod;
  if (
    prev &&
    dayOfMonth <= CLOSE_DUE_DAY_LIMIT &&
    prev.status !== "closed" &&
    prev.hasActivity
  )
    signals.push({
      key: `close-due-${prev.code}`,
      tone: "default",
      title: `${prev.code} сарын хаалт хийх цаг боллоо`,
      detail: "Элэгдэл, ханшийн тэгшитгэл, өртөг, НӨАТ, ноорог — сар хаалтын wizard-аар.",
      href: `/close?period=${prev.code}`,
      action: "Сар хаалт руу",
      surfaces: ["daily"],
      notify: {
        type: "close.due",
        dedupeKey: `close-due:${prev.code}`,
        audience: { kind: "module", moduleKeys: ["gl"], minLevel: "post" },
        entityType: "period",
        entityId: prev.code,
      },
    });

  // Лиценз — 30/7/1/0 хоногийн шат, эзэн/админд.
  if (input.licenseExpiresAt) {
    const daysLeft = daysBetween(today, input.licenseExpiresAt);
    const bucket = alertBucket(daysLeft, LICENSE_ALERT_BUCKETS);
    if (bucket !== null)
      signals.push({
        key: "license-expiring",
        tone: bucket <= 7 ? "danger" : "warning",
        title:
          daysLeft === 0
            ? "Лиценз ӨНӨӨДӨР дуусна"
            : `Лиценз ${daysLeft} хоногийн дараа дуусна`,
        detail: `Хүчинтэй хугацаа ${input.licenseExpiresAt}. Дуусвал нэвтрэлт таслагдана — Entry Console-оос сунгана.`,
        href: "/settings/system",
        action: "Систем рүү",
        surfaces: ["daily"],
        notify: {
          type: "license.expiring",
          dedupeKey: `license:${input.licenseExpiresAt}:${bucket}`,
          audience: { kind: "roles", roles: ["owner", "admin"] },
          severity: bucket <= 7 ? "danger" : "warning",
          payload: { expiresAt: input.licenseExpiresAt, daysLeft },
        },
      });
  }

  // API token — эзэнд нь, дуусахаас 7 хоногийн өмнөөс нэг удаа.
  for (const token of input.tokens ?? []) {
    const daysLeft = daysBetween(today, token.expiresAt);
    if (daysLeft < 0 || daysLeft > TOKEN_ALERT_DAYS) continue;
    signals.push({
      key: `token-${token.id}`,
      tone: "default",
      title: `API token «${token.name}» ${daysLeft === 0 ? "өнөөдөр" : `${daysLeft} хоногийн дараа`} дуусна`,
      detail: "MCP / REST холболт таслагдахаас өмнө шинэ token үүсгэнэ.",
      href: "/ai/settings",
      action: "MCP холболт руу",
      surfaces: ["daily"],
      notify: {
        type: "token.expiring",
        dedupeKey: `token:${token.id}`,
        audience: { kind: "users", userIds: [token.userId] },
        payload: { tokenId: token.id, expiresAt: token.expiresAt },
      },
    });
  }

  return signals;
}

/** Самбарын «Анхаарах» блокт харагдах дохионууд. */
export function dashboardAlerts(input: AttentionInput): AttentionSignal[] {
  return attentionSignals(input).filter((s) => s.surfaces.includes("dashboard"));
}

/** Өдөр тутмын scheduler-ийн бичих мэдэгдлүүд. */
export function dailyNotificationDrafts(input: AttentionInput): NotificationDraft[] {
  return attentionSignals(input)
    .filter((s) => s.surfaces.includes("daily") && s.notify)
    .map((s) => ({
      type: s.notify!.type,
      severity: s.notify!.severity,
      title: s.title,
      body: s.detail,
      href: s.href,
      entityType: s.notify!.entityType,
      entityId: s.notify!.entityId,
      payload: s.notify!.payload,
      dedupeKey: s.notify!.dedupeKey,
      audience: s.notify!.audience,
    }));
}

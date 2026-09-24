// Баримтын ТӨЛВИЙН нэгдсэн эх сурвалж — client-safe, ЦЭВЭР (tests/status.test.ts).
//
// UI гайдын карт 1 / ENT-016: журналын жагсаалтад ноорог ба батлагдсан
// ялгагдахгүй, модуль бүр өөр өнгө/нэр хэрэглэдэг байв. Төлөв бүр ӨНГӨ
// (tone) + ДҮРС (icon) + ХЭЛБЭР (shape) гурваараа ялгарна — өнгө ялгадаггүй
// хүн ч хэлбэрээр нь таньна: батлагдсан = дүүрэн, ноорог = тасархай хүрээтэй
// хөндий, буцаагдсан = зураастай.

import type { IconName } from "@/components/ui/icon-registry";

export type StatusTone = "success" | "danger" | "warning" | "muted" | "reversed";
export type StatusShape = "solid" | "dashed" | "struck";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  icon: IconName;
  shape: StatusShape;
}

const POSTED: StatusMeta = { label: "Батлагдсан", tone: "success", icon: "success", shape: "solid" };
const DRAFT: StatusMeta = { label: "Ноорог", tone: "muted", icon: "edit", shape: "dashed" };
const REVERSED: StatusMeta = { label: "Буцаагдсан", tone: "reversed", icon: "undo", shape: "struck" };

/** Баримтын төлөв → харагдах байдал (журнал, АР/АП, касс, бараа, PO). */
export const DOCUMENT_STATUS: Record<string, StatusMeta> = {
  posted: POSTED,
  confirmed: { ...POSTED, label: "Баталгаажсан" },
  draft: DRAFT,
  reversed: REVERSED,
  cancelled: { label: "Цуцлагдсан", tone: "muted", icon: "cancel", shape: "struck" },
  overdue: { label: "Хэтэрсэн", tone: "danger", icon: "warning", shape: "solid" },
  partially_paid: { label: "Хэсэгчлэн төлсөн", tone: "warning", icon: "pending", shape: "solid" },
  paid: { label: "Төлөгдсөн", tone: "success", icon: "success", shape: "solid" },
  open: { label: "Нээлттэй", tone: "warning", icon: "unlocked", shape: "solid" },
  closed: { label: "Хаагдсан", tone: "success", icon: "locked", shape: "solid" },
  // POS борлуулалт (lib/pos/constants SALE_STATUS_LABELS-тэй ИЖИЛ нэр)
  partially_returned: { label: "Хэсэгчлэн буцаасан", tone: "warning", icon: "undo", shape: "solid" },
  returned: { ...REVERSED, label: "Буцаасан" },
  voided: { label: "Цуцалсан", tone: "muted", icon: "cancel", shape: "struck" },
};

/** Үл мэдэгдэх төлөвт ч хоосон биш, уншигдахуйц badge. */
export function statusMeta(status: string | null | undefined): StatusMeta {
  return (
    DOCUMENT_STATUS[status ?? ""] ?? {
      label: status || "—",
      tone: "muted",
      icon: "info",
      shape: "solid",
    }
  );
}

/** Жагсаалтын «Батлагдсан 84 · Ноорог 12 · Буцаагдсан 3» тоолол (гарал дараалалтай). */
export function countByStatus<T>(rows: T[], statusOf: (row: T) => string): { status: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = statusOf(row);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const order = Object.keys(DOCUMENT_STATUS);
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => {
      const ai = order.indexOf(a.status);
      const bi = order.indexOf(b.status);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
}

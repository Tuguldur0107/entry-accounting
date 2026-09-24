// Тайлангийн НЭГДСЭН жааз — БҮХ тайлан ижил дараалал, ижил байрлалтай.
//
// Урьд нь тайлан бүр өөрийн толгой, завсар (gap-3/4/5), хоосон төлөв,
// шүүлтүүрийн байрлалтай байсан тул хэрэглэгч тайлан бүрд «хаана юу байна»
// гэж дахин хайдаг байв. Одоо ДЭЭРЭЭС ДООШ тогтмол:
//
//   ┌ ReportHeader ─────────────────────────────────────────────┐
//   │ Гарчиг                                    [Excel] [үйлдэл] │
//   │ муж · тайлбар                                              │
//   ├ ReportToolbar ────────────────────────────────────────────┤
//   │ views:   НЭГ тайлангийн зүсэлт (Бараагаар / Өдрөөр …)       │
//   │ filters: нэмэлт шүүлтүүр (агуулах, кассчин, төлөв …)        │
//   └ хүснэгт / ReportEmpty ────────────────────────────────────┘
//
// Хатуу дүрмүүд (CLAUDE.md «Тайлангийн стандарт»):
//   - ӨӨР тайлан руу шилжих нь ЗӨВХӨН топбарын сонгогчоор
//     (lib/constants/report-registry.ts). `views` нь нэг тайлангийн зүсэлт л.
//   - Огнооны муж нь ЗӨВХӨН топбарын периодоос — тайлан дотор огнооны
//     талбар / «Шинэчлэх» товч тавихгүй. `meta`-д мужийг л харуулна.
//   - Хоосон төлөв нь `ReportEmpty` (EmptyState) — өөрийн div бичихгүй.
//
// «use client»-гүй — server page ба client view хоёулаа хэрэглэнэ.

import type { ReactNode } from "react";

import { EmptyState, type EmptyStateAction } from "@/components/ui/empty-state";
import type { IconName } from "@/components/ui/icon";

/** Тайлангийн хуудасны гадна жааз — завсар нэг хэмжээтэй. */
export function ReportPage({ children }: { children: ReactNode }) {
  return <section className="flex min-h-0 flex-1 flex-col gap-4">{children}</section>;
}

/** Гарчиг + муж/тайлбар (зүүн) + үйлдлүүд (баруун). */
export function ReportHeader({
  title,
  meta,
  actions,
}: {
  title: ReactNode;
  /** Мужийн мөр — `reportRangeLabel(from, to)` + товч тайлбар. */
  meta?: ReactNode;
  /** Excel татах, хэвлэх г.м. — баруун талд, нэг мөрөнд. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">{title}</h1>
        {meta ? (
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">{meta}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * Тайлангийн хэрэгслийн мөр: эхлээд `views` (нэг тайлангийн зүсэлт —
 * PageTabs / FilterChips), дараа нь `filters` (FormField-тэй сонголтууд).
 * Аль нэг нь байхгүй бол тэр мөр гарахгүй.
 */
export function ReportToolbar({
  views,
  filters,
}: {
  views?: ReactNode;
  filters?: ReactNode;
}) {
  if (!views && !filters) return null;
  return (
    <div className="flex flex-col gap-3">
      {views ? <div className="min-w-0">{views}</div> : null}
      {filters ? (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">{filters}</div>
      ) : null}
    </div>
  );
}

/** Тайлангийн хоосон төлөв — бүх тайланд ИЖИЛ харагдана. */
export function ReportEmpty({
  icon = "document",
  title,
  description,
  actions,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  actions?: EmptyStateAction[];
}) {
  return (
    <EmptyState icon={icon} title={title} description={description} actions={actions} />
  );
}

/** Мужийн шошго — бүх тайланд ижил формат: «2026-09-01 — 2026-09-30». */
export function reportRangeLabel(from: string, to: string): string {
  return from === to ? from : `${from} — ${to}`;
}

// Зардлын хуваарилалт — НЭГ нав цэс дор 2 таб.
//   • PO-ийн зардал — захиалгатай нэхэмжлэхийн бүрэлдэхүүнтэй мөрийн worklist
//   • Чөлөөт хуваарилалт — PO-гүй (жижиг худалдан авалтын) зардал
// Хоёулаа ижил суурь (үнийн дүн / тоо хэмжээ / гараар) сонгож `landed_cost`
// ноорог бичилт үүсгэдэг — ялгаа нь зөвхөн эх сурвалж.

import { Suspense, type ReactNode } from "react";

import { CostingSectionTabs } from "@/components/costing/costing-section-tabs";

const TABS = [
  { href: "/costing/allocations", label: "PO-ийн зардал" },
  { href: "/costing/allocations/manual", label: "Чөлөөт хуваарилалт" },
] as const;

export default function CostAllocationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* CostingSectionTabs нь useSearchParams ашигладаг — Suspense заавал. */}
      <Suspense fallback={<div className="h-8" />}>
        <CostingSectionTabs tabs={TABS} ariaLabel="Зардлын хуваарилалт" />
      </Suspense>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

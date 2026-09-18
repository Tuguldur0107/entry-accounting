// Өртгийн тайлангийн хэсэг — НЭГ нав цэс дор 4 таб.
// Таб бүр өөрийн route (өгөгдөл нь зөвхөн тэр хуудсанд ачаалагдана);
// энэ layout зөвхөн гарчиг + табны мөрийг хуваалцана.

import { Suspense, type ReactNode } from "react";

import { CostingSectionTabs } from "@/components/costing/costing-section-tabs";

const TABS = [
  { href: "/costing/reports", label: "Өртгийн хяналт" },
  { href: "/costing/reports/valuation", label: "Үнэлгээ · NRV" },
  { href: "/costing/reports/detail", label: "Гүйлгээний дэлгэрэнгүй" },
  { href: "/costing/reports/components", label: "Бүрэлдэхүүн" },
] as const;

export default function CostingReportsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* CostingSectionTabs нь useSearchParams ашигладаг — Suspense заавал. */}
      <Suspense fallback={<div className="h-8" />}>
        <CostingSectionTabs tabs={TABS} ariaLabel="Өртгийн тайлан" />
      </Suspense>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

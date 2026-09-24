// Өртгийн тайлангууд — 4 тайлан тус бүр ӨӨРИЙН route. Тайлан хооронд
// шилжих нь ЗӨВХӨН топбарын тайлан сонгогчоор (lib/constants/report-registry.ts)
// — хуудас доторх таб БАЙХГҮЙ (тайлангийн стандарт). Гарчиг нь тайлан бүрийн
// ReportHeader-т.

import type { ReactNode } from "react";

export default function CostingReportsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}

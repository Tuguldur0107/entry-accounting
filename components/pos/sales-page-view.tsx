"use client";

// Борлуулалтын жагсаалтын хуудас `/inventory/sales` — огнооны мужийн
// солилтыг URL-д бичих нимгэн client бүрхүүл (SalesListView нь ЦЭВЭР харагдац).
// Ээлж · Бэлгийн карт·кредит · Тохиргоо нь ТУСДАА нав цэс (docs/pos §4.3).

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

import { SalesListView } from "@/components/pos/sales-list-view";
import type { PosSaleView } from "@/lib/pos/types";

export function SalesPageView({
  from,
  to,
  initialStatus,
  sales,
}: {
  from: string;
  to: string;
  initialStatus?: string;
  sales: PosSaleView[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  const changeRange = useCallback(
    (nextFrom: string, nextTo: string) => {
      const params = new URLSearchParams({ from: nextFrom, to: nextTo });
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname]
  );

  return (
    <SalesListView
      key={`${from}|${to}`}
      sales={sales}
      from={from}
      to={to}
      initialStatus={initialStatus}
      onRangeChange={changeRange}
    />
  );
}

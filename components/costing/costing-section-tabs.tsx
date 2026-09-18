"use client";

// Өртгийн модулийн хэсгийн таб — олон route-ыг НЭГ нав цэс дор нэгтгэнэ
// (Тайлан: хяналт / үнэлгээ / гүйлгээ / бүрэлдэхүүн; Хуваарилалт: PO /
// чөлөөт). Таб бүр өөрийн route хэвээр тул өгөгдөл нь зөвхөн тухайн
// хуудсанд ачаалагдана — нэг хуудсанд бүгдийг ачаалж удаашруулахгүй.
//
// ui-kit-ийн PageTabs-ийг л ашиглана (шинэ tab markup бичихийг хориглоно).

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PageTabs } from "@/components/ui/tabs";

export type CostingTab = { href: string; label: string };

export function CostingSectionTabs({
  tabs,
  ariaLabel,
}: {
  tabs: readonly CostingTab[];
  ariaLabel?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Идэвхтэй таб: яг таарсан зам, эс бөгөөс хамгийн урт угтвар (дэд замтай
  // таб эхний табын угтварт баригдахаас сэргийлнэ).
  const active =
    tabs.find((tab) => tab.href === pathname)?.href ??
    [...tabs]
      .sort((a, b) => b.href.length - a.href.length)
      .find((tab) => pathname.startsWith(`${tab.href}/`))?.href ??
    tabs[0]?.href ??
    "";

  return (
    <PageTabs
      size="sm"
      ariaLabel={ariaLabel}
      value={active}
      onChange={(href) => {
        if (href === active) return;
        // Огнооны муж (from/to, period) табуудад нийтлэг тул дагуулж явна —
        // хэрэглэгч сонгосон үеэ таб солих бүрд дахин сонгохгүй.
        const carried = new URLSearchParams();
        for (const key of ["from", "to", "period"]) {
          const value = searchParams.get(key);
          if (value) carried.set(key, value);
        }
        router.push(carried.size ? `${href}?${carried}` : href);
      }}
      tabs={tabs.map((tab) => ({ value: tab.href, label: tab.label }))}
    />
  );
}

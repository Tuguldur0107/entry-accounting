"use client";

// Авлага → eBarimt хуудасны таб: баримтууд | ТЕГ-ийн тулгалт. URL `?view=tax`
// («Анхаарах»-ын холбоос шууд тулгалт руу орно); бусад параметр хадгалагдана.

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PageTabs } from "@/components/ui/tabs";

export type EbarimtPageView = "documents" | "tax";

export function EbarimtViewTabs({ view, problems }: { view: EbarimtPageView; problems: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabs = [
    { value: "documents" as const, label: "eBarimt баримт" },
    { value: "tax" as const, label: problems > 0 ? `ТЕГ-ийн тулгалт · ${problems}` : "ТЕГ-ийн тулгалт" },
  ];
  return (
    <PageTabs
      tabs={tabs}
      value={view}
      onChange={(next) => {
        const params = new URLSearchParams(searchParams.toString());
        if (next === "tax") params.set("view", "tax");
        else params.delete("view");
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname);
      }}
    />
  );
}

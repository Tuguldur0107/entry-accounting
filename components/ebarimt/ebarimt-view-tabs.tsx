"use client";

// Авлага → eBarimt хуудасны таб: баримтууд | ТЕГ-ийн тулгалт | ТЕГ-ийн бүх баримт.
// URL `?view=tax` / `?view=sales` («Анхаарах»-ын холбоос шууд тулгалт руу орно);
// бусад параметр хадгалагдана.

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PageTabs } from "@/components/ui/tabs";

export type EbarimtPageView = "documents" | "tax" | "sales";

export function EbarimtViewTabs({ view, problems }: { view: EbarimtPageView; problems: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabs = [
    { value: "documents" as const, label: "eBarimt баримт" },
    { value: "tax" as const, label: problems > 0 ? `ТЕГ-ийн тулгалт · ${problems}` : "ТЕГ-ийн тулгалт" },
    { value: "sales" as const, label: "ТЕГ-ийн бүх баримт" },
  ];
  return (
    <PageTabs
      tabs={tabs}
      value={view}
      onChange={(next) => {
        const params = new URLSearchParams(searchParams.toString());
        if (next === "documents") params.delete("view");
        else params.set("view", next);
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname);
      }}
    />
  );
}

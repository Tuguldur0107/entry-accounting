"use client";

// Өглөг → eBarimt хуудасны таб: худалдан авалт | гаалийн мэдүүлэг. URL `?view=customs`;
// бусад параметр (from/to) хадгалагдана.

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PageTabs } from "@/components/ui/tabs";

export type EbarimtPayablesView = "purchases" | "customs";

export function EbarimtPayablesTabs({ view }: { view: EbarimtPayablesView }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabs = [
    { value: "purchases" as const, label: "Худалдан авалтын eBarimt" },
    { value: "customs" as const, label: "Гаалийн мэдүүлэг" },
  ];
  return (
    <PageTabs
      tabs={tabs}
      value={view}
      onChange={(next) => {
        const params = new URLSearchParams(searchParams.toString());
        if (next === "customs") params.set("view", "customs");
        else params.delete("view");
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname);
      }}
    />
  );
}

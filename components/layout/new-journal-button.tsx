"use client";

import { usePathname } from "next/navigation";

import { openNewVoucherPanel } from "@/lib/store/panel-store";

export function NewJournalButton() {
  const pathname = usePathname();
  if (!pathname.startsWith("/gl")) return null;

  return (
    <button
      type="button"
      onClick={() => openNewVoucherPanel()}
      className="h-8 px-3 text-xs font-medium bg-[var(--ea-primary)] text-[var(--primary-foreground)] rounded-md hover:bg-[var(--ea-primary-700)] transition-colors"
    >
      + Шинэ журнал
    </button>
  );
}

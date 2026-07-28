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
      className="ea-primary-button h-8 rounded-md px-3 text-xs font-medium text-[var(--primary-foreground)]"
    >
      + Шинэ журнал
    </button>
  );
}

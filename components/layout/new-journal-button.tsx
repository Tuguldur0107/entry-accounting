"use client";

import { usePathname } from "next/navigation";

export function NewJournalButton() {
  const pathname = usePathname();
  if (!pathname.startsWith("/gl")) return null;

  return (
    <button
      type="button"
      onClick={() =>
        window.open(
          "/gl/journal/new",
          "_blank",
          "width=1280,height=800,menubar=no,toolbar=no,location=no,status=no"
        )
      }
      className="h-8 px-3 text-xs font-medium bg-[var(--ea-primary)] text-white rounded-md hover:bg-[var(--ea-primary-700)] transition-colors"
    >
      + Шинэ журнал
    </button>
  );
}

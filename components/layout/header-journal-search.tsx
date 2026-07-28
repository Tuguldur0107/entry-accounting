"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";

function defaultMonthRange() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, today.getMonth() + 1, 0).getDate();
  return {
    start: `${y}-${m}-01`,
    end: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
  };
}

// Date range filter rendered in the dashboard header. Acts as a shared
// filter for any surface that reads `start` / `end` from searchParams
// (GL journal, GL reports, and cash transactions). Stays on the active
// path instead of forcing a navigation.
const DATE_AWARE_PATHS = [
  "/gl/journal",
  "/gl/reports",
  "/cash/transactions",
  "/cash/reports",
];

export function HeaderJournalSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const defaults = defaultMonthRange();
  const [start, setStart] = useState(searchParams.get("start") ?? defaults.start);
  const [end, setEnd] = useState(searchParams.get("end") ?? defaults.end);

  if (!DATE_AWARE_PATHS.includes(pathname)) return null;

  function handleSearch() {
    // Preserve any other params already on the URL (e.g. cash `type`
    // tab, report selection) — only overwrite the date range.
    const params = new URLSearchParams(searchParams.toString());
    if (start) params.set("start", start);
    else params.delete("start");
    if (end) params.set("end", end);
    else params.delete("end");
    const target = `${pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    router.replace(target);
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        aria-label="Эхлэх огноо"
        className="h-8 px-2 text-xs border border-[var(--ea-border)] rounded-md bg-[var(--ea-surface)] text-[var(--ea-text-1)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--ea-primary)_22%,transparent)] focus:border-[var(--ea-primary)]"
      />
      <span className="text-xs text-[var(--ea-text-3)]">–</span>
      <input
        type="date"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        aria-label="Дуусах огноо"
        className="h-8 px-2 text-xs border border-[var(--ea-border)] rounded-md bg-[var(--ea-surface)] text-[var(--ea-text-1)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--ea-primary)_22%,transparent)] focus:border-[var(--ea-primary)]"
      />
      <button
        type="button"
        onClick={handleSearch}
        className="h-8 px-3 text-xs font-medium bg-[var(--ea-primary)] text-[var(--primary-foreground)] rounded-md hover:bg-[var(--ea-primary-700)] transition-colors"
      >
        Хайх
      </button>
    </div>
  );
}

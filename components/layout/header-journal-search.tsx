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

export function HeaderJournalSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const defaults = defaultMonthRange();
  const [start, setStart] = useState(searchParams.get("start") ?? defaults.start);
  const [end, setEnd] = useState(searchParams.get("end") ?? defaults.end);

  function handleSearch() {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    const target = `/gl/journal${params.toString() ? `?${params.toString()}` : ""}`;
    if (pathname === "/gl/journal") {
      router.replace(target);
    } else {
      router.push(target);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        aria-label="Эхлэх огноо"
        className="h-8 px-2 text-xs border border-[var(--ea-border)] rounded-md bg-[var(--ea-surface)] text-[var(--ea-text-1)] focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/20 focus:border-[var(--ea-primary)]"
      />
      <span className="text-xs text-[var(--ea-text-3)]">–</span>
      <input
        type="date"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        aria-label="Дуусах огноо"
        className="h-8 px-2 text-xs border border-[var(--ea-border)] rounded-md bg-[var(--ea-surface)] text-[var(--ea-text-1)] focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/20 focus:border-[var(--ea-primary)]"
      />
      <button
        type="button"
        onClick={handleSearch}
        className="h-8 px-3 text-xs font-medium bg-[var(--ea-primary)] text-white rounded-md hover:bg-[var(--ea-primary-700)] transition-colors"
      >
        Хайх
      </button>
    </div>
  );
}

"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Report-type selector rendered in the dashboard header. Only visible on
// /gl/reports — every other path returns null so the header stays clean.
// Selection is persisted in the URL via `?report=` so refresh and
// shareable links remember the active report.

const REPORT_OPTIONS = [
  { value: "gl-balance", label: "Гүйлгээ баланс" },
  { value: "balance-sheet", label: "Баланс" },
  { value: "income-statement", label: "Орлогын тайлан" },
  { value: "cash-flow", label: "Мөнгөн гүйлгээний тайлан" },
] as const;

const DEFAULT_REPORT = "gl-balance";
const VALID_VALUES = new Set(REPORT_OPTIONS.map((o) => o.value));

export function HeaderReportSelect() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  if (pathname !== "/gl/reports") return null;

  const raw = searchParams.get("report");
  const current = raw && VALID_VALUES.has(raw as (typeof REPORT_OPTIONS)[number]["value"])
    ? raw
    : DEFAULT_REPORT;

  function handleChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("report", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={current}
      onChange={(e) => handleChange(e.target.value)}
      aria-label="Тайлангийн төрөл"
      className="h-8 px-2 text-xs border border-[var(--ea-border)] rounded-md bg-[var(--ea-surface)] text-[var(--ea-text-1)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--ea-primary)_22%,transparent)] focus:border-[var(--ea-primary)]"
    >
      {REPORT_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

"use client";

// Авлагын цуглуулалтын самбар (docs/dev/arap.md §5j) — Авлагын хяналтын самбарт:
// DSO, энэ сарын цуглуулалт, төлөх огноогоор орох мөнгө, хамгийн их хэтэрсэн
// харилцагчид (→ тооцоо нийлсэн акт), сануулгын үр дүн, давтамжтай нэхэмжлэх.
// Хуудасны ГОЛ тоо нь дээрх «Авлага» — энд жижиг үзүүлэлтүүд л (UI гайд).

import Link from "next/link";

import type { CollectionsOverview } from "@/lib/arap/collections";
import { fmtMntCompact } from "@/lib/format/money";
import { fmtMnt } from "@/lib/reports/balances";

function Stat({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warning" | "danger";
  href?: string;
}) {
  const body = (
    <>
      <div className="text-[11px] text-[var(--ea-text-3)]">{label}</div>
      <div
        className={`font-mono text-sm font-semibold ${
          tone === "danger" ? "text-[var(--ea-danger-fg)]" : tone === "warning" ? "text-[var(--ea-warning-fg)]" : "text-[var(--ea-text-1)]"
        }`}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[11px] text-[var(--ea-text-4)]">{hint}</div> : null}
    </>
  );
  const className = "block rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2";
  return href ? (
    <Link href={href} className={`${className} hover:border-[var(--ea-border-strong)]`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

const INFLOW = [
  { key: "overdue", label: "Хэтэрсэн", color: "var(--ea-danger)" },
  { key: "next7", label: "7 хоногт", color: "var(--ea-warning)" },
  { key: "next30", label: "8–30 хоногт", color: "var(--ea-success)" },
  { key: "later", label: "30-аас хойш", color: "var(--ea-text-4)" },
] as const;

export function CollectionsPanel({ overview }: { overview: CollectionsOverview }) {
  const { expected } = overview;
  const inflowTotal = expected.overdue + expected.next7 + expected.next30 + expected.later;
  const delta = overview.collectedThisMonth - overview.collectedLastMonth;
  return (
    <section className="flex flex-col gap-3" aria-label="Авлагын цуглуулалт">
      <div className="text-sm font-medium text-[var(--ea-text-1)]">Цуглуулалт</div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Stat
          label="Авлага цуглардаг хугацаа (DSO)"
          value={overview.dso == null ? "—" : `${overview.dso} хоног`}
          hint="Сүүлийн 90 хоногийн борлуулалтаар"
          tone={overview.dso != null && overview.dso > 60 ? "danger" : overview.dso != null && overview.dso > 30 ? "warning" : undefined}
        />
        <Stat
          label="Энэ сард цуглуулсан"
          value={`${fmtMntCompact(overview.collectedThisMonth)}`}
          hint={`Өмнөх сар ${fmtMntCompact(overview.collectedLastMonth)}${delta ? ` · ${delta > 0 ? "+" : "−"}${fmtMntCompact(Math.abs(delta))}` : ""}`}
        />
        <Stat
          label="7 хоногт орох ёстой"
          value={fmtMntCompact(expected.next7)}
          hint={`${expected.next7Count} нэхэмжлэх · хэтэрсэн ${fmtMntCompact(expected.overdue)}`}
          tone={expected.overdue > 0 ? "warning" : undefined}
        />
        <Stat
          label="Сануулгын үр дүн (30 хоног)"
          value={
            overview.reminders.enabled || overview.reminders.sent
              ? overview.reminders.rate == null
                ? "—"
                : `${overview.reminders.rate}%`
              : "Унтраалттай"
          }
          hint={
            overview.reminders.sent
              ? `${overview.reminders.sent} сануулгаас ${overview.reminders.paid} нь 7 хоногт төлөгдсөн`
              : "Асаах → Сануулга"
          }
          href="/receivables/reminders"
        />
        <Stat
          label="Давтамжтай (30 хоногт)"
          value={overview.recurring.count ? fmtMntCompact(overview.recurring.amount) : "—"}
          hint={overview.recurring.count ? `${overview.recurring.count} нэхэмжлэх үүснэ` : "Нэхэмжлэхээс «Давтамжтай болгох»"}
          href="/receivables/recurring"
        />
      </div>

      {inflowTotal > 0 && (
        <div>
          <div className="mb-1 text-[11px] text-[var(--ea-text-3)]">Нээлттэй авлага төлөх огноогоор</div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--ea-bg-2)]" aria-hidden>
            {INFLOW.filter((bucket) => expected[bucket.key] > 0).map((bucket) => (
              <div key={bucket.key} style={{ width: `${(expected[bucket.key] / inflowTotal) * 100}%`, background: bucket.color }} />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            {INFLOW.map((bucket) => (
              <span key={bucket.key} className="flex items-center gap-1.5 text-xs text-[var(--ea-text-2)]" title={`${fmtMnt(expected[bucket.key])} ₮`}>
                <span className="inline-block size-2 rounded-full" style={{ background: bucket.color }} aria-hidden />
                {bucket.label} {fmtMntCompact(expected[bucket.key])}
              </span>
            ))}
          </div>
        </div>
      )}

      {overview.topOverdue.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] text-[var(--ea-text-3)]">Хамгийн их хэтэрсэн харилцагч</div>
          <ul className="divide-y divide-[var(--ea-border)] rounded-md border border-[var(--ea-border)]">
            {overview.topOverdue.map((row) => (
              <li key={row.counterpartyId} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                <span className="min-w-0 truncate">
                  {row.name}
                  <span className="ml-2 text-xs text-[var(--ea-text-3)]">
                    {row.invoices} нэхэмжлэх · {row.maxDaysOverdue} хоног хүртэл хэтэрсэн
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="font-mono text-[var(--ea-danger-fg)]" title={`${fmtMnt(row.amount)} ₮`}>
                    {fmtMntCompact(row.amount)}
                  </span>
                  <Link
                    href={`/receivables/reports/statement?counterparty=${row.counterpartyId}`}
                    className="text-xs text-[var(--ea-primary)] hover:underline"
                  >
                    Акт
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

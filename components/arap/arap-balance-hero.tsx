"use client";

// АР/АП самбарын гол тоо + насжилтын зурвас (UI гайдын карт 6, ENT-060).
// Гурван ижил тооны («Нийт / Нээлттэй / Хэтэрсэн») оронд НЭГ том тоо, түүнийг
// хугацаа хэтэрсэн хоногоор ангилсан өнгөт зурвас тайлбарлана. Хэсэг бүр
// насжилтын тайлан руу үсэрнэ; бүтэн дүн нь title (hover) + aria-label-д.

import Link from "next/link";

import type { ArapAgingBucketKey, ArapBalanceSummary } from "@/lib/arap/kpis";
import { fmtMntCompact } from "@/lib/format/money";
import { fmtMnt } from "@/lib/reports/balances";

const BUCKET_COLORS: Record<ArapAgingBucketKey, string> = {
  "0-30": "var(--ea-success)",
  "31-60": "var(--ea-warning)",
  "60+": "var(--ea-danger)",
};

export function ArapBalanceHero({
  title,
  summary,
  reportHref,
  draftCount,
  draftAmount,
}: {
  /** «Авлага» / «Өглөг». */
  title: string;
  summary: ArapBalanceSummary;
  /** Насжилтын тайлан (хэсэг дээр дарахад). */
  reportHref: string;
  draftCount?: number;
  draftAmount?: number;
}) {
  const { total, buckets, counterpartyCount, documentCount, creditTotal } = summary;
  // Зурвас нь нэхэмжлэхүүдийн насжилт — кредит хасагдаагүй нийлбэрээр дүүрнэ.
  const gross = buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
  return (
    <div className="min-w-0 flex-1 px-4 py-4">
      <div className="text-xs text-[var(--ea-text-3)]">
        {title} · {counterpartyCount} харилцагч · {documentCount} баримт
      </div>
      <div
        className="mt-1 font-mono text-[26px] font-semibold leading-tight tabular-nums text-[var(--ea-text-1)]"
        title={`${fmtMnt(total)} ₮`}
        aria-label={`${title}: ${fmtMnt(total)} төгрөг`}
      >
        {fmtMntCompact(total)}
      </div>
      {gross > 0 ? (
        <div
          className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-[var(--ea-bg-2)]"
          aria-hidden
        >
          {buckets
            .filter((bucket) => bucket.amount > 0)
            .map((bucket) => (
              <div
                key={bucket.key}
                style={{
                  width: `${(bucket.amount / gross) * 100}%`,
                  background: BUCKET_COLORS[bucket.key],
                }}
              />
            ))}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {buckets.map((bucket) => (
          <Link
            key={bucket.key}
            href={reportHref}
            title={`${bucket.label}: ${fmtMnt(bucket.amount)} ₮ · ${bucket.count} баримт — насжилтын тайлан`}
            className="flex items-center gap-1.5 rounded text-xs text-[var(--ea-text-2)] hover:text-[var(--ea-text-1)] hover:underline"
          >
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: BUCKET_COLORS[bucket.key] }}
              aria-hidden
            />
            <span>{bucket.label}</span>
            <span className="font-mono tabular-nums text-[var(--ea-text-1)]">
              {bucket.amount > 0 ? fmtMntCompact(bucket.amount) : "—"}
            </span>
          </Link>
        ))}
        {creditTotal > 0.005 ? (
          <span
            className="text-xs text-[var(--ea-text-3)]"
            title={`Эх нэхэмжлэхэд тооцогдоогүй кредит/дебит баримт — гол тооноос хасагдсан (${fmtMnt(creditTotal)} ₮)`}
          >
            Кредит −{fmtMntCompact(creditTotal)}
          </span>
        ) : null}
        {draftCount ? (
          <span
            className="text-xs text-[var(--ea-text-3)]"
            title={`Ноорог нь өр биш — нийт дүнд ороогүй (${fmtMnt(draftAmount ?? 0)} ₮)`}
          >
            Ноорог {draftCount} · {fmtMntCompact(draftAmount ?? 0)} (ороогүй)
          </span>
        ) : null}
      </div>
    </div>
  );
}

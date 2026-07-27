"use client";

// GL журналын дэлгэрэнгүйн НЭГДСЭН dialog — кассын баримтын drawer-тай ижил
// хэв маяг: толгойн dl мэдээлэл + VoucherLinesTable. Самбар болон бусад
// модулиас журналын id-аар дуудаж хэрэглэнэ (өгөгдлөө өөрөө татна).

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VoucherLinesTable } from "@/components/gl/voucher-lines-table";
import { getGlVoucherDetail } from "@/lib/actions/gl";
import { fmtMnt } from "@/lib/reports/balances";

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  reversed: "Буцаагдсан",
};

type VoucherDetail = Awaited<ReturnType<typeof getGlVoucherDetail>>;

interface Props {
  /** Харах журналын id — null бол dialog хаалттай. */
  voucherId: string | null;
  onClose: () => void;
  activeSegIds: number[];
  glName: (mainAccount: string) => string;
}

export function VoucherDetailDialog({
  voucherId,
  onClose,
  activeSegIds,
  glName,
}: Props) {
  // Татсан дэлгэрэнгүйг харьяалагдах id-тэй нь хамт хадгална — effect дотор
  // синхрон setState дуудахгүй (cash drawer-тай ижил загвар).
  const [loaded, setLoaded] = useState<{
    id: string;
    detail: VoucherDetail | null;
  } | null>(null);

  useEffect(() => {
    if (!voucherId) return;
    let cancelled = false;
    getGlVoucherDetail(voucherId)
      .then((detail) => {
        if (!cancelled) setLoaded({ id: voucherId, detail });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: voucherId, detail: null });
      });
    return () => {
      cancelled = true;
    };
  }, [voucherId]);

  const detail =
    voucherId && loaded && loaded.id === voucherId ? loaded.detail : null;
  const loading = !!voucherId && (!loaded || loaded.id !== voucherId);

  const totalDebit = detail
    ? detail.lines.reduce((sum, line) => sum + line.debit, 0)
    : 0;

  return (
    <Dialog open={!!voucherId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Журналын бичилт</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="rounded-md border border-[var(--ea-border)] py-6 text-center text-xs text-[var(--ea-text-4)]">
            Ачаалж байна…
          </div>
        )}

        {!loading && !detail && (
          <div className="rounded-md border border-[var(--ea-border)] py-6 text-center text-xs text-[var(--ea-text-4)]">
            Журнал олдсонгүй
          </div>
        )}

        {detail && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
              <Row label="Огноо" value={detail.date} mono />
              <Row
                label="Төлөв"
                value={STATUS_LABELS[detail.status] ?? detail.status}
              />
              <Row label="Нийт дүн" value={fmtMnt(totalDebit)} mono strong />
              <Row label="Мөрийн тоо" value={String(detail.lines.length)} mono />
              <Row label="Утга" value={detail.description || "—"} span2 />
            </dl>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--ea-text-2)]">
                  Журналын мөрүүд
                </span>
                {detail.status === "draft" && (
                  <Link
                    href={`/gl/journal/${detail.id}/edit`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ea-primary)] hover:underline"
                  >
                    Журнал нээх
                    <ExternalLink size={12} />
                  </Link>
                )}
              </div>
              <VoucherLinesTable
                lines={detail.lines}
                activeSegIds={activeSegIds}
                glName={glName}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  mono,
  strong,
  span2,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "col-span-2" : undefined}>
      <dt className="text-[var(--ea-text-4)]">{label}</dt>
      <dd
        className={[
          "mt-0.5 text-[var(--ea-text-1)]",
          mono ? "font-mono" : "",
          strong ? "font-semibold" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

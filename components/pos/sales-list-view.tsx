"use client";

// Борлуулалтын жагсаалт (таб) — docs/pos §4.3. Статусын `FilterChips` +
// борлуулалт/буцаалт шүүлтүүр, огнооны муж (URL `from`/`to`), ДАВХАР даралт
// → `pos-sale` панель.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import type { DataGridHandle } from "@/components/datagrid/DataGrid";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { FilterChips, type ChipOption } from "@/components/ui/tabs";
import { EBARIMT_STATUS_LABELS, type EbarimtStatus } from "@/lib/ebarimt/constants";
import { SALE_STATUS_LABELS } from "@/lib/pos/constants";
import type { PosSaleView } from "@/lib/pos/types";
import { fmtMnt } from "@/lib/reports/balances";
import { openPosSalePanel } from "@/lib/store/panel-store";
import { cancelQpayIntent, finalizeQpayIntent, listPendingQpayIntents } from "@/lib/actions/qpay";
import { QPAY_INTENT_STATUS_LABELS } from "@/lib/qpay/constants";
import type { QpayIntentView } from "@/lib/qpay/types";
import { feedback } from "@/lib/ui/feedback";

type StatusFilter = "all" | "posted" | "partially_returned" | "returned" | "voided";
type KindFilter = "all" | "sales" | "returns";
type EbarimtFilter = "all" | "failed" | "skipped" | "non_vat";

export const SALE_STATUS_TONES: Record<string, StatusTone> = {
  posted: "success",
  partially_returned: "warning",
  returned: "muted",
  voided: "danger",
};

/** eBarimt статусын өнгө (lib/ebarimt/constants.ts EbarimtStatus). */
export const EBARIMT_STATUS_TONES: Record<string, StatusTone> = {
  sent: "success",
  pending: "warning",
  failed: "danger",
  cancelled: "muted",
  manual: "muted",
  skipped: "warning",
};

const STATUS_VALUES: StatusFilter[] = ["all", "posted", "partially_returned", "returned", "voided"];

const fmtTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" }).slice(0, 16);
};

export function SalesListView({
  sales,
  from,
  to,
  initialStatus,
  onRangeChange,
}: {
  sales: PosSaleView[];
  from: string;
  to: string;
  initialStatus?: string;
  onRangeChange: (from: string, to: string) => void;
}) {
  const gridRef = useRef<DataGridHandle>(null);
  const [status, setStatus] = useState<StatusFilter>(
    STATUS_VALUES.includes(initialStatus as StatusFilter) ? (initialStatus as StatusFilter) : "all"
  );
  const [kind, setKind] = useState<KindFilter>("all");
  const [ebarimt, setEbarimt] = useState<EbarimtFilter>("all");
  const [rangeFrom, setRangeFrom] = useState(from);
  // QPay intent — төлөгдсөн ч борлуулалт бүртгэгдээгүй / нээлттэй / алдаатай (docs/pos/04 §3.3, D3).
  const [qpayPending, setQpayPending] = useState<QpayIntentView[]>([]);
  const [qpayBusy, setQpayBusy] = useState<string | null>(null);
  const loadQpayPending = useCallback(() => {
    listPendingQpayIntents().then((result) => {
      if (!result.error && result.intents) setQpayPending(result.intents);
    });
  }, []);
  useEffect(loadQpayPending, [loadQpayPending]);

  async function finalizeIntent(intent: QpayIntentView) {
    setQpayBusy(intent.id);
    const result = await finalizeQpayIntent(intent.id);
    setQpayBusy(null);
    if (result.error) {
      feedback.error(result.error);
      return;
    }
    feedback.posted(`${result.documentNo} батлагдлаа (QPay)`);
    loadQpayPending();
    onRangeChange(rangeFrom, rangeTo);
  }

  async function cancelIntent(intent: QpayIntentView) {
    setQpayBusy(intent.id);
    const result = await cancelQpayIntent(intent.id);
    setQpayBusy(null);
    if (result.error) feedback.error(result.error);
    loadQpayPending();
  }
  // Муж өөрчлөгдөхөд эцэг `key`-ээр remount хийнэ (sales-workspace.tsx).
  const [rangeTo, setRangeTo] = useState(to);

  const kindFiltered = useMemo(
    () =>
      sales.filter((sale) =>
        kind === "all" ? true : kind === "returns" ? sale.isReturn : !sale.isReturn
      ),
    [sales, kind]
  );

  const statusChips = useMemo<ChipOption<StatusFilter>[]>(() => {
    const counts = new Map<string, number>();
    for (const sale of kindFiltered) counts.set(sale.status, (counts.get(sale.status) ?? 0) + 1);
    return STATUS_VALUES.map((value) => ({
      value,
      label: value === "all" ? "Бүх төлөв" : SALE_STATUS_LABELS[value] ?? value,
      count: value === "all" ? kindFiltered.length : counts.get(value) ?? 0,
      tone: value === "voided" ? ("warning" as const) : undefined,
    }));
  }, [kindFiltered]);

  const kindChips = useMemo<ChipOption<KindFilter>[]>(
    () => [
      { value: "all", label: "Бүгд", count: sales.length },
      { value: "sales", label: "Борлуулалт", count: sales.filter((sale) => !sale.isReturn).length },
      { value: "returns", label: "Буцаалт", count: sales.filter((sale) => sale.isReturn).length },
    ],
    [sales]
  );

  const ebarimtChips = useMemo<ChipOption<EbarimtFilter>[]>(() => {
    const failed = sales.filter((sale) => sale.ebarimtStatus === "failed").length;
    const skipped = sales.filter((sale) => sale.ebarimtStatus === "skipped").length;
    const nonVatCount = sales.filter((sale) => sale.nonVat).length;
    return [
      { value: "all", label: "eBarimt бүгд" },
      { value: "failed", label: "eBarimt алдаатай", count: failed, tone: "warning" as const },
      { value: "skipped", label: "eBarimt илгээгээгүй", count: skipped, tone: "warning" as const },
      { value: "non_vat", label: "НӨАТ-гүй", count: nonVatCount, tone: "warning" as const },
    ];
  }, [sales]);

  const visible = useMemo(
    () =>
      kindFiltered.filter(
        (sale) =>
          (status === "all" || sale.status === status) &&
          (ebarimt === "all" || (ebarimt === "non_vat" ? sale.nonVat : sale.ebarimtStatus === ebarimt))
      ),
    [kindFiltered, status, ebarimt]
  );

  const navIdsRef = useRef<string[]>([]);
  useEffect(() => {
    navIdsRef.current = visible.map((sale) => sale.id);
  }, [visible]);

  const openPanel = useCallback(
    (sale: PosSaleView) => openPosSalePanel(sale.id, sale.documentNo, navIdsRef.current),
    []
  );

  const columns = useMemo<ColDef<PosSaleView>[]>(
    () => [
      {
        headerName: "Дугаар",
        field: "documentNo",
        width: 150,
        cellClass: "font-mono text-xs",
        cellRenderer: (p: ICellRendererParams<PosSaleView>) =>
          p.data ? (
            <span className="flex h-full items-center gap-1.5">
              <span>{p.data.documentNo}</span>
              {p.data.isReturn && (
                <StatusBadge tone="warning" size="sm">
                  Буцаалт
                </StatusBadge>
              )}
            </span>
          ) : null,
      },
      {
        headerName: "Огноо / цаг",
        field: "soldAt",
        width: 140,
        cellClass: "font-mono text-xs",
        valueFormatter: (p) => fmtTime(String(p.value ?? "")),
      },
      { headerName: "Ээлж", field: "shiftNo", width: 120, cellClass: "font-mono text-xs" },
      { headerName: "Кассчин", field: "cashierName", width: 130 },
      { headerName: "Харилцагч", field: "counterpartyName", minWidth: 160, flex: 1 },
      {
        headerName: "Нийт (хөнг. өмнө)",
        field: "grossAmount",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
      },
      {
        headerName: "Хөнгөлөлт",
        field: "discountTotal",
        width: 110,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => (Number(p.value) > 0 ? `−${fmtMnt(Number(p.value))}` : ""),
      },
      {
        // НӨАТ-гүй борлуулалт (кассын «НӨАТ» унтраалттай) — eBarimt үүсээгүй, тусдаа данс.
        headerName: "НӨАТ баримт",
        field: "nonVat",
        width: 120,
        valueGetter: (p) => (p.data?.nonVat ? "НӨАТ-гүй" : "НӨАТ-тэй"),
        tooltipValueGetter: (p) => (p.data?.nonVat ? `Шалтгаан: ${p.data.nonVatReason ?? "—"}` : undefined),
        cellRenderer: (p: ICellRendererParams<PosSaleView>) =>
          p.data?.nonVat ? (
            <span className="flex h-full items-center">
              <StatusBadge tone="warning" size="sm">
                НӨАТ-гүй
              </StatusBadge>
            </span>
          ) : (
            <span className="text-xs text-[var(--ea-text-3)]">НӨАТ-тэй</span>
          ),
      },
      {
        headerName: "НӨАТ",
        field: "vatAmount",
        width: 100,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => (Number(p.value) > 0 ? fmtMnt(Number(p.value)) : ""),
      },
      {
        headerName: "Төлөх",
        field: "total",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
      },
      { headerName: "Төлбөр", field: "paymentSummary", minWidth: 180, flex: 1, cellClass: "text-xs" },
      {
        headerName: "Статус",
        field: "status",
        width: 150,
        valueGetter: (p) => (p.data ? SALE_STATUS_LABELS[p.data.status] ?? p.data.status : ""),
        cellRenderer: (p: ICellRendererParams<PosSaleView>) =>
          p.data ? (
            <span className="flex h-full items-center">
              <StatusBadge tone={SALE_STATUS_TONES[p.data.status] ?? "muted"} size="sm">
                {SALE_STATUS_LABELS[p.data.status] ?? p.data.status}
              </StatusBadge>
            </span>
          ) : null,
      },
      {
        headerName: "eBarimt",
        field: "ebarimtStatus",
        width: 130,
        valueGetter: (p) =>
          p.data?.ebarimtStatus
            ? EBARIMT_STATUS_LABELS[p.data.ebarimtStatus as EbarimtStatus] ?? p.data.ebarimtStatus
            : "—",
        cellRenderer: (p: ICellRendererParams<PosSaleView>) => {
          const value = p.data?.ebarimtStatus;
          if (!value) return <span className="text-[var(--ea-text-4)]">—</span>;
          return (
            <span className="flex h-full items-center">
              <StatusBadge tone={EBARIMT_STATUS_TONES[value] ?? "muted"} size="sm">
                {EBARIMT_STATUS_LABELS[value as EbarimtStatus] ?? value}
              </StatusBadge>
            </span>
          );
        },
      },
      {
        headerName: "ДДТД",
        field: "ebarimtId",
        width: 140,
        cellClass: "font-mono text-xs",
        valueFormatter: (p) => String(p.value ?? ""),
      },
    ],
    []
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-1.5">
          <label className="text-xs text-[var(--ea-text-3)]">
            Эхлэх
            <Input type="date"
              aria-label="Эхлэх огноо" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className="mt-1 w-40" />
          </label>
          <label className="text-xs text-[var(--ea-text-3)]">
            Дуусах
            <Input type="date"
              aria-label="Дуусах огноо" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className="mt-1 w-40" />
          </label>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={!rangeFrom || !rangeTo || (rangeFrom === from && rangeTo === to)}
            onClick={() => onRangeChange(rangeFrom, rangeTo)}
          >
            Харах
          </Button>
        </div>
        <FilterChips options={kindChips} value={kind} onChange={setKind} />
        <FilterChips options={statusChips} value={status} onChange={setStatus} />
        <FilterChips options={ebarimtChips} value={ebarimt} onChange={setEbarimt} />
      </div>

      {qpayPending.length > 0 && (
        <div className="rounded-md border border-[var(--ea-warning)] bg-[var(--ea-surface)] p-2 text-xs">
          <div className="mb-1 font-semibold text-[var(--ea-warning-fg)]">
            QPay хүлээгдэж буй · {qpayPending.length}
            <span className="ml-2 font-normal text-[var(--ea-text-3)]">
              Төлөгдсөн ч борлуулалт бүртгэгдээгүй бол «Борлуулалт болгох» — сагс тухайн үеийнхээрээ бичигдэнэ
            </span>
          </div>
          <ul className="space-y-1">
            {qpayPending.map((intent) => (
              <li key={intent.id} className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={intent.status === "paid" ? "danger" : intent.status === "open" ? "warning" : "muted"}
                  size="sm"
                >
                  {QPAY_INTENT_STATUS_LABELS[intent.status]}
                </StatusBadge>
                <span className="font-mono">{fmtMnt(intent.amount)}₮</span>
                <span className="text-[var(--ea-text-3)]">
                  {fmtTime(intent.paidAt ?? intent.createdAt)} · {intent.cashierName || "—"} · {intent.lineCount} мөр
                  {intent.qpayInvoiceId ? ` · ${intent.qpayInvoiceId.slice(0, 8)}…` : ""}
                </span>
                {intent.lastError && <span className="text-[var(--ea-danger-fg)]">{intent.lastError}</span>}
                {intent.status === "paid" && (
                  <Button size="xs" disabled={qpayBusy === intent.id} onClick={() => finalizeIntent(intent)}>
                    Борлуулалт болгох
                  </Button>
                )}
                {intent.status === "open" && (
                  <Button size="xs" variant="outline" disabled={qpayBusy === intent.id} onClick={() => cancelIntent(intent)}>
                    Цуцлах
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {sales.length === 0 ? (
        <EmptyState
          icon="cash"
          title="Энэ хугацаанд борлуулалт алга"
          description="Касс (POS) дэлгэцээс борлуулалт хийхэд энд жагсана."
          actions={[{ label: "Касс (POS)", href: "/inventory/pos", icon: "cash", primary: true }]}
        />
      ) : (
        <DataGridDynamic<PosSaleView>
          ref={gridRef}
          rowData={visible}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height="flex"
          pagination={visible.length > 50}
          paginationPageSize={50}
          paginationPageSizeSelector={false}
          wrapperClassName="ea-clickable-rows rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onCellDoubleClicked={(event) => {
            if (event.data) openPanel(event.data);
          }}
        />
      )}
    </div>
  );
}

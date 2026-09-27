"use client";

// eBarimt баримтуудын НЭГДСЭН жагсаалт `/tax/ebarimt` — POS борлуулалт/буцаалт +
// АР нэхэмжлэх. Эх / төлөвийн `FilterChips`, ДАВХАР даралт → эх баримтын панель
// (дахин илгээх нь тэндээс — энд бичилт хийхгүй). Огноо = topbar-ын период.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import type { DataGridHandle } from "@/components/datagrid/DataGrid";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { TaxStatCard } from "@/components/tax/tax-info";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterChips, type ChipOption } from "@/components/ui/tabs";
import { EBARIMT_STATUS_LABELS, EBARIMT_STATUSES, type EbarimtStatus } from "@/lib/ebarimt/constants";
import {
  EBARIMT_SOURCE_LABELS,
  ebarimtTypeLabel,
  isAttentionStatus,
  reportedAmounts,
  summarizeEbarimtRows,
  type EbarimtDocumentRow,
  type EbarimtDocumentSource,
} from "@/lib/ebarimt/list-types";
import { downloadWorkbook } from "@/lib/excel/core";
import { fmtMntCompact } from "@/lib/format/money";
import { col } from "@/lib/grid/columnTypes";
import { fmtMnt } from "@/lib/reports/balances";
import { EBARIMT_STATUS_TONES } from "@/lib/status";
import { openArapDocPanel, openPosSalePanel } from "@/lib/store/panel-store";
import { feedback } from "@/lib/ui/feedback";

type SourceFilter = "all" | EbarimtDocumentSource;
type StatusFilter = "all" | "attention" | EbarimtStatus;

const statusLabel = (status: string) => EBARIMT_STATUS_LABELS[status as EbarimtStatus] ?? status;

type GridRow = EbarimtDocumentRow & { pinned?: boolean };

export function EbarimtDocumentsView({
  rows,
  from,
  to,
  sources,
  truncated,
}: {
  rows: EbarimtDocumentRow[];
  from: string;
  to: string;
  sources: EbarimtDocumentSource[];
  truncated: boolean;
}) {
  const gridRef = useRef<DataGridHandle>(null);
  const [source, setSource] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const bySource = useMemo(
    () => (source === "all" ? rows : rows.filter((row) => row.source === source)),
    [rows, source]
  );
  const visible = useMemo(
    () =>
      bySource.filter((row) =>
        status === "all" ? true : status === "attention" ? isAttentionStatus(row.status) : row.status === status
      ),
    [bySource, status]
  );
  const summary = useMemo(() => summarizeEbarimtRows(bySource), [bySource]);

  // Эх солиход өмнөх төлөвийн шүүлтүүр шинэ эхэд байхгүй байж болно — chip нь
  // харагдахгүй ч шүүлт идэвхтэй үлдэж хүснэгт шалтгаангүй хоосрохоос сэргийлнэ.
  const changeSource = useCallback((next: SourceFilter) => {
    setSource(next);
    setStatus("all");
  }, []);

  const sourceChips = useMemo<ChipOption<SourceFilter>[]>(
    () => [
      { value: "all", label: "Бүх эх", count: rows.length },
      ...sources.map((value) => ({
        value,
        label: EBARIMT_SOURCE_LABELS[value],
        count: rows.filter((row) => row.source === value).length,
      })),
    ],
    [rows, sources]
  );

  const statusChips = useMemo<ChipOption<StatusFilter>[]>(
    () => [
      { value: "all", label: "Бүх төлөв", count: summary.count },
      { value: "attention", label: "Анхаарах", count: summary.attention, tone: "warning" as const },
      ...EBARIMT_STATUSES.filter((value) => (summary.byStatus[value] ?? 0) > 0).map((value) => ({
        value,
        label: statusLabel(value),
        count: summary.byStatus[value] ?? 0,
      })),
    ],
    [summary]
  );

  const navIdsRef = useRef<{ pos: string[]; arap: string[] }>({ pos: [], arap: [] });
  useEffect(() => {
    navIdsRef.current = {
      pos: visible.filter((row) => row.source === "pos").map((row) => row.id),
      arap: visible.filter((row) => row.source === "arap").map((row) => row.id),
    };
  }, [visible]);

  const openRow = useCallback((row: EbarimtDocumentRow) => {
    if (row.source === "pos") openPosSalePanel(row.id, row.documentNo, navIdsRef.current.pos);
    else
      openArapDocPanel({
        documentId: row.id,
        mode: "receivable",
        title: `${row.documentNo}${row.counterpartyName ? ` · ${row.counterpartyName}` : ""}`,
        navIds: navIdsRef.current.arap,
      });
  }, []);

  // Хөл дүн = харагдаж буй мөрүүдийн ТЕГ-д БҮРТГЭЛТЭЙ (sent + manual) хэсэг —
  // хураангуй карттай НЭГ дүрэм (цуцлагдсан, алдаатай, хүлээгдэж буй орохгүй).
  const pinnedBottom = useMemo<GridRow[]>(() => {
    if (visible.length === 0) return [];
    const reported = reportedAmounts(visible);
    return [
      {
        key: "total",
        pinned: true,
        source: "pos",
        id: "",
        documentNo: `ТЕГ-д бүртгэлтэй · ${reported.count}`,
        date: "",
        counterpartyName: null,
        customerTin: null,
        partiallyReturned: false,
        ebarimtType: null,
        status: "",
        ebarimtId: null,
        ebarimtDate: null,
        total: reported.total,
        vat: reported.vat,
        cityTax: reported.cityTax,
        lastError: null,
      },
    ];
  }, [visible]);

  const hasCityTax = useMemo(() => rows.some((row) => row.cityTax !== 0), [rows]);

  const columns = useMemo<ColDef<GridRow>[]>(
    () => [
      { headerName: "Огноо", field: "date", width: 110, cellClass: "font-mono text-xs" },
      {
        headerName: "Эх",
        field: "source",
        width: 150,
        valueGetter: (p) => (p.data?.pinned ? "" : p.data ? EBARIMT_SOURCE_LABELS[p.data.source] : ""),
        cellClass: "text-xs",
      },
      {
        headerName: "Дугаар",
        field: "documentNo",
        width: 170,
        cellClass: "font-mono text-xs",
        cellRenderer: (p: ICellRendererParams<GridRow>) =>
          p.data ? (
            <span className="flex h-full items-center gap-1.5">
              <span className={p.data.pinned ? "font-semibold" : undefined}>{p.data.documentNo}</span>
              {p.data.partiallyReturned && (
                <span title="Хэсэгчлэн буцаасан — ДДТД ба дүн нь буцаалтын дараах засварын баримтынх">
                  <StatusBadge tone="warning" size="sm">
                    Хэсэгчлэн буцаасан
                  </StatusBadge>
                </span>
              )}
            </span>
          ) : null,
      },
      {
        headerName: "Төрөл",
        field: "ebarimtType",
        width: 170,
        valueGetter: (p) => ebarimtTypeLabel(p.data?.ebarimtType ?? null),
        cellClass: "text-xs",
      },
      { headerName: "Харилцагч", field: "counterpartyName", minWidth: 170, flex: 1 },
      { headerName: "ТТД", field: "customerTin", width: 120, cellClass: "font-mono text-xs" },
      col<GridRow>({ eaType: "readonly-money", headerName: "Нийт", field: "total", width: 130 }),
      col<GridRow>({ eaType: "readonly-money", headerName: "НӨАТ", field: "vat", width: 110 }),
      col<GridRow>({ eaType: "readonly-money", headerName: "НХАТ", field: "cityTax", width: 95, hide: !hasCityTax }),
      {
        headerName: "eBarimt",
        field: "status",
        width: 150,
        valueGetter: (p) => (p.data?.pinned ? "" : statusLabel(p.data?.status ?? "")),
        tooltipValueGetter: (p) => p.data?.lastError ?? undefined,
        cellRenderer: (p: ICellRendererParams<GridRow>) =>
          p.data && !p.data.pinned ? (
            <span className="flex h-full items-center">
              <StatusBadge tone={EBARIMT_STATUS_TONES[p.data.status] ?? "muted"} size="sm">
                {statusLabel(p.data.status)}
              </StatusBadge>
            </span>
          ) : null,
      },
      { headerName: "ДДТД", field: "ebarimtId", width: 150, cellClass: "font-mono text-xs" },
      { headerName: "eBarimt огноо", field: "ebarimtDate", width: 150, cellClass: "font-mono text-xs" },
      {
        headerName: "Алдаа",
        field: "lastError",
        minWidth: 200,
        flex: 1,
        cellClass: "text-xs text-[var(--ea-danger-fg)]",
        tooltipField: "lastError",
      },
    ],
    [hasCityTax]
  );

  async function exportExcel() {
    try {
      await downloadWorkbook({
        slug: `entry-ebarimt-${from}-${to}`,
        sheetName: "eBarimt",
        columns: [
          { header: "Огноо", width: 12 },
          { header: "Эх", width: 18 },
          { header: "Дугаар", width: 18 },
          { header: "Төрөл", width: 24 },
          { header: "Харилцагч", width: 28 },
          { header: "ТТД", width: 14 },
          { header: "Нийт", width: 16, kind: "number" },
          { header: "НӨАТ", width: 14, kind: "number" },
          { header: "НХАТ", width: 12, kind: "number" },
          { header: "Төлөв", width: 18 },
          { header: "ДДТД", width: 36 },
          { header: "eBarimt огноо", width: 20 },
          { header: "Алдаа", width: 40 },
        ],
        rows: visible.map((row) => [
          row.date,
          EBARIMT_SOURCE_LABELS[row.source],
          row.documentNo,
          ebarimtTypeLabel(row.ebarimtType),
          row.counterpartyName ?? "",
          row.customerTin ?? "",
          row.total,
          row.vat,
          row.cityTax,
          statusLabel(row.status),
          row.ebarimtId ?? "",
          row.ebarimtDate ?? "",
          row.lastError ?? "",
        ]),
      });
    } catch (caught) {
      feedback.error(caught instanceof Error ? caught.message : "Excel татаж чадсангүй");
    }
  }

  if (sources.length === 0) {
    return (
      <EmptyState
        icon="document"
        title="POS эсвэл Авлагын модулийн уншилтын эрх алга"
        description="eBarimt баримтууд эх модулийнхаа эрхээр харагдана — Тохиргоо → Хэрэглэгчдийн эрх хэсгээс админ олгоно."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <TaxStatCard
          label={`ТЕГ-д бүртгэлтэй · ${summary.reported.count}`}
          value={fmtMntCompact(summary.reported.total)}
          hint={`${from} — ${to} · илгээсэн + гараар ДДТД бичсэн, буцаалтын дараах дүнгээр`}
          mono
        />
        <TaxStatCard
          label="ТЕГ-д бүртгэлтэй НӨАТ"
          value={fmtMntCompact(summary.reported.vat)}
          hint={summary.reported.cityTax !== 0 ? `НХАТ ${fmtMnt(summary.reported.cityTax)}` : "НӨАТ-ын тайлантай тулгана"}
          mono
        />
        <TaxStatCard
          label="Анхаарах"
          value={String(summary.attention)}
          hint="Алдаатай, илгээгээгүй, хүлээгдэж буй — панелаас дахин илгээнэ"
          tone={summary.attention > 0 ? "danger" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {sources.length > 1 && <FilterChips options={sourceChips} value={source} onChange={changeSource} />}
        <FilterChips options={statusChips} value={status} onChange={setStatus} />
        <div className="ml-auto flex items-center gap-2">
          {truncated && (
            <span className="text-xs text-[var(--ea-warning-fg)]">Мөр олон — топбарын периодоо нарийсгана уу</span>
          )}
          <Button variant="outline" size="sm" disabled={visible.length === 0} onClick={exportExcel}>
            Excel
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="document"
          title="Энэ хугацаанд eBarimt баримт алга"
          description="POS борлуулалт болон (тохиргоогоор асаасан бол) авлагын батлагдсан нэхэмжлэх eBarimt-д илгээгдэхэд энд жагсана. Топбараас өөр период сонгож болно."
          actions={[{ label: "eBarimt тохиргоо", href: "/inventory/pos-settings", icon: "settings" }]}
        />
      ) : (
        <DataGridDynamic<GridRow>
          ref={gridRef}
          rowData={visible}
          columnDefs={columns}
          getRowId={(params) => params.data.key}
          pinnedBottomRowData={pinnedBottom}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onRowDoubleClicked={(event) => {
            if (event.data && !event.data.pinned) openRow(event.data);
          }}
        />
      )}
    </div>
  );
}

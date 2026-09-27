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
  EBARIMT_TYPE_LABELS,
  summarizeEbarimtRows,
  type EbarimtDocumentRow,
  type EbarimtDocumentSource,
} from "@/lib/ebarimt/list-types";
import { downloadWorkbook } from "@/lib/excel/core";
import { fmtMntCompact } from "@/lib/format/money";
import { fmtMnt } from "@/lib/reports/balances";
import { EBARIMT_STATUS_TONES } from "@/lib/status";
import { openArapDocPanel, openPosSalePanel } from "@/lib/store/panel-store";
import { feedback } from "@/lib/ui/feedback";

type SourceFilter = "all" | EbarimtDocumentSource;
type StatusFilter = "all" | "attention" | EbarimtStatus;

const statusLabel = (status: string) => EBARIMT_STATUS_LABELS[status as EbarimtStatus] ?? status;
const typeLabel = (type: string | null) => (type ? EBARIMT_TYPE_LABELS[type] ?? type : "");
const isAttention = (status: string) => status === "failed" || status === "skipped" || status === "pending";

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
        status === "all" ? true : status === "attention" ? isAttention(row.status) : row.status === status
      ),
    [bySource, status]
  );
  const summary = useMemo(() => summarizeEbarimtRows(bySource), [bySource]);
  const visibleSummary = useMemo(() => summarizeEbarimtRows(visible), [visible]);

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

  const pinnedBottom = useMemo<GridRow[]>(
    () =>
      visible.length === 0
        ? []
        : [
            {
              key: "total",
              pinned: true,
              source: "pos",
              id: "",
              documentNo: `Нийт · ${visible.length}`,
              date: "",
              counterpartyName: null,
              customerTin: null,
              isReturn: false,
              ebarimtType: null,
              status: "",
              ebarimtId: null,
              ebarimtDate: null,
              total: visible.reduce((sum, row) => sum + row.total, 0),
              vat: visible.reduce((sum, row) => sum + row.vat, 0),
              cityTax: visible.reduce((sum, row) => sum + row.cityTax, 0),
              lastError: null,
            },
          ],
    [visible]
  );

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
              {p.data.isReturn && (
                <StatusBadge tone="warning" size="sm">
                  Буцаалт
                </StatusBadge>
              )}
            </span>
          ) : null,
      },
      {
        headerName: "Төрөл",
        field: "ebarimtType",
        width: 170,
        valueGetter: (p) => typeLabel(p.data?.ebarimtType ?? null),
        cellClass: "text-xs",
      },
      { headerName: "Харилцагч", field: "counterpartyName", minWidth: 170, flex: 1 },
      { headerName: "ТТД", field: "customerTin", width: 120, cellClass: "font-mono text-xs" },
      {
        headerName: "Нийт",
        field: "total",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
      },
      {
        headerName: "НӨАТ",
        field: "vat",
        width: 110,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => (Number(p.value) !== 0 ? fmtMnt(Number(p.value)) : ""),
      },
      {
        headerName: "НХАТ",
        field: "cityTax",
        width: 95,
        hide: !hasCityTax,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => (Number(p.value) !== 0 ? fmtMnt(Number(p.value)) : ""),
      },
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
          typeLabel(row.ebarimtType),
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
          label={`Илгээгдсэн · ${summary.byStatus.sent ?? 0}`}
          value={fmtMntCompact(summary.sentTotal)}
          hint={`${from} — ${to} · ТЕГ-д очсон цэвэр дүн (буцаалт хасагдсан)`}
          mono
        />
        <TaxStatCard
          label="Илгээгдсэн НӨАТ"
          value={fmtMntCompact(summary.sentVat)}
          hint={summary.sentCityTax !== 0 ? `НХАТ ${fmtMnt(summary.sentCityTax)}` : "НӨАТ-ын тайлантай тулгана"}
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
        {sources.length > 1 && <FilterChips options={sourceChips} value={source} onChange={setSource} />}
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
      {visible.length !== rows.length && visible.length > 0 && (
        <div className="text-xs text-[var(--ea-text-3)]">
          Шүүлтүүрт {visible.length} баримт · илгээгдсэн {fmtMnt(visibleSummary.sentTotal)} ₮
        </div>
      )}
    </div>
  );
}

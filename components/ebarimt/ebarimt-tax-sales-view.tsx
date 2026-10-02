"use client";

// Авлага → eBarimt → «ТЕГ-ийн бүх баримт» (docs/dev/ebarimt-tax-reconcile.md §8) —
// TPI-ээс өдөр бүр татсан танай ТТД дээрх БҮХ борлуулалтын баримт (нэхэмжлэх,
// төлөлт, ААН, иргэн), Entry-тэй ДДТД-аар тулгасан. «Entry-д алга» = өөр касс, ТЕГ-ийн
// апп, порталаас олгосон баримт. ЗӨВХӨН унших — давхар даралт → Entry-ийн эх баримт.

import { useMemo, useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { TaxStatCard } from "@/components/tax/tax-info";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterChips, type ChipOption } from "@/components/ui/tabs";
import { downloadWorkbook } from "@/lib/excel/core";
import {
  EBARIMT_TAX_SALE_KIND_LABELS,
  EBARIMT_TAX_SALE_MATCH_LABELS,
  type EbarimtTaxSaleKind,
  type EbarimtTaxSaleRow,
  type EbarimtTaxSalesSummary,
} from "@/lib/ebarimt/tax-sales";
import type { EbarimtTpiConnectionView } from "@/lib/ebarimt/tax-reconcile";
import { col } from "@/lib/grid/columnTypes";
import { fmtMnt } from "@/lib/reports/balances";
import { openArapDocPanel, openPosSalePanel } from "@/lib/store/panel-store";
import { feedback } from "@/lib/ui/feedback";

type Filter = "all" | "unmatched" | EbarimtTaxSaleKind;

const matchLabel = (row: EbarimtTaxSaleRow) => (row.match ? EBARIMT_TAX_SALE_MATCH_LABELS[row.match] : "Entry-д алга");

export function EbarimtTaxSalesView({
  connection,
  rows,
  summary,
  truncated,
  from,
  to,
}: {
  connection: EbarimtTpiConnectionView | null;
  rows: EbarimtTaxSaleRow[];
  summary: EbarimtTaxSalesSummary;
  truncated: boolean;
  from: string;
  to: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = useMemo(
    () =>
      rows.filter((row) => (filter === "all" ? true : filter === "unmatched" ? !row.match : row.kind === filter)),
    [rows, filter]
  );
  const chips = useMemo<ChipOption<Filter>[]>(
    () => [
      { value: "all", label: "Бүгд", count: summary.count },
      { value: "unmatched", label: "Entry-д алга", count: summary.unmatched, tone: "warning" as const },
      { value: "b2c", label: EBARIMT_TAX_SALE_KIND_LABELS.b2c, count: summary.byKind.b2c },
      { value: "b2b", label: EBARIMT_TAX_SALE_KIND_LABELS.b2b, count: summary.byKind.b2b },
      { value: "invoice", label: EBARIMT_TAX_SALE_KIND_LABELS.invoice, count: summary.byKind.invoice },
      { value: "payment", label: EBARIMT_TAX_SALE_KIND_LABELS.payment, count: summary.byKind.payment },
    ],
    [summary]
  );

  const columns = useMemo<ColDef<EbarimtTaxSaleRow>[]>(
    () => [
      { headerName: "Огноо", field: "taxDate", width: 150, cellClass: "font-mono text-xs" },
      { headerName: "ДДТД", field: "ddtd", width: 280, cellClass: "font-mono text-xs" },
      {
        headerName: "Төрөл",
        field: "kind",
        width: 150,
        valueGetter: (p) => (p.data ? EBARIMT_TAX_SALE_KIND_LABELS[p.data.kind] : ""),
        cellClass: "text-xs",
      },
      {
        headerName: "Худалдан авагч",
        colId: "buyer",
        minWidth: 180,
        flex: 1,
        valueGetter: (p) => (p.data ? [p.data.buyerRegNo, p.data.buyerName].filter(Boolean).join(" · ") : ""),
      },
      { headerName: "Касс", field: "posNo", width: 110, cellClass: "font-mono text-xs" },
      col<EbarimtTaxSaleRow>({ eaType: "readonly-money", headerName: "Нийт", field: "total", width: 125 }),
      col<EbarimtTaxSaleRow>({ eaType: "readonly-money", headerName: "НӨАТ", field: "vat", width: 115 }),
      col<EbarimtTaxSaleRow>({ eaType: "readonly-money", headerName: "НХАТ", field: "cityTax", width: 105 }),
      {
        headerName: "Entry",
        colId: "match",
        width: 170,
        valueGetter: (p) => (p.data ? matchLabel(p.data) : ""),
        cellRenderer: (p: ICellRendererParams<EbarimtTaxSaleRow>) =>
          p.data ? (
            <span className="flex h-full items-center">
              <StatusBadge tone={p.data.match ? "success" : "warning"} size="sm">
                {matchLabel(p.data)}
              </StatusBadge>
            </span>
          ) : null,
      },
      { headerName: "Entry-ийн дугаар", field: "entryDocumentNo", width: 160, cellClass: "font-mono text-xs" },
      { headerName: "Эх нэхэмжлэх", field: "parentDdtd", width: 200, cellClass: "font-mono text-xs" },
    ],
    []
  );

  async function exportExcel() {
    try {
      await downloadWorkbook({
        slug: `entry-teg-borluulalt-${from}-${to}`,
        sheetName: "ТЕГ борлуулалт",
        columns: [
          { header: "Огноо", width: 20 },
          { header: "ДДТД", width: 36 },
          { header: "Төрөл", width: 20 },
          { header: "Худалдан авагчийн регистр", width: 18 },
          { header: "Худалдан авагч", width: 28 },
          { header: "Касс", width: 12 },
          { header: "Нийт", width: 16, kind: "number" },
          { header: "НӨАТ", width: 14, kind: "number" },
          { header: "НХАТ", width: 12, kind: "number" },
          { header: "Entry", width: 20 },
          { header: "Entry-ийн дугаар", width: 18 },
          { header: "Эх нэхэмжлэх", width: 36 },
        ],
        rows: visible.map((row) => [
          row.taxDate,
          row.ddtd,
          EBARIMT_TAX_SALE_KIND_LABELS[row.kind],
          row.buyerRegNo,
          row.buyerName,
          row.posNo,
          row.total,
          row.vat,
          row.cityTax,
          matchLabel(row),
          row.entryDocumentNo ?? "",
          row.parentDdtd ?? "",
        ]),
      });
    } catch (caught) {
      feedback.error(caught instanceof Error ? caught.message : "Excel татаж чадсангүй");
    }
  }

  if (!connection) {
    return (
      <EmptyState
        icon="document"
        title="ТЕГ-ийн TPI холболт тохируулаагүй"
        description="Танай ТТД дээр ТЕГ-д бүртгэлтэй бүх борлуулалтын баримтыг өдөр бүр татахын тулд админ POS тохиргоо → eBarimt → «ТЕГ-ийн тулгалт»-д ITC нэвтрэлтээ холбоно."
        actions={[{ label: "TPI холболт", href: "/inventory/pos-settings?section=ebarimt", icon: "settings" }]}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <TaxStatCard
          label={`ТЕГ-ийн борлуулалт · ${summary.count - summary.byKind.payment} баримт`}
          value={fmtMnt(summary.total)}
          hint={`НӨАТ ${fmtMnt(summary.vat)} · НХАТ ${fmtMnt(summary.cityTax)} — нэхэмжлэхийн төлөлт давхар тоологдохгүй`}
        />
        <TaxStatCard
          label={`Entry-д алга · ${summary.unmatched}`}
          value={fmtMnt(summary.unmatchedTotal)}
          hint="Өөр касс, ТЕГ-ийн апп эсвэл порталаас олгосон баримт — Entry-ийн борлуулалтад бүртгэгдээгүй байж болно"
          tone={summary.unmatched > 0 ? "danger" : undefined}
        />
        <TaxStatCard
          label="ТЕГ-ээс татсан"
          value={connection.syncedThrough ?? "—"}
          hint={
            connection.lastSyncError
              ? `Сүүлийн оролдлого алдаатай: ${connection.lastSyncError.slice(0, 160)}`
              : `${connection.syncFrom ?? "—"} → ${connection.syncedThrough ?? "—"} · өдөр бүр 01:00–07:00`
          }
          tone={connection.lastSyncError ? "danger" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FilterChips options={chips} value={filter} onChange={setFilter} />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={visible.length === 0} onClick={exportExcel}>
            Excel
          </Button>
        </div>
      </div>
      {truncated && (
        <p className="text-xs text-[var(--ea-warning-fg)]">
          Мөр хэт олон — эхний хэсгийг харуулав. Топбарын периодыг нарийсгана уу.
        </p>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon="document"
          title={filter === "unmatched" ? "Entry-д алга баримт байхгүй" : "Энэ хугацаанд ТЕГ-ийн баримт алга"}
          description={`${from} — ${to}. ТЕГ-ээс татах нь өдөр бүр 01:00–07:00 цагт автоматаар явна.`}
        />
      ) : (
        <DataGridDynamic<EbarimtTaxSaleRow>
          rowData={visible}
          columnDefs={columns}
          getRowId={(params) => params.data.ddtd}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onRowDoubleClicked={(event) => {
            const row = event.data;
            if (!row) return;
            if (row.saleId) openPosSalePanel(row.saleId, row.entryDocumentNo ?? row.ddtd);
            else if (row.arapDocumentId)
              openArapDocPanel({ documentId: row.arapDocumentId, mode: "receivable", title: row.entryDocumentNo ?? row.ddtd });
          }}
        />
      )}
    </div>
  );
}

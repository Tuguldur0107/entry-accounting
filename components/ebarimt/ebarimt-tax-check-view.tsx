"use client";

// ТЕГ ↔ Entry нэхэмжлэхийн үлдэгдлийн тулгалт (docs/dev/ebarimt-tax-reconcile.md) —
// Авлага → eBarimt → «ТЕГ-ийн тулгалт». ТЕГ-ийн порталын «Үлдэгдэл»-ийг (TPI-ээс
// татсан) Entry-ийн авлагын үлдэгдэлтэй мөр бүрээр харуулна. Энд бичилт хийхгүй —
// ДАВХАР даралт → авлагын панель (төлөлтийн баримтыг дахин илгээх тэндээс).

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import type { DataGridHandle } from "@/components/datagrid/DataGrid";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { TaxStatCard } from "@/components/tax/tax-info";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterChips, type ChipOption } from "@/components/ui/tabs";
import { syncEbarimtTaxNow } from "@/lib/actions/ebarimt-tpi";
import {
  EBARIMT_TAX_CHECK_HINTS,
  EBARIMT_TAX_CHECK_LABELS,
  isTaxCheckProblem,
  type EbarimtTaxCheckRow,
  type EbarimtTpiConnectionView,
  type TaxCheckSummary,
} from "@/lib/ebarimt/tax-reconcile";
import { col } from "@/lib/grid/columnTypes";
import { EBARIMT_TAX_CHECK_TONES } from "@/lib/status";
import { openArapDocPanel } from "@/lib/store/panel-store";
import { feedback } from "@/lib/ui/feedback";

type Filter = "problems" | "pending" | "all";

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar", dateStyle: "short", timeStyle: "short" }) : "—";

export function EbarimtTaxCheckView({
  connection,
  rows,
  summary,
  canSync,
}: {
  connection: EbarimtTpiConnectionView | null;
  rows: EbarimtTaxCheckRow[];
  summary: TaxCheckSummary;
  canSync: boolean;
}) {
  const router = useRouter();
  const gridRef = useRef<DataGridHandle>(null);
  const [filter, setFilter] = useState<Filter>(summary.problems > 0 ? "problems" : "all");
  const [isSyncing, startSync] = useTransition();

  const pendingCount = useMemo(() => rows.filter((row) => row.check === "pending").length, [rows]);
  const visible = useMemo(
    () =>
      rows.filter((row) =>
        filter === "all" ? true : filter === "pending" ? row.check === "pending" : isTaxCheckProblem(row.check)
      ),
    [rows, filter]
  );
  const chips = useMemo<ChipOption<Filter>[]>(
    () => [
      { value: "problems", label: "Зөрүүтэй", count: summary.problems, tone: "warning" as const },
      { value: "pending", label: "Хүлээгдэж буй", count: pendingCount },
      { value: "all", label: "Бүгд", count: rows.length },
    ],
    [summary.problems, pendingCount, rows.length]
  );

  const columns = useMemo<ColDef<EbarimtTaxCheckRow>[]>(
    () => [
      { headerName: "Огноо", field: "invoiceDate", width: 110, cellClass: "font-mono text-xs" },
      { headerName: "Дугаар", field: "documentNo", width: 160, cellClass: "font-mono text-xs" },
      {
        headerName: "Эх",
        field: "source",
        width: 120,
        valueGetter: (p) => (p.data?.source === "pos" ? "POS «Зээлээр»" : "Авлагын нэхэмжлэх"),
        cellClass: "text-xs",
      },
      { headerName: "Харилцагч", field: "counterpartyName", minWidth: 160, flex: 1 },
      col<EbarimtTaxCheckRow>({ eaType: "readonly-money", headerName: "ТЕГ нийт", field: "taxTotal", width: 125 }),
      col<EbarimtTaxCheckRow>({ eaType: "readonly-money", headerName: "ТЕГ төлсөн", field: "taxPaid", width: 125 }),
      col<EbarimtTaxCheckRow>({ eaType: "readonly-money", headerName: "ТЕГ үлдэгдэл", field: "taxRemaining", width: 130 }),
      col<EbarimtTaxCheckRow>({ eaType: "readonly-money", headerName: "Entry үлдэгдэл", field: "entryRemaining", width: 130 }),
      col<EbarimtTaxCheckRow>({ eaType: "readonly-money", headerName: "Зөрүү", field: "difference", width: 115 }),
      col<EbarimtTaxCheckRow>({ eaType: "readonly-money", headerName: "Entry мэдэгдсэн", field: "reportedPaid", width: 130 }),
      {
        headerName: "Тулгалт",
        field: "check",
        width: 200,
        valueGetter: (p) => (p.data ? EBARIMT_TAX_CHECK_LABELS[p.data.check] : ""),
        tooltipValueGetter: (p) => (p.data ? EBARIMT_TAX_CHECK_HINTS[p.data.check] : undefined),
        cellRenderer: (p: ICellRendererParams<EbarimtTaxCheckRow>) =>
          p.data ? (
            <span className="flex h-full items-center">
              <StatusBadge tone={EBARIMT_TAX_CHECK_TONES[p.data.check] ?? "muted"} size="sm">
                {EBARIMT_TAX_CHECK_LABELS[p.data.check]}
              </StatusBadge>
            </span>
          ) : null,
      },
      { headerName: "ДДТД", field: "ddtd", width: 150, cellClass: "font-mono text-xs" },
      {
        headerName: "Тайлбар",
        colId: "hint",
        minWidth: 240,
        flex: 1,
        valueGetter: (p) => (p.data && p.data.check !== "ok" ? EBARIMT_TAX_CHECK_HINTS[p.data.check] : ""),
        tooltipValueGetter: (p) => (p.data ? EBARIMT_TAX_CHECK_HINTS[p.data.check] : undefined),
        cellClass: "text-xs text-[var(--ea-text-3)]",
      },
    ],
    []
  );

  function sync() {
    startSync(async () => {
      const { error, days, summary: synced, caughtUp } = await syncEbarimtTaxNow();
      if (error || !days || !synced) feedback.error(error ?? "ТЕГ-ээс татаж чадсангүй");
      else
        feedback.saved(
          `ТЕГ-ээс ${days.length} өдөр татав — зөрүүтэй ${synced.problems}${caughtUp ? "" : "; үлдсэнийг хуваарьт татлага үргэлжлүүлнэ"}`
        );
      router.refresh();
    });
  }

  if (!connection) {
    return (
      <EmptyState
        icon="document"
        title="ТЕГ-ийн TPI холболт тохируулаагүй"
        description="ТЕГ-ийн порталын нэхэмжлэхийн «Үлдэгдэл»-ийг Entry-ийн авлагатай автоматаар тулгахын тулд админ POS тохиргоо → eBarimt → «ТЕГ-ийн тулгалт»-д ITC нэвтрэлтээ холбоно."
        actions={[{ label: "TPI холболт", href: "/inventory/pos-settings?section=ebarimt", icon: "settings" }]}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <TaxStatCard
          label={`Тулгасан нэхэмжлэх · ${summary.checked}`}
          value={String(summary.problems)}
          hint="Зөрүүтэй — ТЕГ-ийн үлдэгдэл Entry-ийн авлагын үлдэгдэлтэй таарахгүй"
          tone={summary.problems > 0 ? "danger" : undefined}
        />
        <TaxStatCard
          label="ТЕГ-д бүртгэлийн эрсдэл"
          value={String(summary.danger)}
          hint="ТЕГ-д илүү (порталд гараар нэмсэн) эсвэл хүрээгүй төлөлт / нэхэмжлэх"
          tone={summary.danger > 0 ? "danger" : undefined}
        />
        <TaxStatCard
          label="Сүүлд ТЕГ-ээс татсан"
          value={formatTime(connection.lastSyncOkAt)}
          hint={
            connection.lastSyncError
              ? `Сүүлийн оролдлого алдаатай: ${connection.lastSyncError.slice(0, 160)}`
              : `${connection.syncFrom ?? "—"} → ${connection.syncedThrough ?? "—"} · өдөр бүр 06:00-аас`
          }
          tone={connection.lastSyncError ? "danger" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FilterChips options={chips} value={filter} onChange={setFilter} />
        <div className="ml-auto flex items-center gap-2">
          {canSync && (
            <Button variant="outline" size="sm" onClick={sync} disabled={isSyncing || !connection.isEnabled}>
              {isSyncing ? "Татаж байна…" : "ТЕГ-ээс одоо татах"}
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="document"
          title={filter === "problems" ? "Зөрүүтэй нэхэмжлэх алга" : "Мөр алга"}
          description="ТЕГ-д нэхэмжлэх болж бүртгэгдсэн авлага (АР нэхэмжлэх, POS «Зээлээр») энд тулгагдана."
        />
      ) : (
        <DataGridDynamic<EbarimtTaxCheckRow>
          ref={gridRef}
          rowData={visible}
          columnDefs={columns}
          getRowId={(params) => params.data.documentId}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onRowDoubleClicked={(event) => {
            const row = event.data;
            if (!row) return;
            openArapDocPanel({
              documentId: row.documentId,
              mode: "receivable",
              title: `${row.documentNo}${row.counterpartyName ? ` · ${row.counterpartyName}` : ""}`,
              navIds: visible.map((entry) => entry.documentId),
            });
          }}
        />
      )}
    </div>
  );
}

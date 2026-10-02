"use client";

// Өглөг → eBarimt — ХУДАЛДАН АВАЛТЫН eBarimt (ТЕГ, TPI getSaleListERP) ↔ өглөгийн
// нэхэмжлэх (docs/dev/ebarimt-tax-reconcile.md §7). Борлуулагч ТЕГ-ээс далдлагдсан тул
// тааруулалт ДДТД-ээр: холбоогүй баримтад дүн + огноогоор санал, «Холбох» нь хэрэглэгчийн
// үйлдэл (автомат биш). ДАВХАР даралт → өглөгийн панель (ДДТД-г тэндээс ч засна).

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import type { DataGridHandle } from "@/components/datagrid/DataGrid";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { TaxStatCard } from "@/components/tax/tax-info";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterChips, type ChipOption } from "@/components/ui/tabs";
import { linkApEbarimtReceipt, syncEbarimtPurchasesNow } from "@/lib/actions/ebarimt-tpi";
import {
  EBARIMT_PURCHASE_CHECK_HINTS,
  EBARIMT_PURCHASE_CHECK_LABELS,
  isPurchaseCheckProblem,
  type EbarimtPurchaseCheckRow,
} from "@/lib/ebarimt/purchase-reconcile";
import type { EbarimtTpiConnectionView, TaxCheckSummary } from "@/lib/ebarimt/tax-reconcile";
import { downloadWorkbook } from "@/lib/excel/core";
import { col } from "@/lib/grid/columnTypes";
import { fmtMnt } from "@/lib/reports/balances";
import { EBARIMT_PURCHASE_CHECK_TONES } from "@/lib/status";
import { openArapDocPanel } from "@/lib/store/panel-store";
import { feedback } from "@/lib/ui/feedback";

type Filter = "problems" | "receipts" | "all";

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar", dateStyle: "short", timeStyle: "short" }) : "—";

export function EbarimtPurchaseCheckView({
  connection,
  rows,
  summary,
  syncFrom,
  syncedThrough,
  canWrite,
  from,
  to,
}: {
  connection: EbarimtTpiConnectionView | null;
  rows: EbarimtPurchaseCheckRow[];
  summary: TaxCheckSummary;
  syncFrom: string | null;
  syncedThrough: string | null;
  canWrite: boolean;
  /** Харуулж буй муж (топбарын период / URL). */
  from: string;
  to: string;
}) {
  const router = useRouter();
  const gridRef = useRef<DataGridHandle>(null);
  const [filter, setFilter] = useState<Filter>(summary.problems > 0 ? "problems" : "all");
  const [linking, setLinking] = useState<EbarimtPurchaseCheckRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = useMemo(
    () =>
      rows.filter((row) =>
        filter === "all" ? true : filter === "receipts" ? row.kind === "receipt" : isPurchaseCheckProblem(row.check)
      ),
    [rows, filter]
  );
  const chips = useMemo<ChipOption<Filter>[]>(
    () => [
      { value: "problems", label: "Зөрүүтэй", count: summary.problems, tone: "warning" as const },
      { value: "receipts", label: "ТЕГ-ийн баримт", count: rows.filter((row) => row.kind === "receipt").length },
      { value: "all", label: "Бүгд", count: rows.length },
    ],
    [summary.problems, rows]
  );

  function openDocument(documentId: string, documentNo: string | null) {
    openArapDocPanel({ documentId, mode: "payable", title: documentNo ?? "Өглөг" });
  }

  function link(row: EbarimtPurchaseCheckRow, documentId: string) {
    if (!row.ddtd) return;
    startTransition(async () => {
      const result = await linkApEbarimtReceipt({ documentId, ddtd: row.ddtd });
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      feedback.saved("ДДТД өглөгт холбогдлоо");
      setLinking(null);
      router.refresh();
    });
  }

  function sync() {
    startTransition(async () => {
      const { error, ranges, receipts, summary: synced, caughtUp } = await syncEbarimtPurchasesNow();
      if (error || !ranges || !synced) feedback.error(error ?? "ТЕГ-ээс татаж чадсангүй");
      else
        feedback.saved(
          `ТЕГ-ээс худалдан авалтын ${receipts} баримт татав — зөрүүтэй ${synced.problems}${caughtUp ? "" : "; үлдсэнийг хуваарьт татлага үргэлжлүүлнэ"}`
        );
      router.refresh();
    });
  }

  async function exportExcel() {
    try {
      await downloadWorkbook({
        slug: `entry-teg-hudaldan-avalt-${from}-${to}`,
        sheetName: "ТЕГ худалдан авалт",
        columns: [
          { header: "Огноо", width: 12 },
          { header: "ТЕГ-ийн огноо", width: 20 },
          { header: "ДДТД", width: 36 },
          { header: "Борлуулагч (ТЕГ)", width: 22 },
          { header: "Төрөл", width: 16 },
          { header: "Эх", width: 12 },
          { header: "ТЕГ дүн", width: 16, kind: "number" },
          { header: "ТЕГ НӨАТ", width: 14, kind: "number" },
          { header: "ТЕГ НХАТ", width: 12, kind: "number" },
          { header: "Тулгалт", width: 22 },
          { header: "Өглөг", width: 16 },
          { header: "Нийлүүлэгч", width: 26 },
          { header: "Өглөгийн дүн", width: 16, kind: "number" },
          { header: "Өглөгийн НӨАТ", width: 14, kind: "number" },
        ],
        rows: visible.map((row) => [
          row.date,
          row.taxDate ?? "",
          row.ddtd ?? "",
          row.sellerName ?? "",
          row.receiptType ?? "",
          row.fromType ?? "",
          row.taxTotal,
          row.taxVat,
          row.taxCityTax,
          EBARIMT_PURCHASE_CHECK_LABELS[row.check],
          row.documentNo ?? "",
          row.counterpartyName ?? "",
          row.entryTotal,
          row.entryVat,
        ]),
      });
    } catch (caught) {
      feedback.error(caught instanceof Error ? caught.message : "Excel татаж чадсангүй");
    }
  }

  const columns = useMemo<ColDef<EbarimtPurchaseCheckRow>[]>(
    () => [
      { headerName: "Огноо", field: "date", width: 110, cellClass: "font-mono text-xs" },
      {
        headerName: "Тулгалт",
        field: "check",
        width: 190,
        valueGetter: (p) => (p.data ? EBARIMT_PURCHASE_CHECK_LABELS[p.data.check] : ""),
        tooltipValueGetter: (p) => (p.data ? EBARIMT_PURCHASE_CHECK_HINTS[p.data.check] : undefined),
        cellRenderer: (p: ICellRendererParams<EbarimtPurchaseCheckRow>) =>
          p.data ? (
            <span className="flex h-full items-center">
              <StatusBadge tone={EBARIMT_PURCHASE_CHECK_TONES[p.data.check] ?? "muted"} size="sm">
                {EBARIMT_PURCHASE_CHECK_LABELS[p.data.check]}
              </StatusBadge>
            </span>
          ) : null,
      },
      { headerName: "ДДТД", field: "ddtd", width: 160, cellClass: "font-mono text-xs" },
      { headerName: "Борлуулагч (ТЕГ)", field: "sellerName", width: 150, cellClass: "text-xs" },
      { headerName: "Төрөл", field: "receiptType", width: 130, cellClass: "text-xs" },
      { headerName: "Эх", field: "fromType", width: 100, cellClass: "text-xs" },
      col<EbarimtPurchaseCheckRow>({ eaType: "readonly-money", headerName: "ТЕГ дүн", field: "taxTotal", width: 120 }),
      col<EbarimtPurchaseCheckRow>({ eaType: "readonly-money", headerName: "ТЕГ НӨАТ", field: "taxVat", width: 110 }),
      col<EbarimtPurchaseCheckRow>({ eaType: "readonly-money", headerName: "ТЕГ НХАТ", field: "taxCityTax", width: 105 }),
      { headerName: "Өглөг", field: "documentNo", width: 140, cellClass: "font-mono text-xs" },
      { headerName: "Нийлүүлэгч", field: "counterpartyName", minWidth: 150, flex: 1 },
      col<EbarimtPurchaseCheckRow>({ eaType: "readonly-money", headerName: "Өглөгийн дүн", field: "entryTotal", width: 125 }),
      col<EbarimtPurchaseCheckRow>({ eaType: "readonly-money", headerName: "Өглөгийн НӨАТ", field: "entryVat", width: 125 }),
      {
        headerName: "Үйлдэл",
        colId: "action",
        width: 170,
        sortable: false,
        cellRenderer: (p: ICellRendererParams<EbarimtPurchaseCheckRow>) => {
          const row = p.data;
          if (!row) return null;
          if (row.check === "entry_missing" && canWrite)
            return (
              <span className="flex h-full items-center">
                <Button size="sm" variant="outline" onClick={() => setLinking(row)}>
                  {row.candidates.length ? `Холбох · санал ${row.candidates.length}` : "Санал алга"}
                </Button>
              </span>
            );
          if (row.documentId)
            return (
              <span className="flex h-full items-center">
                <Button size="sm" variant="outline" onClick={() => openDocument(row.documentId!, row.documentNo)}>
                  Өглөг нээх
                </Button>
              </span>
            );
          return null;
        },
      },
    ],
    [canWrite]
  );

  if (!connection) {
    return (
      <EmptyState
        icon="reconciliation"
        title="ТЕГ-ийн TPI холболт тохируулаагүй"
        description="Нийлүүлэгчдээс танай регистр дээр олгогдсон eBarimt-ийг ТЕГ-ээс автоматаар татаж өглөгийн нэхэмжлэх, авсан НӨАТ-тай тулгахын тулд админ Татвар → «ТЕГ-ийн холболт»-д ITC нэвтрэлтээ холбоно."
        actions={[{ label: "ТЕГ-ийн холболт", href: "/tax/ebarimt", icon: "settings", primary: true }]}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <TaxStatCard
          label={`Тулгасан · ${summary.checked}`}
          value={String(summary.problems)}
          hint="Зөрүүтэй — өглөгт бүртгэлгүй баримт, eBarimt-гүй НӨАТ-тай өглөг, дүн зөрсөн"
          tone={summary.problems > 0 ? "danger" : undefined}
        />
        <TaxStatCard
          label="Авсан НӨАТ-ын эрсдэл"
          value={String(summary.danger)}
          hint="Дүн зөрсөн эсвэл өглөгт бичсэн ДДТД ТЕГ-д алга"
          tone={summary.danger > 0 ? "danger" : undefined}
        />
        <TaxStatCard
          label="Сүүлд ТЕГ-ээс татсан"
          value={formatTime(connection.lastPurchaseSyncOkAt)}
          hint={
            connection.lastPurchaseSyncError
              ? `Сүүлийн оролдлого алдаатай: ${connection.lastPurchaseSyncError.slice(0, 160)}`
              : `${syncFrom ?? "—"} → ${syncedThrough ?? "—"} · өдөр бүр 01:00–07:00`
          }
          tone={connection.lastPurchaseSyncError ? "danger" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FilterChips options={chips} value={filter} onChange={setFilter} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-[var(--ea-text-3)]">
            {from} — {to}
          </span>
          <Button variant="outline" size="sm" disabled={visible.length === 0} onClick={exportExcel}>
            Excel
          </Button>
          {canWrite && (
            <Button variant="outline" size="sm" onClick={sync} disabled={isPending || !connection.isEnabled}>
              {isPending ? "Түр хүлээнэ үү…" : "ТЕГ-ээс одоо татах"}
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="reconciliation"
          title={filter === "problems" ? "Зөрүү алга" : "Мөр алга"}
          description="ТЕГ-ээс татсан худалдан авалтын баримт ба НӨАТ-тай өглөгийн нэхэмжлэх энд тулгагдана."
        />
      ) : (
        <DataGridDynamic<EbarimtPurchaseCheckRow>
          ref={gridRef}
          rowData={visible}
          columnDefs={columns}
          getRowId={(params) => params.data.key}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onRowDoubleClicked={(event) => {
            const row = event.data;
            if (row?.documentId) openDocument(row.documentId, row.documentNo);
            else if (row?.check === "entry_missing" && canWrite) setLinking(row);
          }}
        />
      )}

      <Dialog open={!!linking} onOpenChange={(open) => !open && setLinking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>ТЕГ-ийн баримтыг өглөгт холбох</DialogTitle>
            <DialogDescription>
              ДДТД {linking?.ddtd} · {linking?.date} · {linking ? fmtMnt(linking.taxTotal ?? 0) : ""} ₮ (НӨАТ{" "}
              {linking ? fmtMnt(linking.taxVat ?? 0) : ""} ₮). Борлуулагч ТЕГ-ээс далдлагдсан тул дүн, огноогоор санал
              болгов — тохирох өглөгийг сонгоно.
            </DialogDescription>
          </DialogHeader>
          {linking && linking.candidates.length > 0 ? (
            <div className="space-y-2">
              {linking.candidates.map((candidate) => (
                <button
                  key={candidate.documentId}
                  type="button"
                  disabled={isPending}
                  onClick={() => link(linking, candidate.documentId)}
                  className="flex w-full items-center justify-between rounded-md border border-[var(--ea-border)] px-3 py-2 text-left text-sm hover:bg-[var(--ea-hover-subtle)] disabled:opacity-60"
                >
                  <span>
                    <span className="font-mono text-xs">{candidate.documentNo}</span>
                    <span className="ml-2 text-[var(--ea-text-2)]">{candidate.counterpartyName ?? "—"}</span>
                  </span>
                  <span className="text-xs text-[var(--ea-text-3)]">
                    {candidate.date} · {fmtMnt(candidate.total)} ₮
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--ea-text-3)]">
              Ижил дүнтэй (±7 хоног), ДДТД холбоогүй өглөг олдсонгүй. Өглөгийн нэхэмжлэх үүсгээд панелийнх нь «Нийлүүлэгчийн
              eBarimt» талбарт энэ ДДТД-г бичнэ.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinking(null)}>
              Хаах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

// Өглөг → eBarimt → «Гаалийн мэдүүлэг» (docs/dev/ebarimt-tax-reconcile.md §10) —
// хуулийн этгээдийн гаалийн мэдүүлэг (developer портал 10.4) өдөр бүр татагдсан:
// гаалийн татвар, ОАТ, хураамж, импортын НӨАТ. ЗӨВХӨН унших — GL-д бичихгүй;
// импортын НӨАТ-ыг НӨАТ-ын тайлангийн оролтын НӨАТ-тай харьцуулахад.

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { TaxStatCard } from "@/components/tax/tax-info";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { syncEbarimtCustomsNow } from "@/lib/actions/ebarimt-tpi";
import { customsGoodsLabel, type EbarimtCustomsRow, type EbarimtCustomsSummary } from "@/lib/ebarimt/customs";
import type { EbarimtTpiConnectionView } from "@/lib/ebarimt/tax-reconcile";
import { downloadWorkbook } from "@/lib/excel/core";
import { col } from "@/lib/grid/columnTypes";
import { fmtMnt } from "@/lib/reports/balances";
import { feedback } from "@/lib/ui/feedback";

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar", dateStyle: "short", timeStyle: "short" }) : "—";

export function EbarimtCustomsView({
  connection,
  rows,
  summary,
  canWrite,
  from,
  to,
}: {
  connection: EbarimtTpiConnectionView | null;
  rows: EbarimtCustomsRow[];
  summary: EbarimtCustomsSummary;
  canWrite: boolean;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const columns = useMemo<ColDef<EbarimtCustomsRow>[]>(
    () => [
      { headerName: "Огноо", field: "date", width: 110, cellClass: "font-mono text-xs" },
      { headerName: "Мэдүүлгийн дугаар", field: "declarationNo", width: 190, cellClass: "font-mono text-xs" },
      {
        headerName: "Бараа",
        colId: "goods",
        minWidth: 220,
        flex: 1,
        valueGetter: (p) => (p.data ? customsGoodsLabel(p.data.items) : ""),
        tooltipValueGetter: (p) => (p.data ? p.data.items.map((item) => item.name).join("\n") : undefined),
      },
      { headerName: "Мөр", colId: "itemCount", width: 70, valueGetter: (p) => p.data?.items.length ?? 0, cellClass: "text-right" },
      col<EbarimtCustomsRow>({ eaType: "readonly-money", headerName: "Гаалийн татвар", field: "duty", width: 130 }),
      col<EbarimtCustomsRow>({ eaType: "readonly-money", headerName: "ОАТ", field: "excise", width: 110 }),
      col<EbarimtCustomsRow>({ eaType: "readonly-money", headerName: "Хураамж", field: "fee", width: 110 }),
      col<EbarimtCustomsRow>({ eaType: "readonly-money", headerName: "НӨАТ-ын суурь", field: "vatBase", width: 135 }),
      col<EbarimtCustomsRow>({ eaType: "readonly-money", headerName: "Импортын НӨАТ", field: "vat", width: 135 }),
    ],
    []
  );

  function sync() {
    startTransition(async () => {
      const { error, declarations, caughtUp } = await syncEbarimtCustomsNow();
      if (error) feedback.error(error);
      else feedback.saved(`Гаалийн ${declarations ?? 0} мэдүүлэг татав${caughtUp ? "" : " — үлдсэнийг хуваарьт татлага үргэлжлүүлнэ"}`);
      router.refresh();
    });
  }

  async function exportExcel() {
    try {
      await downloadWorkbook({
        slug: `entry-gaaliin-medvvleg-${from}-${to}`,
        sheetName: "Гаалийн мэдүүлэг",
        columns: [
          { header: "Огноо", width: 12 },
          { header: "Мэдүүлгийн дугаар", width: 22 },
          { header: "Бараа", width: 40 },
          { header: "Нэгжийн үнэ", width: 14, kind: "number" },
          { header: "Гаалийн татвар", width: 16, kind: "number" },
          { header: "ОАТ", width: 14, kind: "number" },
          { header: "Хураамж", width: 14, kind: "number" },
          { header: "НӨАТ-ын суурь", width: 16, kind: "number" },
          { header: "Импортын НӨАТ", width: 16, kind: "number" },
        ],
        // Барааны мөр бүр тусдаа (мэдүүлгийн дугаартай) — шүүх, нэгтгэхэд.
        rows: rows.flatMap((row) =>
          (row.items.length > 0 ? row.items : [{ name: "", unitPrice: null, duty: row.duty, excise: row.excise, fee: row.fee, vatBase: row.vatBase, vat: row.vat }]).map((item) => [
            row.date,
            row.declarationNo,
            item.name,
            item.unitPrice,
            item.duty,
            item.excise,
            item.fee,
            item.vatBase,
            item.vat,
          ])
        ),
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
        description="Гаалийн мэдүүлгийг ITC-ийн ижил нэвтрэлтээр татна — админ Татвар → «ТЕГ-ийн холболт»-д ITC нэвтрэлтээ холбоно."
        actions={[{ label: "ТЕГ-ийн холболт", href: "/tax/ebarimt", icon: "settings" }]}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {!connection.customsApiKey && (
        <p className="text-xs text-[var(--ea-warning-fg)]">
          Гаалийн мэдүүлгийн түлхүүр Entry-д тохируулагдаагүй байна — Entry багт хандана уу.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <TaxStatCard
          label={`Импортын НӨАТ · ${summary.count} мэдүүлэг`}
          value={fmtMnt(summary.vat)}
          hint={`НӨАТ-ын суурь ${fmtMnt(summary.vatBase)} — НӨАТ-ын тайлангийн оролтын НӨАТ-тай харьцуулна`}
        />
        <TaxStatCard
          label="Гаалийн татвар · ОАТ · хураамж"
          value={fmtMnt(summary.duty + summary.excise + summary.fee)}
          hint={`Гааль ${fmtMnt(summary.duty)} · ОАТ ${fmtMnt(summary.excise)} · хураамж ${fmtMnt(summary.fee)}`}
        />
        <TaxStatCard
          label="Сүүлд татсан"
          value={formatTime(connection.lastCustomsSyncOkAt)}
          hint={
            connection.lastCustomsSyncError
              ? `Сүүлийн оролдлого алдаатай: ${connection.lastCustomsSyncError.slice(0, 160)}`
              : `${connection.customsSyncFrom ?? "—"} → ${connection.customsSyncedThrough ?? "—"} · өдөр бүр 01:00–07:00`
          }
          tone={connection.lastCustomsSyncError ? "danger" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--ea-text-3)]">
          {from} — {to}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={exportExcel}>
            Excel
          </Button>
          {canWrite && (
            <Button variant="outline" size="sm" onClick={sync} disabled={isPending || !connection.isEnabled || !connection.customsApiKey}>
              {isPending ? "Татаж байна…" : "Одоо татах"}
            </Button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="document"
          title="Энэ хугацаанд гаалийн мэдүүлэг алга"
          description="Хуулийн этгээдийн импортын гаалийн мэдүүлэг өдөр бүр автоматаар татагдана."
        />
      ) : (
        <DataGridDynamic<EbarimtCustomsRow>
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => `${params.data.declarationNo}|${params.data.rawDate}`}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}
    </div>
  );
}

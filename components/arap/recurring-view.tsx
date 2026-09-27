"use client";

// Давтамжтай нэхэмжлэхийн жагсаалт (docs/dev/arap.md §5h). Шинээр нэмэх нь
// нэхэмжлэхийн панелийн «Давтамжтай болгох»-оор; давхар даралт → засах цонх.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ColDef } from "ag-grid-community";

import { EditRecurringDialog } from "@/components/arap/recurring-dialog";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { RecurringRow } from "@/lib/actions/ar-recurring";
import { RECURRING_STATUS_LABELS } from "@/lib/arap/recurring";
import { fmtMnt } from "@/lib/reports/balances";
import { RECURRING_STATUS_TONES } from "@/lib/status";

const toneOf = (row: RecurringRow): StatusTone =>
  row.lastError ? "danger" : (RECURRING_STATUS_TONES[row.status] ?? "muted");

const COLUMNS: ColDef<RecurringRow>[] = [
  { headerName: "Харилцагч", field: "counterpartyName", flex: 1, minWidth: 160 },
  { headerName: "Утга", field: "description", flex: 1, minWidth: 160 },
  {
    headerName: "Дүн (₮)",
    field: "totalAmount",
    width: 140,
    cellClass: "ag-right-aligned-cell font-mono",
    headerClass: "ag-right-aligned-header",
    valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
  },
  { headerName: "Хуваарь", field: "scheduleLabel", width: 200 },
  { headerName: "Дараагийнх", field: "nextRunDate", width: 130 },
  {
    headerName: "Горим",
    width: 170,
    valueGetter: (p) => (p.data ? `${p.data.autoPost ? "Шууд батална" : "Ноорог"}${p.data.sendEmail ? " + и-мэйл" : ""}` : ""),
  },
  { headerName: "Үүссэн", field: "runCount", width: 90, cellClass: "ag-right-aligned-cell font-mono", headerClass: "ag-right-aligned-header" },
  { headerName: "Сүүлийнх", field: "lastDocumentNo", width: 160 },
  {
    headerName: "Төлөв",
    field: "status",
    width: 130,
    cellRenderer: (p: { data?: RecurringRow }) =>
      p.data ? (
        <StatusBadge tone={toneOf(p.data)} size="sm">
          {p.data.lastError ? "Алдаатай" : RECURRING_STATUS_LABELS[p.data.status] ?? p.data.status}
        </StatusBadge>
      ) : null,
  },
];

export function RecurringView({ rows, error }: { rows: RecurringRow[] | null; error: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState<RecurringRow | null>(null);

  if (error || !rows)
    return (
      <div className="p-4">
        <EmptyState icon="warning" title="Давтамжтай нэхэмжлэх уншигдсангүй" description={error ?? "Хуудсаа шинэчилнэ үү"} />
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Давтамжтай нэхэмжлэх</h1>
        <p className="text-xs text-[var(--ea-text-3)]">
          Түрээс, захиалга, үйлчилгээний гэрээ — хуваарийн өдөр 09:00-оос шинэ нэхэмжлэх үүснэ (анхдагчаар НООРОГ).
          Шинээр нэмэх: Нэхэмжлэл → нэхэмжлэхээ нээгээд «Давтамжтай болгох».
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon="document"
          title="Давтамжтай нэхэмжлэх алга"
          description="Сар бүр ижил нэхэмжлэх гаргадаг бол тэр нэхэмжлэхийг нээж «Давтамжтай болгох» дарна."
        />
      ) : (
        <DataGridDynamic<RecurringRow>
          rowData={rows}
          columnDefs={COLUMNS}
          getRowId={(params) => params.data.id}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onRowDoubleClicked={(event) => event.data && setEditing(event.data)}
        />
      )}
      <EditRecurringDialog row={editing} onOpenChange={(open) => !open && setEditing(null)} onChanged={() => router.refresh()} />
    </div>
  );
}

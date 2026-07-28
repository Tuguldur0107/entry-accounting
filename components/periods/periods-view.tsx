"use client";

// Нягтлан бодох периодын хаалт. Бүртгэлгүй период = НЭЭЛТТЭЙ тул хүснэгтэд
// бичилттэй сарууд бүгд гарч ирнэ; хаасан сар л accounting_periods-д
// хадгалагдана.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { closePeriod, reopenPeriod, type PeriodRow } from "@/lib/actions/periods";
import { fmtPeriodCode } from "@/lib/periods/period";

const CLOSE_ERRORS: Record<string, string> = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "invalid-period": "Периодын код буруу байна.",
  "has-drafts":
    "Ноорог бичилт үлдсэн байна — хаагдсан периодод ноорог батлагдахгүй тул эхлээд батлах эсвэл устгана уу.",
};

export function PeriodsView({ periods }: { periods: PeriodRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [busyCode, setBusyCode] = useState<string | null>(null);

  function handleClose(row: PeriodRow) {
    void confirm({
      title: `${fmtPeriodCode(row.code)} период хаах`,
      description: `Хаасны дараа энэ сарын огноогоор журнал, өртгийн бичилт, буцаалт хийх боломжгүй болно. Дахин нээх боломжтой. (${row.voucherCount} журнал, ${row.movementCount} хөдөлгөөн)`,
      confirmText: "Хаах",
    }).then((ok) => {
      if (!ok) return;
      setBusyCode(row.code);
      startTransition(async () => {
        const result = await closePeriod(row.code);
        setBusyCode(null);
        if (!result.ok) {
          toast.error(CLOSE_ERRORS[result.code] ?? "Хаах амжилтгүй");
          return;
        }
        toast.success(`${fmtPeriodCode(row.code)} период хаагдлаа`);
        router.refresh();
      });
    });
  }

  function handleReopen(row: PeriodRow) {
    void confirm({
      title: `${fmtPeriodCode(row.code)} период дахин нээх`,
      description:
        "Дахин нээвэл энэ сарын огноогоор бичилт хийх боломжтой болно. Энэ үйлдэл бүртгэгдэнэ.",
      confirmText: "Дахин нээх",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      setBusyCode(row.code);
      startTransition(async () => {
        const result = await reopenPeriod(row.code);
        setBusyCode(null);
        if (!result.ok) {
          toast.error(CLOSE_ERRORS[result.code] ?? "Дахин нээх амжилтгүй");
          return;
        }
        toast.success(`${fmtPeriodCode(row.code)} период нээгдлээ`);
        router.refresh();
      });
    });
  }

  const columnDefs = useMemo<ColDef<PeriodRow>[]>(
    () => [
      {
        headerName: "Период",
        field: "code",
        width: 120,
        cellClass: "font-mono",
        valueFormatter: (params) => fmtPeriodCode(String(params.value ?? "")),
      },
      {
        headerName: "Хугацаа",
        width: 210,
        valueGetter: (params) =>
          params.data ? `${params.data.startDate} — ${params.data.endDate}` : "",
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 130,
        cellRenderer: (params: ICellRendererParams<PeriodRow>) => (
          <div className="flex h-full items-center">
            <StatusBadge
              tone={params.data?.status === "closed" ? "muted" : "success"}
            >
              {params.data?.status === "closed" ? "Хаагдсан" : "Нээлттэй"}
            </StatusBadge>
          </div>
        ),
      },
      {
        headerName: "Журнал",
        field: "voucherCount",
        width: 100,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "Ноорог",
        width: 100,
        valueGetter: (params) =>
          (params.data?.draftVoucherCount ?? 0) +
          (params.data?.draftCostEntryCount ?? 0),
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "Агуулахын хөдөлгөөн",
        field: "movementCount",
        width: 170,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "Хаасан",
        field: "closedAt",
        width: 150,
        cellClass: "font-mono text-xs text-[var(--ea-text-3)]",
      },
      {
        headerName: "",
        colId: "actions",
        width: 150,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<PeriodRow>) => {
          const row = params.data;
          if (!row) return null;
          const busy = isPending && busyCode === row.code;
          return (
            <div className="flex h-full items-center justify-end">
              {row.status === "closed" ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={busy}
                  onClick={() => handleReopen(row)}
                >
                  <LockOpen size={12} />
                  Дахин нээх
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={busy}
                  onClick={() => handleClose(row)}
                >
                  <Lock size={12} />
                  Хаах
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    // handleClose/handleReopen нь render бүрд шинэ функц ч гэсэн зөвхөн
    // товч дарахад л дуудагдана — deps-д оруулбал багана дахин бүтэх тул
    // React Compiler-ийн memo хамгаалалтыг эвдэнэ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPending, busyCode]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Нягтлан бодох период
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Бүртгэгдээгүй сар нээлттэй гэж тооцогдоно. Хаасан сарын огноогоор
          журнал, өртгийн бичилт, буцаалт хийх боломжгүй болно. Өртгийн
          жигнэсэн дундаж мөн энэ периодын хилээр тооцогдоно.
        </p>
      </div>

      {periods.length === 0 ? (
        <p className="rounded-md border border-[var(--ea-border)] px-3 py-8 text-center text-xs text-[var(--ea-text-4)]">
          Бичилт хийгдээгүй байна — хаах период алга.
        </p>
      ) : (
        <DataGridDynamic<PeriodRow>
          rowData={periods}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.code}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}

      {confirmDialog}
    </div>
  );
}

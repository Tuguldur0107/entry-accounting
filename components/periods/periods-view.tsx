"use client";

// Тайлант үеийн хаалт. Бүртгэлгүй тайлант үе = НЭЭЛТТЭЙ тул хүснэгтэд
// бичилттэй сарууд бүгд гарч ирнэ; бүртгэгдсэн (нээлттэй/хаагдсан) сар л
// accounting_periods-д хадгалагдана. Төлөвийг мөр бүрийн dropdown-оор
// сольдог; "Тайлант үе нэмэх" нь ирээдүйн/өнгөрсөн сарыг урьдчилан
// бүртгэнэ.

import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  closePeriod,
  createPeriod,
  reopenPeriod,
  type PeriodRow,
} from "@/lib/actions/periods";
import { fmtPeriodCode } from "@/lib/periods/period";

const ACTION_ERRORS: Record<string, string> = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "invalid-period": "Тайлант үеийн код буруу байна.",
  "has-drafts":
    "Ноорог бичилт үлдсэн байна — хаагдсан тайлант үед ноорог батлагдахгүй тул эхлээд батлах эсвэл устгана уу.",
  exists: "Энэ тайлант үе аль хэдийн бүртгэлтэй байна.",
};

const STATUS_META: Record<
  "open" | "closed",
  { label: string; dot: string }
> = {
  open: { label: "Нээлттэй", dot: "var(--ea-success)" },
  closed: { label: "Хаагдсан", dot: "var(--ea-text-4)" },
};

export function PeriodsView({ periods }: { periods: PeriodRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newCode, setNewCode] = useState(() =>
    new Date().toISOString().slice(0, 7)
  );

  function handleClose(row: PeriodRow) {
    void confirm({
      title: `${fmtPeriodCode(row.code)} тайлант үе хаах`,
      description: `Хаасны дараа энэ сарын огноогоор журнал, өртгийн бичилт, буцаалт хийх боломжгүй болно. Дахин нээх боломжтой. (${row.voucherCount} журнал, ${row.movementCount} хөдөлгөөн)`,
      confirmText: "Хаах",
    }).then((ok) => {
      if (!ok) return;
      setBusyCode(row.code);
      startTransition(async () => {
        const result = await closePeriod(row.code);
        setBusyCode(null);
        if (!result.ok) {
          toast.error(ACTION_ERRORS[result.code] ?? "Хаах амжилтгүй");
          return;
        }
        toast.success(`${fmtPeriodCode(row.code)} тайлант үе хаагдлаа`);
        router.refresh();
      });
    });
  }

  function handleReopen(row: PeriodRow) {
    void confirm({
      title: `${fmtPeriodCode(row.code)} тайлант үе дахин нээх`,
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
          toast.error(ACTION_ERRORS[result.code] ?? "Дахин нээх амжилтгүй");
          return;
        }
        toast.success(`${fmtPeriodCode(row.code)} тайлант үе нээгдлээ`);
        router.refresh();
      });
    });
  }

  function handleStatusChange(row: PeriodRow, next: string | null) {
    if (!next || next === row.status) return;
    if (next === "closed") handleClose(row);
    else handleReopen(row);
  }

  function handleCreate() {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(newCode)) {
      toast.error("Сар сонгоно уу (ЖЖЖЖ-СС)");
      return;
    }
    startTransition(async () => {
      const result = await createPeriod(newCode);
      if (!result.ok) {
        toast.error(ACTION_ERRORS[result.code] ?? "Нэмэх амжилтгүй");
        return;
      }
      toast.success(`${fmtPeriodCode(newCode)} тайлант үе бүртгэгдлээ`);
      setAddOpen(false);
      router.refresh();
    });
  }

  const columnDefs = useMemo<ColDef<PeriodRow>[]>(
    () => [
      {
        headerName: "Тайлант үе",
        field: "code",
        width: 130,
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
        width: 160,
        cellRenderer: (params: ICellRendererParams<PeriodRow>) => {
          const row = params.data;
          if (!row) return null;
          const busy = isPending && busyCode === row.code;
          const meta = STATUS_META[row.status] ?? STATUS_META.open;
          const isOpen = row.status !== "closed";
          return (
            <div className="flex h-full items-center">
              <Select
                value={row.status}
                onValueChange={(value) =>
                  handleStatusChange(row, value as string | null)
                }
                disabled={busy}
              >
                {/* Trigger нь StatusBadge шиг өнгөт pill — сонгосон төлөв
                    мөрийн өгөгдлөөс шууд гарна (SelectValue-ийн түүхий
                    open/closed утга харагдахгүй). */}
                <SelectTrigger
                  size="sm"
                  className="w-[124px] rounded-full border-transparent text-xs font-medium"
                  style={{
                    background: isOpen
                      ? "color-mix(in srgb, var(--ea-success) 14%, transparent)"
                      : "color-mix(in srgb, var(--ea-text-4) 16%, transparent)",
                    color: isOpen
                      ? "var(--ea-success-fg)"
                      : "var(--ea-text-3)",
                  }}
                >
                  <span className="flex flex-1 items-center gap-1.5 text-left">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: meta.dot }}
                    />
                    {meta.label}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {(["open", "closed"] as const).map((status) => (
                    <SelectItem key={status} value={status}>
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: STATUS_META[status].dot }}
                      />
                      {STATUS_META[status].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        },
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
    ],
    // handleStatusChange нь render бүрд шинэ функц ч гэсэн зөвхөн сонголт
    // хийхэд л дуудагдана — deps-д оруулбал багана дахин бүтэх тул React
    // Compiler-ийн memo хамгаалалтыг эвдэнэ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPending, busyCode]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Тайлант үе
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Бүртгэгдээгүй сар нээлттэй гэж тооцогдоно. Хаасан сарын огноогоор
            журнал, өртгийн бичилт, буцаалт хийх боломжгүй болно. Өртгийн
            жигнэсэн дундаж мөн энэ тайлант үеийн хилээр тооцогдоно.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Icon name="add" />
          Тайлант үе нэмэх
        </Button>
      </div>

      {periods.length === 0 ? (
        <p className="rounded-md border border-[var(--ea-border)] px-3 py-8 text-center text-xs text-[var(--ea-text-4)]">
          Тайлант үе бүртгэгдээгүй байна — бичилт хийхэд сарууд энд автоматаар
          гарч ирнэ, эсвэл &quot;Тайлант үе нэмэх&quot;-ээр урьдчилан
          бүртгэнэ.
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

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Шинэ тайлант үе нэмэх</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="new-period-month">Сар</Label>
            <Input
              id="new-period-month"
              type="month"
              value={newCode}
              onChange={(event) => setNewCode(event.target.value)}
            />
            <p className="text-xs text-[var(--ea-text-3)]">
              Нээлттэй төлөвтэй бүртгэгдэнэ — дараа нь төлөвийн сонголтоор
              хааж болно.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Болих
            </Button>
            <Button onClick={handleCreate} disabled={isPending}>
              Нэмэх
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}

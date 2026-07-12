"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AlertTriangle, Calculator, FileClock, Scale } from "lucide-react";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runCosting } from "@/lib/actions/costing";
import type { PendingValuationView } from "@/lib/inventory/types";
import { fmtMnt } from "@/lib/reports/balances";

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

interface Props {
  pending: PendingValuationView[];
  draftEntryCount: number;
  postedEntryCount: number;
  clearingBalance: number;
  tieOutDifference: number;
  /** Серверийн (UTC+8) өнөөдөр — клиентийн цагийн бүсээс хамаарахгүй. */
  defaultAsOf: string;
}

// Өртгийн модулийн самбар: үнэлгээ хүлээгдэж буй хөдөлгөөнүүдэд нэгж өртөг
// оноож costing run ажиллуулна. Клирингийн үлдэгдэл 0 рүү тэмүүлэх ёстой —
// үнэлэгдээгүй орлого/ирээгүй нэхэмжлэхийн хэмжүүр.
export function CostingDashboard({
  pending,
  draftEntryCount,
  postedEntryCount,
  clearingBalance,
  tieOutDifference,
  defaultAsOf,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [asOfDate, setAsOfDate] = useState(defaultAsOf);
  // Ref (state биш): keystroke бүрд grid-ийн columnDefs дахин үүсэж input
  // focus-оо алдахаас сэргийлнэ — uncontrolled input + ref бичилт.
  const costInputsRef = useRef<Record<string, string>>({});

  const receiptsNeedingCost = useMemo(
    () => pending.filter((p) => p.reason === "unit-cost-required"),
    [pending]
  );
  const blockedCount = pending.length - receiptsNeedingCost.length;

  function handleRun() {
    const receiptCosts: Record<string, number> = {};
    for (const [movementId, raw] of Object.entries(costInputsRef.current)) {
      const value = Number(raw.replaceAll(",", ""));
      if (Number.isFinite(value) && value >= 0 && raw.trim() !== "")
        receiptCosts[movementId] = value;
    }
    startTransition(async () => {
      try {
        const result = await runCosting({ asOfDate, receiptCosts });
        costInputsRef.current = {};
        router.refresh();
        if (result.created === 0 && result.pending.length === 0)
          toast.info("Үнэлэх хөдөлгөөн алга — бүгд үнэлэгдсэн");
        else if (result.pending.length === 0)
          toast.success(`${result.created} ноорог бичилт үүслээ`);
        else
          toast.warning(
            `${result.created} бичилт үүсэж, ${result.pending.length} хөдөлгөөн үнэ хүлээж байна`
          );
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Costing run амжилтгүй"
        );
      }
    });
  }

  const pendingColumns = useMemo<ColDef<PendingValuationView>[]>(
    () => [
      { headerName: "Огноо", field: "date", width: 110, cellClass: "font-mono text-xs" },
      {
        headerName: "Хөдөлгөөн",
        field: "documentNo",
        width: 180,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Бараа", field: "itemLabel", minWidth: 180, flex: 1 },
      {
        headerName: "Тоо",
        field: "quantity",
        width: 110,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.data ? `${fmtQty(params.data.quantity)} ${params.data.unit}` : "",
      },
      {
        headerName: "Нэгж өртөг (MNT)",
        colId: "unitCost",
        width: 170,
        sortable: false,
        filter: false,
        cellClass: "flex items-center",
        cellRenderer: (params: ICellRendererParams<PendingValuationView>) => {
          const row = params.data;
          if (!row) return null;
          if (row.reason === "blocked-by-unvalued-receipt")
            return (
              <span className="text-[11px] text-[var(--ea-text-4)]">
                өмнөх орлого үнэлэгдэхийг хүлээнэ
              </span>
            );
          return (
            <input
              type="number"
              min="0"
              step="0.0001"
              placeholder="0.00"
              className="h-7 w-full rounded border border-[var(--ea-border-strong)] bg-[var(--ea-surface)] px-2 font-mono text-xs outline-none focus:border-[var(--ea-primary)]"
              defaultValue={costInputsRef.current[row.movementId] ?? ""}
              onChange={(event) => {
                costInputsRef.current[row.movementId] = event.target.value;
              }}
            />
          );
        },
      },
    ],
    []
  );

  const metrics = [
    {
      label: "Үнэлгээ хүлээгдэж буй",
      value: String(pending.length),
      icon: Calculator,
      color: pending.length > 0 ? "var(--ea-warning)" : "var(--ea-success)",
      href: undefined as string | undefined,
    },
    {
      label: "Ноорог бичилт",
      value: String(draftEntryCount),
      icon: FileClock,
      color: "var(--ea-warning)",
      href: "/costing/entries?status=draft",
    },
    {
      label: "Клирингийн үлдэгдэл (14000099)",
      value: fmtMnt(clearingBalance),
      icon: Scale,
      color:
        Math.abs(clearingBalance) > 0.01 ? "var(--ea-warning)" : "var(--ea-success)",
      href: undefined,
    },
    {
      label: "GL зөрүү (14-данс)",
      value: fmtMnt(tieOutDifference),
      icon: AlertTriangle,
      color:
        Math.abs(tieOutDifference) > 0.01 ? "var(--ea-danger)" : "var(--ea-success)",
      href: "/costing/reports",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Өртгийн хяналт
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Баталсан хөдөлгөөнийг үнэлж, журналын ноорог үүсгэнэ ·{" "}
            {postedEntryCount} батлагдсан бичилт
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="h-8 w-40"
            value={asOfDate}
            onChange={(event) => setAsOfDate(event.target.value)}
          />
          <Button size="sm" onClick={handleRun} disabled={isPending}>
            <Calculator />
            Costing run
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-2 border-y border-[var(--ea-border)] lg:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const body = (
            <>
              <div
                className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--ea-bg-2)]"
                style={{ color: metric.color }}
              >
                <Icon size={16} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[11px] text-[var(--ea-text-3)]">
                  {metric.label}
                </div>
                <div className="mt-0.5 truncate font-mono text-base font-semibold text-[var(--ea-text-1)]">
                  {metric.value}
                </div>
              </div>
            </>
          );
          const cellClass =
            "flex min-w-0 items-center gap-3 border-b border-r border-[var(--ea-border)] px-4 py-4 last:border-r-0 lg:border-b-0";
          return metric.href ? (
            <Link
              key={metric.label}
              href={metric.href}
              className={`${cellClass} transition-colors hover:bg-[var(--ea-bg-2)]`}
              style={{ textDecoration: "none" }}
            >
              {body}
            </Link>
          ) : (
            <div key={metric.label} className={cellClass}>
              {body}
            </div>
          );
        })}
      </section>

      <section className="min-w-0">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
            Үнэлгээ хүлээгдэж буй хөдөлгөөн
          </h2>
          {receiptsNeedingCost.length > 0 && (
            <span className="text-[11px] text-[var(--ea-text-3)]">
              Орлогод нэгж өртөг оруулаад Costing run дарна
              {blockedCount > 0 && ` · ${blockedCount} блоклогдсон`}
            </span>
          )}
        </div>
        {pending.length === 0 ? (
          <div className="flex min-h-40 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
            Бүх баталсан хөдөлгөөн үнэлэгдсэн ✓
          </div>
        ) : (
          <DataGridDynamic<PendingValuationView>
            rowData={pending}
            columnDefs={pendingColumns}
            getRowId={(params) => params.data.movementId}
            height={Math.min(480, 86 + pending.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )}
      </section>
    </div>
  );
}

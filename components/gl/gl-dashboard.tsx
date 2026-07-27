"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { BookOpen, FileClock, Landmark, Scale } from "lucide-react";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

export type GlRecentVoucherRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  status: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Бичигдсэн",
  reversed: "Буцаагдсан",
};

interface Props {
  postedCount: number;
  draftCount: number;
  monthLabel: string; // YYYY-MM
  monthTotal: number;
  totalDebit: number;
  totalCredit: number;
  accountCount: number;
  recent: GlRecentVoucherRow[];
}

// GL хяналтын самбар: журналын тоо/төлөв, энэ сарын эргэлт, нийт тэнцэл,
// сүүлийн журналууд. Бичилт нэмэх биш — хяналтын нэгдсэн зураг.
export function GlDashboard({
  postedCount,
  draftCount,
  monthLabel,
  monthTotal,
  totalDebit,
  totalCredit,
  accountCount,
  recent,
}: Props) {
  const router = useRouter();
  const balanced = Math.abs(totalDebit - totalCredit) <= 0.01;

  const columns = useMemo<ColDef<GlRecentVoucherRow>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "date",
        width: 110,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Утга", field: "description", minWidth: 240, flex: 1 },
      {
        headerName: "Дүн",
        field: "amount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 120,
        valueGetter: (params) => STATUS_LABELS[params.data?.status ?? ""] ?? "",
        cellRenderer: (params: ICellRendererParams<GlRecentVoucherRow>) => {
          const status = params.data?.status ?? "";
          return (
            <div className="flex h-full items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    status === "posted"
                      ? "var(--ea-success)"
                      : status === "draft"
                        ? "var(--ea-warning)"
                        : "var(--ea-text-4)",
                }}
              />
              <span className="text-xs">{STATUS_LABELS[status] ?? status}</span>
            </div>
          );
        },
      },
    ],
    []
  );

  const metrics = [
    {
      label: `Энэ сарын эргэлт (${monthLabel})`,
      value: fmtMnt(monthTotal),
      icon: BookOpen,
      color: "var(--ea-primary)",
      href: "/gl/journal",
    },
    {
      label: "Бичигдсэн журнал",
      value: String(postedCount),
      icon: Scale,
      color: "var(--ea-success)",
      href: "/gl/journal",
    },
    {
      label: "Ноорог журнал",
      value: String(draftCount),
      icon: FileClock,
      color: draftCount > 0 ? "var(--ea-warning)" : "var(--ea-success)",
      href: "/gl/journal?status=draft",
    },
    {
      label: "Идэвхтэй данс",
      value: String(accountCount),
      icon: Landmark,
      color: "var(--ea-text-3)",
      href: "/settings/gl",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Ерөнхий журналын хяналт
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Журналын урсгал, тэнцлийн байдал — дэлгэрэнгүй нь Журналын жагсаалт
            болон Тайлан хэсэгт
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
            balanced
              ? "border-[var(--ea-success)]/40 text-[var(--ea-success)]"
              : "border-[var(--ea-danger)]/40 text-[var(--ea-danger)]"
          )}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: balanced ? "var(--ea-success)" : "var(--ea-danger)",
            }}
          />
          {balanced
            ? `Тэнцсэн · Дт=Кт ${fmtMnt(totalDebit)}`
            : `Зөрүүтэй · ${fmtMnt(totalDebit - totalCredit)}`}
        </span>
      </div>

      <section className="grid grid-cols-2 border-y border-[var(--ea-border)] lg:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Link
              key={metric.label}
              href={metric.href}
              className="flex min-w-0 items-center gap-3 border-b border-r border-[var(--ea-border)] px-4 py-4 transition-colors last:border-r-0 hover:bg-[var(--ea-bg-2)] lg:border-b-0"
              style={{ textDecoration: "none" }}
            >
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
            </Link>
          );
        })}
      </section>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
          Сүүлийн журналууд
        </h2>
        {recent.length === 0 ? (
          <div className="flex min-h-40 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
            Журнал бичигдээгүй байна — Журналын жагсаалтаас шинэ журнал үүсгэнэ
          </div>
        ) : (
          <DataGridDynamic<GlRecentVoucherRow>
            rowData={recent}
            columnDefs={columns}
            getRowId={(params) => params.data.id}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
            onRowClicked={() => router.push("/gl/journal")}
          />
        )}
      </section>
    </div>
  );
}

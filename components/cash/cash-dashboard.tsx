"use client";

import { useMemo } from "react";
import type { ColDef } from "ag-grid-community";
import { ArrowDownLeft, ArrowUpRight, FileClock, WalletCards } from "lucide-react";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import type { CashAccountView, CashDocumentView } from "@/lib/cash/types";
import { fmtMnt } from "@/lib/reports/balances";

interface Props {
  accounts: CashAccountView[];
  recentDocuments: CashDocumentView[];
  summary: {
    totalMnt: number;
    todayReceipts: number;
    todayPayments: number;
    draftCount: number;
  };
}

const typeLabels: Record<string, string> = {
  receipt: "Орлого",
  payment: "Зарлага",
  transfer: "Шилжүүлэг",
};

const statusLabels: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  reversed: "Буцаагдсан",
};

export function CashDashboard({
  accounts,
  recentDocuments,
  summary,
}: Props) {
  const accountColumns = useMemo<ColDef<CashAccountView>[]>(
    () => [
      { headerName: "Данс", field: "name", minWidth: 180, flex: 1 },
      {
        headerName: "Төрөл",
        field: "accountType",
        width: 100,
        valueGetter: (params) =>
          params.data?.accountType === "bank" ? "Банк" : "Касс",
      },
      { headerName: "Валют", field: "currency", width: 90 },
      {
        headerName: "Үлдэгдэл",
        field: "balance",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Төлөв",
        field: "isActive",
        width: 100,
        valueGetter: (params) => (params.data?.isActive ? "Идэвхтэй" : "Идэвхгүй"),
      },
    ],
    []
  );

  const documentColumns = useMemo<ColDef<CashDocumentView>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "date",
        width: 110,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Баримтын №",
        field: "documentNo",
        minWidth: 180,
      },
      {
        headerName: "Төрөл",
        field: "documentType",
        width: 110,
        valueGetter: (params) =>
          typeLabels[params.data?.documentType ?? ""] ?? "",
      },
      {
        headerName: "Утга",
        field: "description",
        minWidth: 180,
        flex: 1,
      },
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
        valueGetter: (params) =>
          statusLabels[params.data?.status ?? ""] ?? "",
      },
    ],
    []
  );

  const metrics = [
    {
      label: "MNT нийт үлдэгдэл",
      value: fmtMnt(summary.totalMnt),
      icon: WalletCards,
      color: "var(--ea-primary)",
    },
    {
      label: "Өнөөдрийн орлого",
      value: fmtMnt(summary.todayReceipts),
      icon: ArrowDownLeft,
      color: "var(--ea-success)",
    },
    {
      label: "Өнөөдрийн зарлага",
      value: fmtMnt(summary.todayPayments),
      icon: ArrowUpRight,
      color: "var(--ea-danger)",
    },
    {
      label: "Батлах ноорог",
      value: String(summary.draftCount),
      icon: FileClock,
      color: "var(--ea-warning)",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Cash Management
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Касс, банкны үлдэгдэл болон баталгаажуулалтын хяналт
        </p>
      </div>

      <section className="grid grid-cols-2 border-y border-[var(--ea-border)] lg:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.label}
              className="flex min-w-0 items-center gap-3 border-b border-r border-[var(--ea-border)] px-4 py-4 last:border-r-0 lg:border-b-0"
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
            </div>
          );
        })}
      </section>

      <section className="grid min-h-0 gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <div className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
            Дансны үлдэгдэл
          </h2>
          {accounts.length === 0 ? (
            <EmptyState text="Cash данс үүсгээгүй байна" />
          ) : (
            <DataGridDynamic<CashAccountView>
              rowData={accounts}
              columnDefs={accountColumns}
              getRowId={(params) => params.data.id}
              height={Math.min(440, 84 + accounts.length * 38)}
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
            />
          )}
        </div>

        <div className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
            Сүүлийн гүйлгээ
          </h2>
          {recentDocuments.length === 0 ? (
            <EmptyState text="Cash гүйлгээ байхгүй" />
          ) : (
            <DataGridDynamic<CashDocumentView>
              rowData={recentDocuments}
              columnDefs={documentColumns}
              getRowId={(params) => params.data.id}
              height={Math.min(440, 84 + recentDocuments.length * 38)}
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
            />
          )}
        </div>
      </section>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-44 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
      {text}
    </div>
  );
}


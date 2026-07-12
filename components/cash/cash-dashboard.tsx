"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import {
  AlertTriangle,
  FileClock,
  HelpCircle,
  WalletCards,
} from "lucide-react";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CashDocumentView,
  CashHealthRow,
  CashHealthStatus,
} from "@/lib/cash/types";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

interface Props {
  healthRows: CashHealthRow[];
  recentDocuments: CashDocumentView[];
  summary: {
    totalMnt: number;
    todayReceipts: number;
    todayPayments: number;
    draftCount: number;
    issueCount: number;
    negativeCount: number;
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

const healthLabels: Record<CashHealthStatus, string> = {
  balanced: "Тэнцсэн",
  negative: "Хасах үлдэгдэл",
  "cash-gl-diff": "GL зөрүүтэй",
  "bank-cash-diff": "Хуулга зөрүүтэй",
  "no-statement": "Хуулга дутуу",
  "missing-rate": "Ханш дутуу",
  "stale-statement": "Хуулга хуучин",
};

const healthTone: Record<CashHealthStatus, string> = {
  balanced: "text-[var(--ea-success-fg)]",
  negative: "text-[var(--ea-danger-fg)]",
  "cash-gl-diff": "text-[var(--ea-danger-fg)]",
  "bank-cash-diff": "text-[var(--ea-danger-fg)]",
  "no-statement": "text-[var(--ea-warning-fg)]",
  "missing-rate": "text-[var(--ea-warning-fg)]",
  "stale-statement": "text-[var(--ea-warning-fg)]",
};

export function CashDashboard({
  healthRows,
  recentDocuments,
  summary,
}: Props) {
  const [explainRow, setExplainRow] = useState<CashHealthRow | null>(null);

  const orderedHealthRows = useMemo(() => {
    const rank: Record<CashHealthStatus, number> = {
      negative: 0,
      "cash-gl-diff": 1,
      "bank-cash-diff": 2,
      "missing-rate": 3,
      "no-statement": 4,
      "stale-statement": 5,
      balanced: 6,
    };
    return [...healthRows].sort((a, b) => {
      const byRank = rank[a.status] - rank[b.status];
      if (byRank !== 0) return byRank;
      return a.accountName.localeCompare(b.accountName);
    });
  }, [healthRows]);

  const healthColumns = useMemo<ColDef<CashHealthRow>[]>(
    () => [
      {
        headerName: "Данс",
        field: "accountName",
        minWidth: 190,
        flex: 1,
        cellRenderer: (params: ICellRendererParams<CashHealthRow>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <div className="flex h-full min-w-0 items-center gap-2">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  row.status === "balanced"
                    ? "bg-[var(--ea-success)]"
                    : row.status === "negative" ||
                        row.status === "cash-gl-diff" ||
                        row.status === "bank-cash-diff"
                      ? "bg-[var(--ea-danger)]"
                      : "bg-[var(--ea-warning)]"
                )}
              />
              <span className="truncate">{row.accountName}</span>
            </div>
          );
        },
      },
      {
        headerName: "Төрөл",
        field: "accountType",
        width: 92,
        valueGetter: (params) =>
          params.data?.accountType === "bank" ? "Банк" : "Касс",
      },
      { headerName: "Валют", field: "currency", width: 90 },
      {
        headerName: "Дотоод бүртгэл",
        field: "cashBalance",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "GL",
        field: "glBalance",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Хуулга",
        field: "bankBalance",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.value == null ? "—" : fmtMnt(Number(params.value)),
      },
      {
        headerName: "Бүртгэл-GL",
        field: "cashToGlDifference",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.value == null ? "—" : fmtMnt(Number(params.value)),
      },
      {
        headerName: "Банк-Бүртгэл",
        field: "bankToCashDifference",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.value == null ? "—" : fmtMnt(Number(params.value)),
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 150,
        pinned: "right",
        cellRenderer: (params: ICellRendererParams<CashHealthRow>) => {
          const status = params.data?.status;
          if (!status) return null;
          return (
            <span className={cn("text-xs font-semibold", healthTone[status])}>
              {healthLabels[status]}
            </span>
          );
        },
      },
      {
        headerName: "Алхам",
        field: "actionLabel",
        minWidth: 190,
        pinned: "right",
        flex: 1,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<CashHealthRow>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <div className="flex h-full items-center gap-2">
              {row.status === "negative" && (
                <button
                  type="button"
                  onClick={() => setExplainRow(row)}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--ea-border)] px-2 text-xs text-[var(--ea-text-2)] hover:bg-[var(--ea-bg-2)]"
                >
                  <HelpCircle size={13} />
                  Яагаад?
                </button>
              )}
              <Link
                href={row.actionHref}
                className="truncate text-xs font-medium text-[var(--ea-primary)] hover:underline"
              >
                {row.actionLabel}
              </Link>
            </div>
          );
        },
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
        // Same FX-aware display as the transactions grid: a GL-derived FX
        // draft carries the rate-unknown sentinel (amount 0) — show its MNT
        // base figure instead of a misleading 0.
        valueFormatter: (params) => {
          const document = params.data;
          if (!document) return fmtMnt(Number(params.value ?? 0));
          if (document.currency === "MNT") return fmtMnt(document.amount);
          if (document.exchangeRate > 0 && document.amount > 0)
            return `${document.amount.toLocaleString("en-US")} ${document.currency}`;
          return `${fmtMnt(document.baseAmount)} · ханш?`;
        },
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
      label: "Асуудалтай данс",
      value: String(summary.issueCount),
      icon: AlertTriangle,
      color: summary.issueCount > 0 ? "var(--ea-danger)" : "var(--ea-success)",
    },
    {
      label: "Хасах үлдэгдэл",
      value: String(summary.negativeCount),
      icon: AlertTriangle,
      color: "var(--ea-danger)",
    },
    {
      label: "Батлах ноорог",
      value: String(summary.draftCount),
      icon: FileClock,
      color: "var(--ea-warning)",
      // Deep link straight to the draft queue — close prep starts here.
      href: "/cash/transactions?status=draft" as string | undefined,
    },
  ];

  return (
    <div className="flex min-h-full w-full min-w-0 max-w-full flex-none flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Мөнгөн хөрөнгийн хяналт
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Үлдэгдэл зөрсөн эсэх, шалтгаан, дараагийн алхам
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--ea-text-3)]">
          <span className="rounded border border-[var(--ea-border)] px-2 py-1">
            Зөвхөн батлагдсан гүйлгээ
          </span>
          <span className="rounded border border-[var(--ea-border)] px-2 py-1">
            Дотоод бүртгэл + GL + Хуулга
          </span>
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
          return "href" in metric && metric.href ? (
            <Link
              key={metric.label}
              href={metric.href}
              className={`${cellClass} transition-colors hover:bg-[var(--ea-bg-2)]`}
              style={{ textDecoration: "none" }}
              title="Ноорог гүйлгээг нээх"
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

      <section className="grid shrink-0 gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 xl:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
            Үлдэгдлийн онош
          </h2>
          {orderedHealthRows.length === 0 ? (
            <EmptyState text="Мөнгөн хөрөнгийн данс үүсгээгүй байна" />
          ) : (
            <>
              <div className="hidden xl:block">
                <DataGridDynamic<CashHealthRow>
                  rowData={orderedHealthRows}
                  columnDefs={healthColumns}
                  getRowId={(params) => params.data.id}
                  height={Math.min(520, 86 + orderedHealthRows.length * 38)}
                  wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
                  suppressCellFocus
                />
              </div>
              <div className="divide-y divide-[var(--ea-border)] rounded-md border border-[var(--ea-border)] xl:hidden">
                {orderedHealthRows.map((row) => (
                  <div key={row.id} className="p-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--ea-text-1)]">
                          {row.accountName}
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--ea-text-3)]">
                          {row.accountType === "bank" ? "Банк" : "Касс"} · {row.currency}
                        </div>
                      </div>
                      <span className={cn("text-xs font-semibold", healthTone[row.status])}>
                        {healthLabels[row.status]}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <HealthAmount label="Дотоод бүртгэл" value={row.cashBalance} suffix={row.currency} />
                      <HealthAmount label="GL" value={row.glBalance} />
                      <HealthAmount label="Банк" value={row.bankBalance} suffix={row.currency} />
                      <HealthAmount label="Бүртгэл-GL" value={row.cashToGlDifference} />
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-3">
                      {row.status === "negative" && (
                        <button
                          type="button"
                          onClick={() => setExplainRow(row)}
                          className="inline-flex items-center gap-1 text-xs text-[var(--ea-text-2)] hover:text-[var(--ea-text-1)]"
                        >
                          <HelpCircle size={13} />
                          Яагаад?
                        </button>
                      )}
                      <Link
                        href={row.actionHref}
                        className="text-xs font-medium text-[var(--ea-primary)] hover:underline"
                      >
                        {row.actionLabel}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="min-w-0 shrink-0">
        <div className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
            Сүүлийн гүйлгээ
          </h2>
          {recentDocuments.length === 0 ? (
            <EmptyState text="Мөнгөн гүйлгээ байхгүй" />
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

      <Dialog open={!!explainRow} onOpenChange={(open) => !open && setExplainRow(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Хасах үлдэгдлийн тайлбар</DialogTitle>
          </DialogHeader>
          {explainRow && (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-semibold text-[var(--ea-text-1)]">
                  {explainRow.accountName}
                </div>
                <div className="mt-1 text-xs text-[var(--ea-text-3)]">
                  {explainRow.explanation}
                </div>
              </div>

              <div className="grid grid-cols-2 overflow-hidden rounded-md border border-[var(--ea-border)] text-xs">
                <InfoCell label="Эхний үлдэгдэл" value={fmtMnt(explainRow.openingBalance)} />
                <InfoCell label="Орлого" value={fmtMnt(explainRow.receipts)} />
                <InfoCell label="Зарлага" value={fmtMnt(explainRow.payments)} />
                <InfoCell label="Эцсийн үлдэгдэл" value={fmtMnt(explainRow.cashBalance)} danger />
              </div>

              {explainRow.negativeTrigger && (
                <div className="rounded-md border border-[var(--ea-danger)] bg-[var(--ea-danger-bg)] p-3">
                  <div className="text-xs font-semibold text-[var(--ea-danger-fg)]">
                    Хасах болгосон гүйлгээ
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-[var(--ea-text-2)]">
                    <div>
                      {explainRow.negativeTrigger.date} ·{" "}
                      {explainRow.negativeTrigger.documentNo}
                    </div>
                    <div className="font-medium text-[var(--ea-text-1)]">
                      {explainRow.negativeTrigger.description}
                    </div>
                    <div className="font-mono">
                      Дүн: {fmtMnt(explainRow.negativeTrigger.amount)} · Дараах
                      үлдэгдэл: {fmtMnt(explainRow.negativeTrigger.balanceAfter)}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Link
                  href={explainRow.actionHref}
                  className="inline-flex h-8 items-center rounded-md bg-[var(--ea-primary)] px-3 text-xs font-medium text-white hover:bg-[var(--ea-primary-700)]"
                  onClick={() => setExplainRow(null)}
                >
                  {explainRow.actionLabel}
                </Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoCell({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="border-b border-r border-[var(--ea-border)] px-3 py-2 last:border-r-0">
      <div className="text-[11px] text-[var(--ea-text-3)]">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-mono text-sm font-semibold",
          danger ? "text-[var(--ea-danger-fg)]" : "text-[var(--ea-text-1)]"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function HealthAmount({
  label,
  value,
  suffix = "MNT",
}: {
  label: string;
  value: number | null;
  suffix?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[var(--ea-text-3)]">{label}</div>
      <div className="truncate font-mono text-xs font-medium text-[var(--ea-text-1)]">
        {value == null ? "—" : `${fmtMnt(value)} ${suffix}`}
      </div>
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

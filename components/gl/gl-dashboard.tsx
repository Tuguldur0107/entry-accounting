"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FileClock,
  Landmark,
  Scale,
  TrendingUp,
} from "lucide-react";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

export type GlRecentVoucherRow = {
  id: string;
  date: string;
  description: string;
  module: string;
  accounts: string;
  lineCount: number;
  amount: number;
  status: string;
};

export type GlClassSummary = {
  assets: number;
  liabilities: number;
  equity: number;
  monthRevenue: number;
  monthExpense: number;
  monthNetIncome: number;
};

export type GlMonthTrendRow = { month: string; debit: number; count: number };
export type GlTopAccountRow = { main: string; name: string; turnover: number };
export type GlModuleFlowRow = {
  key: string;
  module: string;
  count: number;
  debit: number;
};
export type GlAlerts = {
  draftCount: number;
  unbalancedDraftCount: number;
  reversedThisMonth: number;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Бичигдсэн",
  reversed: "Буцаагдсан",
};

interface Props {
  month: string; // YYYY-MM
  postedCount: number;
  accountCount: number;
  totalDebit: number;
  totalCredit: number;
  classSummary: GlClassSummary;
  trend: GlMonthTrendRow[];
  topAccounts: GlTopAccountRow[];
  moduleRows: GlModuleFlowRow[];
  alerts: GlAlerts;
  recent: GlRecentVoucherRow[];
  monthStart: string; // YYYY-MM-DD
  monthEnd: string; // YYYY-MM-DD
}

// GL хяналтын самбар — нягтланчийн өглөөний нэг дэлгэц: тэнцлийн байдал,
// санхүүгийн байдлын хураангуй, урсгалын трэнд, анхаарах зүйлс.
export function GlDashboard({
  month,
  postedCount,
  accountCount,
  totalDebit,
  totalCredit,
  classSummary,
  trend,
  topAccounts,
  moduleRows,
  alerts,
  recent,
  monthStart,
  monthEnd,
}: Props) {
  const router = useRouter();
  const drCrBalanced = Math.abs(totalDebit - totalCredit) <= 0.01;
  const bsGap =
    Math.round(
      (classSummary.assets - classSummary.liabilities - classSummary.equity) *
        100
    ) / 100;
  const bsBalanced = Math.abs(bsGap) <= 0.01;
  const alertTotal =
    alerts.draftCount + alerts.unbalancedDraftCount + alerts.reversedThisMonth;

  const maxTrend = Math.max(...trend.map((row) => row.debit), 1);
  const maxTurnover = Math.max(...topAccounts.map((row) => row.turnover), 1);

  const monthQuery = `start=${monthStart}&end=${monthEnd}`;
  // Модулийн урсгалын мөр → тухайн модулийн задаргаа (сарын хүрээтэй нь)
  const MODULE_HREFS: Record<string, string> = {
    GL: `/gl/journal?${monthQuery}`,
    CA: `/cash/transactions?${monthQuery}`,
    CO: "/costing/entries",
    FA: "/fa/depreciation",
  };

  function monthRangeQuery(month: string): string {
    const [year, mon] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    return `start=${month}-01&end=${month}-${String(lastDay).padStart(2, "0")}`;
  }

  const columns = useMemo<ColDef<GlRecentVoucherRow>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "date",
        width: 110,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Утга", field: "description", minWidth: 200, flex: 1 },
      {
        headerName: "Модуль",
        field: "module",
        width: 140,
        cellClass: "text-xs",
      },
      {
        headerName: "Данс",
        field: "accounts",
        width: 210,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Мөр",
        field: "lineCount",
        width: 70,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "Дүн",
        field: "amount",
        width: 140,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {/* Гарчиг + хяналтын хоёр chip */}
      <div className="flex flex-col items-start justify-between gap-2 xl:flex-row xl:items-center">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Ерөнхий журналын хяналт
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            {month} сарын байдлаар · дэлгэрэнгүй нь Журналын жагсаалт болон
            Тайлан хэсэгт
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CheckChip
            ok={drCrBalanced}
            okText={`Дт = Кт · ${fmtMnt(totalDebit)}`}
            badText={`Дт ≠ Кт · зөрүү ${fmtMnt(totalDebit - totalCredit)}`}
            href="/gl/reports?report=gl-balance"
          />
          <CheckChip
            ok={bsBalanced}
            okText="Актив = Өр төлбөр + Өмч"
            badText={`А ≠ Ө+Э · зөрүү ${fmtMnt(bsGap)}`}
            href="/gl/reports?report=balance-sheet"
          />
        </div>
      </div>

      {/* Санхүүгийн байдлын хураангуй */}
      <section className="grid grid-cols-2 border-y border-[var(--ea-border)] lg:grid-cols-6">
        <SummaryCell
          label="Актив"
          value={fmtMnt(classSummary.assets)}
          href="/gl/reports?report=balance-sheet"
        />
        <SummaryCell
          label="Өр төлбөр"
          value={fmtMnt(classSummary.liabilities)}
          href="/gl/reports?report=balance-sheet"
        />
        <SummaryCell
          label="Эздийн өмч (ЦА багтсан)"
          value={fmtMnt(classSummary.equity)}
          href="/gl/reports?report=balance-sheet"
        />
        <SummaryCell
          label={`Орлого (${month})`}
          value={fmtMnt(classSummary.monthRevenue)}
          href={`/gl/reports?report=income-statement&${monthQuery}`}
        />
        <SummaryCell
          label={`Зардал (${month})`}
          value={fmtMnt(classSummary.monthExpense)}
          href={`/gl/reports?report=income-statement&${monthQuery}`}
        />
        <SummaryCell
          label={`Цэвэр ашиг (${month})`}
          value={fmtMnt(classSummary.monthNetIncome)}
          valueColor={
            classSummary.monthNetIncome >= 0
              ? "var(--ea-success)"
              : "var(--ea-danger)"
          }
          href={`/gl/reports?report=income-statement&${monthQuery}`}
        />
      </section>

      {/* Дунд бүс: трэнд + баруун багана */}
      <section className="grid min-w-0 gap-6 xl:grid-cols-3">
        {/* 6 сарын эргэлт */}
        <div className="min-w-0 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
              <TrendingUp size={15} className="text-[var(--ea-primary)]" />
              Сүүлийн 6 сарын эргэлт
            </h2>
            <span className="text-[11px] text-[var(--ea-text-4)]">
              бичигдсэн журналын Σ дебет
            </span>
          </div>
          <div className="space-y-2.5">
            {trend.map((row) => (
              <Link
                key={row.month}
                href={`/gl/journal?${monthRangeQuery(row.month)}`}
                className="flex items-center gap-3 rounded px-1 py-0.5 transition-colors hover:bg-[var(--ea-bg-2)]"
                style={{ textDecoration: "none" }}
                title={`${row.month} сарын журналууд руу очих`}
              >
                <span className="w-16 shrink-0 font-mono text-xs text-[var(--ea-text-3)]">
                  {row.month}
                </span>
                <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-[var(--ea-bg-2)]">
                  <div
                    className="h-full rounded-sm bg-[var(--ea-primary)] transition-all"
                    style={{
                      width: `${Math.max(row.debit > 0 ? 2 : 0, Math.round((row.debit / maxTrend) * 100))}%`,
                    }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right font-mono text-xs text-[var(--ea-text-1)]">
                  {fmtMnt(row.debit)}
                </span>
                <span className="w-14 shrink-0 text-right text-[11px] text-[var(--ea-text-4)]">
                  {row.count} ж.
                </span>
              </Link>
            ))}
          </div>

          {/* Топ данс */}
          <div className="mt-5 border-t border-[var(--ea-border)] pt-4">
            <h3 className="mb-3 text-xs font-semibold text-[var(--ea-text-2)]">
              Энэ сарын идэвхтэй данс (эргэлтээр, топ 8)
            </h3>
            {topAccounts.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--ea-text-4)]">
                Энэ сард гүйлгээ бичигдээгүй байна
              </p>
            ) : (
              <div className="space-y-2">
                {topAccounts.map((row) => (
                  <Link
                    key={row.main}
                    href={`/gl/reports?report=gl-balance&${monthQuery}`}
                    className="flex items-center gap-3 rounded px-1 py-0.5 transition-colors hover:bg-[var(--ea-bg-2)]"
                    style={{ textDecoration: "none" }}
                    title={`${row.main} — гүйлгээ баланс руу очих`}
                  >
                    <span className="w-20 shrink-0 font-mono text-xs text-[var(--ea-text-3)]">
                      {row.main}
                    </span>
                    <span className="w-40 shrink-0 truncate text-xs text-[var(--ea-text-2)]">
                      {row.name || "—"}
                    </span>
                    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-[var(--ea-bg-2)]">
                      <div
                        className="h-full rounded-sm bg-[var(--ea-primary)]/60"
                        style={{
                          width: `${Math.max(2, Math.round((row.turnover / maxTurnover) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right font-mono text-xs text-[var(--ea-text-1)]">
                      {fmtMnt(row.turnover)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Баруун багана: тоон үзүүлэлт + модулийн урсгал + анхааруулга */}
        <div className="flex min-w-0 flex-col gap-6">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--ea-border)] bg-[var(--ea-border)]">
            <MiniStat
              icon={BookOpen}
              label="Бичигдсэн журнал"
              value={String(postedCount)}
              href="/gl/journal"
            />
            <MiniStat
              icon={Landmark}
              label="Идэвхтэй данс"
              value={String(accountCount)}
              href="/settings/gl"
            />
          </div>

          <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
              <Scale size={15} className="text-[var(--ea-primary)]" />
              Модулийн урсгал ({month})
            </h2>
            {moduleRows.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--ea-text-4)]">
                Энэ сард журнал бичигдээгүй
              </p>
            ) : (
              <div className="space-y-2">
                {moduleRows.map((row) => (
                  <Link
                    key={row.key}
                    href={MODULE_HREFS[row.key] ?? `/gl/journal?${monthQuery}`}
                    className="flex items-center justify-between gap-2 rounded px-1 py-1 text-xs transition-colors hover:bg-[var(--ea-bg-2)]"
                    style={{ textDecoration: "none" }}
                  >
                    <span className="text-[var(--ea-text-2)]">{row.module}</span>
                    <span className="text-[var(--ea-text-4)]">{row.count} журнал</span>
                    <span className="w-24 text-right font-mono text-[var(--ea-text-1)]">
                      {fmtMnt(row.debit)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div
            className={cn(
              "rounded-md border p-4",
              alertTotal > 0
                ? "border-[var(--ea-warning)]/40 bg-[var(--ea-surface)]"
                : "border-[var(--ea-border)] bg-[var(--ea-surface)]"
            )}
          >
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
              {alertTotal > 0 ? (
                <AlertTriangle size={15} className="text-[var(--ea-warning)]" />
              ) : (
                <CheckCircle2 size={15} className="text-[var(--ea-success)]" />
              )}
              Анхаарах зүйлс
            </h2>
            {alertTotal === 0 ? (
              <p className="text-xs text-[var(--ea-text-3)]">
                Бүгд хэвийн — ноорог болон тэнцлийн асуудал алга.
              </p>
            ) : (
              <ul className="space-y-2 text-xs">
                {alerts.draftCount > 0 && (
                  <AlertRow
                    href="/gl/journal"
                    text={`${alerts.draftCount} ноорог журнал батлагдахыг хүлээж байна`}
                  />
                )}
                {alerts.unbalancedDraftCount > 0 && (
                  <AlertRow
                    href="/gl/journal"
                    text={`${alerts.unbalancedDraftCount} ноорог Дт ≠ Кт тэнцээгүй`}
                    danger
                  />
                )}
                {alerts.reversedThisMonth > 0 && (
                  <AlertRow
                    href="/gl/journal"
                    text={`Энэ сард ${alerts.reversedThisMonth} журнал сторно хийгдсэн`}
                  />
                )}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Сүүлийн журналууд */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
          <FileClock size={15} className="text-[var(--ea-primary)]" />
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
            onRowClicked={(event) => {
              const date = event.data?.date;
              router.push(
                date
                  ? `/gl/journal?${monthRangeQuery(date.slice(0, 7))}`
                  : "/gl/journal"
              );
            }}
          />
        )}
      </section>
    </div>
  );
}

function CheckChip({
  ok,
  okText,
  badText,
  href,
}: {
  ok: boolean;
  okText: string;
  badText: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      style={{ textDecoration: "none" }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-medium transition-colors hover:bg-[var(--ea-bg-2)]",
        ok
          ? "border-[var(--ea-success)]/40 text-[var(--ea-success)]"
          : "border-[var(--ea-danger)]/40 text-[var(--ea-danger)]"
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: ok ? "var(--ea-success)" : "var(--ea-danger)" }}
      />
      {ok ? okText : badText}
    </Link>
  );
}

function SummaryCell({
  label,
  value,
  valueColor,
  href,
}: {
  label: string;
  value: string;
  valueColor?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="min-w-0 border-b border-r border-[var(--ea-border)] px-4 py-3 transition-colors last:border-r-0 hover:bg-[var(--ea-bg-2)] lg:border-b-0"
      style={{ textDecoration: "none" }}
    >
      <div className="truncate text-[11px] text-[var(--ea-text-3)]">{label}</div>
      <div
        className="mt-0.5 truncate font-mono text-sm font-semibold"
        style={{ color: valueColor ?? "var(--ea-text-1)" }}
      >
        {value}
      </div>
    </Link>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-w-0 items-center gap-3 bg-[var(--ea-surface)] px-4 py-3 transition-colors hover:bg-[var(--ea-bg-2)]"
      style={{ textDecoration: "none" }}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--ea-bg-2)] text-[var(--ea-primary)]">
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] text-[var(--ea-text-3)]">{label}</div>
        <div className="mt-0.5 font-mono text-base font-semibold text-[var(--ea-text-1)]">
          {value}
        </div>
      </div>
    </Link>
  );
}

function AlertRow({
  href,
  text,
  danger = false,
}: {
  href: string;
  text: string;
  danger?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-[var(--ea-bg-2)]",
          danger ? "text-[var(--ea-danger)]" : "text-[var(--ea-text-2)]"
        )}
        style={{ textDecoration: "none" }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background: danger ? "var(--ea-danger)" : "var(--ea-warning)",
          }}
        />
        {text}
      </Link>
    </li>
  );
}

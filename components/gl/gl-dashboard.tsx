"use client";

import { useMemo } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import Link from "next/link";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import {
  openDrillPanel,
  openVoucherPanel,
  type DrillPanelRow,
} from "@/lib/store/panel-store";
import { fmtPeriodCode } from "@/lib/periods/period";
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

export type GlDraftItem = {
  id: string;
  date: string;
  description: string;
  amount: number;
  unbalanced: boolean;
};

/** Задаргааны индекс — журнал бүрийн компакт төлөөлөл (сервер бүрдүүлнэ). */
export type GlDrillVoucher = {
  id: string;
  date: string;
  description: string;
  status: string;
  moduleKey: string;
  mains: string[];
  lineCount: number;
  debit: number;
  cls: {
    asset: number;
    liability: number;
    equity: number;
    revenue: number;
    expense: number;
  };
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Бичигдсэн",
  reversed: "Буцаагдсан",
};

const MODULE_LABELS: Record<string, string> = {
  GL: "Гар журнал",
  CA: "Мөнгөн хөрөнгө",
  CO: "Өртөг",
  FA: "Үндсэн хөрөнгө",
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
  draftItems: GlDraftItem[];
  recent: GlRecentVoucherRow[];
  drillVouchers: GlDrillVoucher[];
  monthStart: string; // YYYY-MM-DD
  monthEnd: string; // YYYY-MM-DD
}

// GL хяналтын самбар — үзүүлэлт бүр даргдана: эхлээд бүрдүүлэгч журналуудын
// задаргаа (dialog), тэндээс журнал бүрийн мөрийн дэлгэрэнгүй нээгдэнэ.
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
  draftItems,
  recent,
  drillVouchers,
  monthStart,
  monthEnd,
}: Props) {
  const drCrBalanced = Math.abs(totalDebit - totalCredit) <= 0.01;
  const bsGap =
    Math.round(
      (classSummary.assets - classSummary.liabilities - classSummary.equity) *
        100
    ) / 100;
  const bsBalanced = Math.abs(bsGap) <= 0.01;
  const alertTotal = alerts.draftCount + alerts.reversedThisMonth;

  const maxTrend = Math.max(...trend.map((row) => row.debit), 1);
  const maxTurnover = Math.max(...topAccounts.map((row) => row.turnover), 1);

  const monthQuery = `start=${monthStart}&end=${monthEnd}`;

  // Журналын жагсаалттай ижил ажлын панель — ноорог бол засварлагч,
  // бичигдсэн/буцаагдсан бол харах горимоор нээгдэнэ.
  function openVoucherEditor(id: string, title?: string) {
    openVoucherPanel(id, title);
  }

  /** 1-р түвшин: метрикийн бүрдүүлэгч журналуудын жагсаалт — панелиар. */
  function openDrill(
    title: string,
    filter: (voucher: GlDrillVoucher) => boolean,
    amount: (voucher: GlDrillVoucher) => number,
    options?: { note?: string; link?: { href: string; label: string } }
  ) {
    const rows: DrillPanelRow[] = drillVouchers
      .filter(filter)
      .map((voucher) => ({
        id: voucher.id,
        date: voucher.date,
        description: voucher.description,
        module: MODULE_LABELS[voucher.moduleKey] ?? voucher.moduleKey,
        lineCount: voucher.lineCount,
        amount: Math.round(amount(voucher) * 100) / 100,
        status: voucher.status,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    openDrillPanel({ title, rows, ...options });
  }

  const isPostedLike = (voucher: GlDrillVoucher) =>
    voucher.status === "posted" || voucher.status === "reversed";
  const inMonth = (voucher: GlDrillVoucher) => voucher.date.startsWith(month);

  function monthRangeQuery(m: string): string {
    const [year, mon] = m.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    return `start=${m}-01&end=${m}-${String(lastDay).padStart(2, "0")}`;
  }

  const recentColumns = useMemo<ColDef<GlRecentVoucherRow>[]>(
    () => [
      { headerName: "Огноо", field: "date", width: 110, cellClass: "font-mono text-xs" },
      { headerName: "Утга", field: "description", minWidth: 200, flex: 1 },
      { headerName: "Модуль", field: "module", width: 140, cellClass: "text-xs" },
      { headerName: "Данс", field: "accounts", width: 210, cellClass: "font-mono text-xs" },
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
            {fmtPeriodCode(month)} — сарын байдлаар · үзүүлэлт бүр дээр дарж задаргааг нь харна
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CheckChip
            ok={drCrBalanced}
            okText={`Дт = Кт · ${fmtMnt(totalDebit)}`}
            badText={`Дт ≠ Кт · зөрүү ${fmtMnt(totalDebit - totalCredit)}`}
            onClick={() =>
              openDrill("Дт=Кт — бүх бичигдсэн журнал", isPostedLike, (v) => v.debit, {
                note: "Буцаалтын хосууд хамт орсон — нийлбэр нь харилцан цуцлагдана",
                link: {
                  href: "/gl/reports?report=gl-balance",
                  label: "Гүйлгээ баланс руу",
                },
              })
            }
          />
          <CheckChip
            ok={bsBalanced}
            okText="Актив = Өр төлбөр + Өмч"
            badText={`А ≠ Ө+Э · зөрүү ${fmtMnt(bsGap)}`}
            onClick={() =>
              openDrill(
                "Балансын тэгшитгэл — бүх журнал",
                isPostedLike,
                (v) => v.debit,
                {
                  link: {
                    href: "/gl/reports?report=balance-sheet",
                    label: "Баланс тайлан руу",
                  },
                }
              )
            }
          />
        </div>
      </div>

      {/* Санхүүгийн байдлын хураангуй */}
      <section className="grid grid-cols-2 border-y border-[var(--ea-border)] lg:grid-cols-6">
        <SummaryCell
          label="Актив"
          value={fmtMnt(classSummary.assets)}
          onClick={() =>
            openDrill(
              "Актив данс хөдөлгөсөн журналууд",
              (v) => isPostedLike(v) && v.cls.asset !== 0,
              (v) => v.cls.asset,
              {
                note: "Дүн = журналын активт үзүүлсэн цэвэр нөлөө (Дт−Кт)",
                link: {
                  href: "/gl/reports?report=balance-sheet",
                  label: "Баланс тайлан руу",
                },
              }
            )
          }
        />
        <SummaryCell
          label="Өр төлбөр"
          value={fmtMnt(classSummary.liabilities)}
          onClick={() =>
            openDrill(
              "Өр төлбөрийн данс хөдөлгөсөн журналууд",
              (v) => isPostedLike(v) && v.cls.liability !== 0,
              (v) => v.cls.liability,
              {
                note: "Дүн = журналын өр төлбөрт үзүүлсэн цэвэр нөлөө (Кт−Дт)",
                link: {
                  href: "/gl/reports?report=balance-sheet",
                  label: "Баланс тайлан руу",
                },
              }
            )
          }
        />
        <SummaryCell
          label="Эздийн өмч (ЦА багтсан)"
          value={fmtMnt(classSummary.equity)}
          onClick={() =>
            openDrill(
              "Өмч, орлого, зардлын данс хөдөлгөсөн журналууд",
              (v) =>
                isPostedLike(v) &&
                v.cls.equity + v.cls.revenue - v.cls.expense !== 0,
              (v) => v.cls.equity + v.cls.revenue - v.cls.expense,
              {
                note: "Дүн = өмчид үзүүлсэн цэвэр нөлөө (өссөн дүнгийн ЦА багтсан)",
                link: {
                  href: "/gl/reports?report=balance-sheet",
                  label: "Баланс тайлан руу",
                },
              }
            )
          }
        />
        <SummaryCell
          label={`Орлого (${month})`}
          value={fmtMnt(classSummary.monthRevenue)}
          onClick={() =>
            openDrill(
              `${month} — орлогын данс хөдөлгөсөн журналууд`,
              (v) => isPostedLike(v) && inMonth(v) && v.cls.revenue !== 0,
              (v) => v.cls.revenue,
              {
                link: {
                  href: `/gl/reports?report=income-statement&${monthQuery}`,
                  label: "ОДТ руу",
                },
              }
            )
          }
        />
        <SummaryCell
          label={`Зардал (${month})`}
          value={fmtMnt(classSummary.monthExpense)}
          onClick={() =>
            openDrill(
              `${month} — зардлын данс хөдөлгөсөн журналууд`,
              (v) => isPostedLike(v) && inMonth(v) && v.cls.expense !== 0,
              (v) => v.cls.expense,
              {
                link: {
                  href: `/gl/reports?report=income-statement&${monthQuery}`,
                  label: "ОДТ руу",
                },
              }
            )
          }
        />
        <SummaryCell
          label={`Цэвэр ашиг (${month})`}
          value={fmtMnt(classSummary.monthNetIncome)}
          valueColor={
            classSummary.monthNetIncome >= 0
              ? "var(--ea-success)"
              : "var(--ea-danger)"
          }
          onClick={() =>
            openDrill(
              `${month} — үр дүнд нөлөөлсөн журналууд`,
              (v) =>
                isPostedLike(v) &&
                inMonth(v) &&
                v.cls.revenue - v.cls.expense !== 0,
              (v) => v.cls.revenue - v.cls.expense,
              {
                note: "Дүн = журналын цэвэр ашигт үзүүлсэн нөлөө (орлого − зардал)",
                link: {
                  href: `/gl/reports?report=income-statement&${monthQuery}`,
                  label: "ОДТ руу",
                },
              }
            )
          }
        />
      </section>

      {/* Дунд бүс: трэнд + баруун багана */}
      <section className="grid min-w-0 gap-6 xl:grid-cols-3">
        {/* 6 сарын эргэлт */}
        <div className="min-w-0 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
              <Icon name="trendUp" size="sm" className="text-[var(--ea-primary)]" />
              Сүүлийн 6 сарын эргэлт
            </h2>
            <span className="text-[11px] text-[var(--ea-text-4)]">
              бичигдсэн журналын Σ дебет
            </span>
          </div>
          <div className="space-y-1">
            {trend.map((row) => (
              <button
                key={row.month}
                type="button"
                onClick={() =>
                  openDrill(
                    `${row.month} сарын журналууд`,
                    (v) => isPostedLike(v) && v.date.startsWith(row.month),
                    (v) => v.debit,
                    {
                      link: {
                        href: `/gl/journal?${monthRangeQuery(row.month)}`,
                        label: "Журналын жагсаалт руу",
                      },
                    }
                  )
                }
                className="flex w-full items-center gap-3 rounded px-1 py-1 text-left transition-colors hover:bg-[var(--ea-bg-2)]"
                title={`${row.month} сарын задаргаа`}
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
              </button>
            ))}
          </div>

          {/* Топ данс */}
          <div className="mt-5 border-t border-[var(--ea-border)] pt-4">
            <h3 className="mb-2 text-xs font-semibold text-[var(--ea-text-2)]">
              Энэ сарын идэвхтэй данс (эргэлтээр, топ 8)
            </h3>
            {topAccounts.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--ea-text-4)]">
                Энэ сард гүйлгээ бичигдээгүй байна
              </p>
            ) : (
              <div className="space-y-1">
                {topAccounts.map((row) => (
                  <button
                    key={row.main}
                    type="button"
                    onClick={() =>
                      openDrill(
                        `${row.main} ${row.name} — ${month} сарын журналууд`,
                        (v) =>
                          isPostedLike(v) &&
                          inMonth(v) &&
                          v.mains.includes(row.main),
                        (v) => v.debit,
                        {
                          note: "Дүн = журналын нийт дебет",
                          link: {
                            href: `/gl/reports?report=gl-balance&${monthQuery}`,
                            label: "Гүйлгээ баланс руу",
                          },
                        }
                      )
                    }
                    className="flex w-full items-center gap-3 rounded px-1 py-1 text-left transition-colors hover:bg-[var(--ea-bg-2)]"
                    title={`${row.main} — задаргаа`}
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
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Баруун багана */}
        <div className="flex min-w-0 flex-col gap-6">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--ea-border)] bg-[var(--ea-border)]">
            <MiniStat
              icon="generalLedger"
              label="Бичигдсэн журнал"
              value={String(postedCount)}
              onClick={() =>
                openDrill(
                  "Бичигдсэн журналууд",
                  (v) => v.status === "posted",
                  (v) => v.debit,
                  {
                    link: { href: "/gl/journal", label: "Журналын жагсаалт руу" },
                  }
                )
              }
            />
            <MiniStat
              icon="bank"
              label="Идэвхтэй данс"
              value={String(accountCount)}
              href="/settings/gl"
            />
          </div>

          <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
              <Icon name="reconciliation" size="sm" className="text-[var(--ea-primary)]" />
              Модулийн урсгал ({month})
            </h2>
            {moduleRows.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--ea-text-4)]">
                Энэ сард журнал бичигдээгүй
              </p>
            ) : (
              <div className="space-y-1">
                {moduleRows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() =>
                      openDrill(
                        `${row.module} — ${month} сарын журналууд`,
                        (v) =>
                          isPostedLike(v) &&
                          inMonth(v) &&
                          v.moduleKey === row.key,
                        (v) => v.debit,
                        {
                          note: "Дүн = журналын нийт дебет",
                        }
                      )
                    }
                    className="flex w-full items-center justify-between gap-2 rounded px-1 py-1.5 text-left text-xs transition-colors hover:bg-[var(--ea-bg-2)]"
                    title={`${row.module} — задаргаа`}
                  >
                    <span className="text-[var(--ea-text-2)]">{row.module}</span>
                    <span className="text-[var(--ea-text-4)]">{row.count} журнал</span>
                    <span className="w-24 text-right font-mono text-[var(--ea-text-1)]">
                      {fmtMnt(row.debit)}
                    </span>
                  </button>
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
                <Icon name="warning" size="sm" className="text-[var(--ea-warning)]" />
              ) : (
                <Icon name="success" size="sm" className="text-[var(--ea-success)]" />
              )}
              Анхаарах зүйлс
            </h2>
            {alertTotal === 0 ? (
              <p className="text-xs text-[var(--ea-text-3)]">
                Бүгд хэвийн — ноорог болон тэнцлийн асуудал алга.
              </p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {draftItems.map((draft) => (
                  <li key={draft.id}>
                    <button
                      type="button"
                      onClick={() => openVoucherEditor(draft.id, draft.description)}
                      title="Журналыг нээж шалгах"
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--ea-bg-2)]",
                        draft.unbalanced
                          ? "text-[var(--ea-danger)]"
                          : "text-[var(--ea-text-2)]"
                      )}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          background: draft.unbalanced
                            ? "var(--ea-danger)"
                            : "var(--ea-warning)",
                        }}
                      />
                      <span className="shrink-0 font-mono text-[11px] text-[var(--ea-text-4)]">
                        {draft.date}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {draft.description || "(утгагүй ноорог)"}
                      </span>
                      <span className="shrink-0 font-mono text-[11px]">
                        {fmtMnt(draft.amount)}
                      </span>
                      {draft.unbalanced && (
                        <span className="shrink-0 rounded bg-[var(--ea-danger)]/10 px-1.5 py-0.5 text-[10px] font-medium">
                          Дт≠Кт
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                {alerts.draftCount > draftItems.length && (
                  <li>
                    <button
                      type="button"
                      onClick={() =>
                        openDrill(
                          "Бүх ноорог журнал",
                          (v) => v.status === "draft",
                          (v) => v.debit,
                          {
                            link: {
                              href: "/gl/journal",
                              label: "Журналын жагсаалт руу",
                            },
                          }
                        )
                      }
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[var(--ea-text-2)] transition-colors hover:bg-[var(--ea-bg-2)]"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ea-warning)]" />
                      ... нийт {alerts.draftCount} ноорог — бүгдийг харах
                    </button>
                  </li>
                )}
                {alerts.reversedThisMonth > 0 && (
                  <li>
                    <button
                      type="button"
                      onClick={() =>
                        openDrill(
                          `${month} — буцаагдсан журналууд`,
                          (v) => v.status === "reversed" && inMonth(v),
                          (v) => v.debit
                        )
                      }
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[var(--ea-text-2)] transition-colors hover:bg-[var(--ea-bg-2)]"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ea-warning)]" />
                      Энэ сард {alerts.reversedThisMonth} журнал буцаагдсан
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Сүүлийн журналууд — мөр дээр дарахад журналын дэлгэрэнгүй */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
          <Icon name="pending" size="sm" className="text-[var(--ea-primary)]" />
          Сүүлийн журналууд
        </h2>
        {recent.length === 0 ? (
          <div className="flex min-h-40 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
            Журнал бичигдээгүй байна — Журналын жагсаалтаас шинэ журнал үүсгэнэ
          </div>
        ) : (
          <DataGridDynamic<GlRecentVoucherRow>
            rowData={recent}
            columnDefs={recentColumns}
            getRowId={(params) => params.data.id}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
            onRowClicked={(event) => {
              if (event.data)
                openVoucherEditor(event.data.id, event.data.description);
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
  onClick,
}: {
  ok: boolean;
  okText: string;
  badText: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Задаргаа харах"
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
    </button>
  );
}

function SummaryCell({
  label,
  value,
  valueColor,
  onClick,
}: {
  label: string;
  value: string;
  valueColor?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Задаргаа харах"
      className="min-w-0 border-b border-r border-[var(--ea-border)] px-4 py-3 text-left transition-colors last:border-r-0 hover:bg-[var(--ea-bg-2)] lg:border-b-0"
    >
      <div className="truncate text-[11px] text-[var(--ea-text-3)]">{label}</div>
      <div
        className="mt-0.5 truncate font-mono text-sm font-semibold"
        style={{ color: valueColor ?? "var(--ea-text-1)" }}
      >
        {value}
      </div>
    </button>
  );
}

function MiniStat({
  icon,
  label,
  value,
  href,
  onClick,
}: {
  icon: IconName;
  label: string;
  value: string;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--ea-bg-2)] text-[var(--ea-primary)]">
        <Icon name={icon} size="sm" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] text-[var(--ea-text-3)]">{label}</div>
        <div className="mt-0.5 font-mono text-base font-semibold text-[var(--ea-text-1)]">
          {value}
        </div>
      </div>
    </>
  );
  const className =
    "flex min-w-0 items-center gap-3 bg-[var(--ea-surface)] px-4 py-3 text-left transition-colors hover:bg-[var(--ea-bg-2)]";
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  return (
    <Link href={href!} className={className} style={{ textDecoration: "none" }}>
      {content}
    </Link>
  );
}

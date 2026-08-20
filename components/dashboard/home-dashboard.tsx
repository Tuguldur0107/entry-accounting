// Системийн үндсэн самбарын үзүүлэлт. Тооцоолол бүхэлдээ серверт хийгддэг тул
// энэ component нь client bundle-д ороогүй (interaktiv зүйл байхгүй — зөвхөн
// Link болон CSS hover). Өнгө бүгд --ea-* токеноор.

import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";

import { StatusBadge } from "@/components/ui/status-badge";
import { fmtPeriodCode } from "@/lib/periods/period";
import { fmtMnt } from "@/lib/reports/balances";
import type { TaxDeadline } from "@/lib/tax/calendar";
import { cn } from "@/lib/utils";

/** Хуанлийн мөр + бэлтгэлийн төлөв (null = системд мөрдөх объектгүй). */
export type HomeTaxDeadline = TaxDeadline & {
  prepared: boolean | null;
  href: string;
};

/** Ажлын дарааллын карт — анхаарал шаардсан зүйлс (0 бол харагдахгүй). */
export type HomeQueueItem = {
  key: string;
  label: string;
  count: number;
  href: string;
  icon: IconName;
};

export type HomeClassSummary = {
  assets: number;
  liabilities: number;
  equity: number;
  monthRevenue: number;
  monthExpense: number;
  monthNetIncome: number;
};

/** П15 — АР/АП aging: нээлттэй үлдэгдэл хугацааны сагсаар + төвлөрөл. */
export type HomeAging = {
  total: number;
  /** Хугацаа болоогүй. */
  current: number;
  d1_30: number;
  d31_60: number;
  d61plus: number;
  /** Хамгийн их үлдэгдэлтэй харилцагч ба түүний эзлэх хувь. */
  topName: string | null;
  topShare: number;
};

/** П15 — нүүрний KPI картуудын дата. */
export type HomeKpi = {
  cash: { total: number; series: { date: string; value: number }[] };
  arAging: HomeAging;
  apAging: HomeAging;
  /** Сүүлийн 6 сар — бичигдсэн журналын орлого/зардал. */
  trend: { month: string; revenue: number; expense: number }[];
};

export type HomeModuleTile = {
  key: string;
  label: string;
  href: string;
  /** Тоо бол MNT форматлана, string бол шууд үзүүлнэ. */
  value: number | string;
  valueLabel: string;
  note: string;
  tone: "default" | "warning" | "danger";
};

export type HomeAlert = {
  tone: "default" | "warning" | "danger";
  title: string;
  detail: string;
  href: string;
  action: string;
};

export type HomeRecentRow = {
  id: string;
  date: string;
  description: string;
  accounts: string;
  amount: number;
  status: string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Ноорог",
  posted: "Бичигдсэн",
  reversed: "Буцаагдсан",
};

const QUICK_ACTIONS: {
  href: string;
  label: string;
  icon: IconName;
  primary?: boolean;
}[] = [
  { href: "/gl/journal/new", label: "Журнал бичих", icon: "add", primary: true },
  { href: "/cash/statements", label: "Хуулга импорт", icon: "spreadsheet" },
  { href: "/receivables/documents", label: "Нэхэмжлэл", icon: "document" },
  { href: "/gl/reports", label: "Тайлан", icon: "report" },
];

export function HomeDashboard({
  periodCode,
  periodStatus,
  totalDebit,
  totalCredit,
  accountCount,
  classSummary,
  modules,
  alerts,
  recent,
  queue,
  taxDeadlines,
  kpi,
}: {
  periodCode: string;
  periodStatus: "open" | "closed" | "missing";
  totalDebit: number;
  totalCredit: number;
  accountCount: number;
  classSummary: HomeClassSummary;
  modules: HomeModuleTile[];
  alerts: HomeAlert[];
  recent: HomeRecentRow[];
  queue: HomeQueueItem[];
  taxDeadlines: HomeTaxDeadline[];
  kpi: HomeKpi;
}) {
  const drCrBalanced = Math.abs(totalDebit - totalCredit) <= 0.01;
  const bsGap =
    classSummary.assets - (classSummary.liabilities + classSummary.equity);
  const bsBalanced = Math.abs(bsGap) <= 0.01;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {/* Гарчиг + системийн эрүүл мэндийн шалгалт */}
      <div className="flex flex-col items-start justify-between gap-3 xl:flex-row xl:items-center">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Хяналтын самбар
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            {fmtPeriodCode(periodCode)} · бүх модулийн нэгдсэн байдал
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={drCrBalanced ? "success" : "danger"}>
            {drCrBalanced
              ? `Дт = Кт · ${fmtMnt(totalDebit)}`
              : `Дт ≠ Кт · зөрүү ${fmtMnt(totalDebit - totalCredit)}`}
          </StatusBadge>
          <StatusBadge tone={bsBalanced ? "success" : "danger"}>
            {bsBalanced ? "Актив = Өр + Өмч" : `А ≠ Ө+Э · зөрүү ${fmtMnt(bsGap)}`}
          </StatusBadge>
          <StatusBadge
            tone={
              periodStatus === "open"
                ? "success"
                : periodStatus === "closed"
                  ? "muted"
                  : "warning"
            }
          >
            {periodStatus === "open"
              ? "Тайлант үе нээлттэй"
              : periodStatus === "closed"
                ? "Тайлант үе хаагдсан"
                : "Тайлант үе үүсээгүй"}
          </StatusBadge>
        </div>
      </div>

      {/* Ажлын дараалал — exception-first: анхаарал шаардсан зүйл л гарна */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
          <Icon name="pending" size="sm" className="text-[var(--ea-text-3)]" />
          Ажлын дараалал
        </h2>
        {queue.length === 0 ? (
          <p
            className="flex items-center gap-1.5 rounded-[var(--ea-r-md)] border px-4 py-3 text-xs"
            style={{
              borderColor: "var(--ea-border)",
              color: "var(--ea-success-fg)",
              background: "var(--ea-surface)",
            }}
          >
            <Icon name="success" size="sm" />
            Хүлээгдэж буй ажил алга — бүх бичилт батлагдсан, тулгагдсан.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
            {queue.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="ea-interactive flex items-center gap-3 rounded-[var(--ea-r-md)] border px-3.5 py-3"
                style={{
                  borderColor: "var(--ea-border)",
                  background: "var(--ea-surface)",
                  textDecoration: "none",
                }}
              >
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-md"
                  style={{
                    background: "var(--ea-warning-bg, var(--ea-bg-2))",
                    color: "var(--ea-warning-fg)",
                  }}
                >
                  <Icon name={item.icon} size="sm" />
                </span>
                <span className="min-w-0">
                  <span className="block font-mono text-base font-semibold text-[var(--ea-text-1)]">
                    {item.count}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--ea-text-3)]">
                    {item.label}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Хурдан үйлдэл */}
      <div className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={cn(
              "flex h-9 items-center gap-2 rounded-md px-3.5 text-xs font-medium transition-colors",
              action.primary
                ? "bg-[var(--ea-primary)] text-[var(--primary-foreground)]"
                : "ea-interactive border border-[var(--ea-border-strong)] text-[var(--ea-text-2)]"
            )}
            style={{ textDecoration: "none" }}
          >
            <Icon name={action.icon} size="sm" />
            {action.label}
          </Link>
        ))}
      </div>

      {/* Татварын хуанли — дараагийн тайлагналын хугацаанууд */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
          <Icon name="period" size="sm" className="text-[var(--ea-text-3)]" />
          Татварын хуанли
        </h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--ea-r-md)] border border-[var(--ea-border)] bg-[var(--ea-border)] lg:grid-cols-4">
          {taxDeadlines.map((deadline) => {
            const urgent = deadline.daysLeft <= 3;
            const soon = deadline.daysLeft <= 7;
            return (
              <Link
                key={deadline.key}
                href={deadline.href}
                className="block bg-[var(--ea-surface)] px-4 py-3 transition-colors hover:bg-[var(--ea-bg-2)]"
                style={{ textDecoration: "none" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--ea-text-1)]">
                    {deadline.label}
                  </span>
                  <span
                    className={cn(
                      "text-[11px] font-semibold",
                      urgent
                        ? "text-[var(--ea-danger-fg)]"
                        : soon
                          ? "text-[var(--ea-warning-fg)]"
                          : "text-[var(--ea-text-3)]"
                    )}
                  >
                    {deadline.daysLeft === 0
                      ? "Өнөөдөр!"
                      : `${deadline.daysLeft} хоног`}
                  </span>
                </div>
                <div className="mt-1 font-mono text-xs text-[var(--ea-text-2)]">
                  {deadline.dueDate}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--ea-text-4)]">
                  <span>Тайлант үе: {deadline.period}</span>
                  {deadline.prepared !== null && (
                    <span
                      className={
                        deadline.prepared
                          ? "text-[var(--ea-success-fg)]"
                          : "text-[var(--ea-warning-fg)]"
                      }
                    >
                      {deadline.prepared ? "Журнал үүссэн" : "Журнал үүсээгүй"}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Санхүүгийн байдал */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
          <Icon name="bank" size="sm" className="text-[var(--ea-text-3)]" />
          Санхүүгийн байдал
        </h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--ea-r-md)] border border-[var(--ea-border)] bg-[var(--ea-border)] lg:grid-cols-6">
          <SummaryCell label="Актив" value={classSummary.assets} />
          <SummaryCell label="Өр төлбөр" value={classSummary.liabilities} />
          <SummaryCell label="Эздийн өмч" value={classSummary.equity} />
          <SummaryCell label="Орлого · тайлант үе" value={classSummary.monthRevenue} />
          <SummaryCell label="Зардал · тайлант үе" value={classSummary.monthExpense} />
          <SummaryCell
            label="Цэвэр ашиг · тайлант үе"
            value={classSummary.monthNetIncome}
            tone={classSummary.monthNetIncome < 0 ? "danger" : "success"}
          />
        </div>
        <p className="mt-2 text-[11px] text-[var(--ea-text-4)]">
          Бичигдсэн журналаас өссөн дүнгээр · {accountCount} идэвхтэй данс
        </p>
      </section>

      {/* П15 — Гол үзүүлэлт: мөнгөн байрлал, АР/АП aging, орлого-зардлын тренд */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
          <Icon name="trendUp" size="sm" className="text-[var(--ea-text-3)]" />
          Гол үзүүлэлт
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            href="/cash"
            label="Мөнгөн байрлал (MNT)"
            value={fmtMnt(kpi.cash.total)}
            valueTone={kpi.cash.total < 0 ? "danger" : "default"}
          >
            <Sparkline series={kpi.cash.series} />
            <p className="text-[11px] text-[var(--ea-text-4)]">
              Сүүлийн 30 хоногийн үлдэгдэл
            </p>
          </KpiCard>
          <KpiCard
            href="/receivables/reports"
            label="Авлагын насжилт"
            value={fmtMnt(kpi.arAging.total)}
          >
            <AgingBar aging={kpi.arAging} />
          </KpiCard>
          <KpiCard
            href="/payables/reports"
            label="Өглөгийн насжилт"
            value={fmtMnt(kpi.apAging.total)}
          >
            <AgingBar aging={kpi.apAging} />
          </KpiCard>
          <KpiCard
            href="/gl/reports"
            label="Орлого · Зардал (6 сар)"
            value={
              kpi.trend.length > 0
                ? fmtMnt(kpi.trend[kpi.trend.length - 1].revenue)
                : "—"
            }
            valueLabel="сүүлийн сарын орлого"
          >
            <TrendBars trend={kpi.trend} />
          </KpiCard>
        </div>
      </section>

      {/* Модулиуд */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-[var(--ea-text-1)]">
          Модулиудын байдал
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((tile) => (
            <Link
              key={tile.key}
              href={tile.href}
              className="ea-card-interactive flex flex-col gap-2 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4"
              style={{ textDecoration: "none" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--ea-text-2)]">
                  {tile.label}
                </span>
                <Icon name="arrowRight" size="sm" className="text-[var(--ea-text-4)]" />
              </div>
              <div className="font-mono text-xl font-semibold text-[var(--ea-text-1)]">
                {typeof tile.value === "number" ? fmtMnt(tile.value) : tile.value}
              </div>
              <div className="text-[11px] text-[var(--ea-text-3)]">
                {tile.valueLabel}
              </div>
              <div
                className={cn(
                  "mt-1 text-[11px]",
                  tile.tone === "danger"
                    ? "text-[var(--ea-danger-fg)]"
                    : tile.tone === "warning"
                      ? "text-[var(--ea-warning-fg)]"
                      : "text-[var(--ea-text-4)]"
                )}
              >
                {tile.note}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        {/* Анхаарах шаардлагатай */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
            <Icon name="warning" size="sm" className="text-[var(--ea-text-3)]" />
            Анхаарах шаардлагатай
          </h2>
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-[var(--ea-r-md)] border border-[var(--ea-border)] bg-[var(--ea-surface)] px-4 py-5 text-xs text-[var(--ea-text-3)]">
              <Icon name="success" className="text-[var(--ea-success-fg)]" />
              Анхаарах зүйл алга — ноорог, хугацаа хэтрэлт байхгүй.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {alerts.map((alert, i) => (
                <li key={i}>
                  <Link
                    href={alert.href}
                    className="ea-card-interactive flex items-start gap-3 rounded-[var(--ea-r-md)] border border-[var(--ea-border)] bg-[var(--ea-surface)] p-3.5"
                    style={{ textDecoration: "none" }}
                  >
                    <span
                      className={cn(
                        "mt-0.5 shrink-0",
                        alert.tone === "danger"
                          ? "text-[var(--ea-danger-fg)]"
                          : alert.tone === "warning"
                            ? "text-[var(--ea-warning-fg)]"
                            : "text-[var(--ea-text-4)]"
                      )}
                    >
                      {alert.tone === "default" ? (
                        <Icon name="info" size="sm" />
                      ) : (
                        <Icon name="warning" size="sm" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-[var(--ea-text-1)]">
                        {alert.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[var(--ea-text-3)]">
                        {alert.detail}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--ea-primary)]">
                      {alert.action}
                      <Icon name="arrowRight" size="xs" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Сүүлийн бичилтүүд */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
              <Icon name="period" size="sm" className="text-[var(--ea-text-3)]" />
              Сүүлийн бичилтүүд
            </h2>
            <Link
              href="/gl/journal"
              className="flex items-center gap-1 text-[11px] text-[var(--ea-primary)]"
            >
              Бүгдийг харах
              <Icon name="arrowRight" size="xs" />
            </Link>
          </div>
          <div className="overflow-hidden rounded-[var(--ea-r-md)] border border-[var(--ea-border)]">
            {recent.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--ea-text-4)]">
                Бичилт байхгүй — “Журнал бичих”-ээс эхэлнэ.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[var(--ea-bg-2)] text-[var(--ea-text-2)]">
                    <th className="px-3 py-2 text-left font-semibold">Огноо</th>
                    <th className="px-3 py-2 text-left font-semibold">Гүйлгээ</th>
                    <th className="px-3 py-2 text-right font-semibold">Дүн</th>
                    <th className="px-3 py-2 text-left font-semibold">Төлөв</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-[var(--ea-border)] bg-[var(--ea-surface)]"
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[var(--ea-text-2)]">
                        {row.date}
                      </td>
                      <td className="px-3 py-2">
                        <span className="block truncate text-[var(--ea-text-1)]">
                          {row.description}
                        </span>
                        {row.accounts && (
                          <span className="block truncate text-[11px] text-[var(--ea-text-4)]">
                            {row.accounts}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-[var(--ea-text-1)]">
                        {fmtMnt(row.amount)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[11px] text-[var(--ea-text-3)]">
                        {STATUS_LABEL[row.status] ?? row.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "danger";
}) {
  return (
    <div className="bg-[var(--ea-surface)] px-4 py-3">
      <div className="truncate text-[11px] text-[var(--ea-text-3)]">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-base font-semibold",
          tone === "danger"
            ? "text-[var(--ea-danger-fg)]"
            : tone === "success"
              ? "text-[var(--ea-success-fg)]"
              : "text-[var(--ea-text-1)]"
        )}
      >
        {fmtMnt(value)}
      </div>
    </div>
  );
}

/* ── П15 — KPI картын туслахууд (server-safe, зөвхөн SVG/div + --ea-* токен) ── */

function KpiCard({
  href,
  label,
  value,
  valueLabel,
  valueTone,
  children,
}: {
  href: string;
  label: string;
  value: string;
  valueLabel?: string;
  valueTone?: "default" | "danger";
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="ea-card-interactive flex flex-col gap-2 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4"
      style={{ textDecoration: "none" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--ea-text-2)]">
          {label}
        </span>
        <Icon name="arrowRight" size="sm" className="text-[var(--ea-text-4)]" />
      </div>
      <div
        className={cn(
          "font-mono text-xl font-semibold",
          valueTone === "danger"
            ? "text-[var(--ea-danger-fg)]"
            : "text-[var(--ea-text-1)]"
        )}
      >
        {value}
      </div>
      {valueLabel && (
        <div className="-mt-1 text-[11px] text-[var(--ea-text-4)]">
          {valueLabel}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-1.5">{children}</div>
    </Link>
  );
}

/** Нэг цуврал шугаман sparkline — легенд хэрэггүй, гарчиг нь нэрлэнэ. */
function Sparkline({ series }: { series: { date: string; value: number }[] }) {
  if (series.length < 2) return null;
  const width = 220;
  const height = 48;
  const pad = 4;
  const values = series.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (index: number) =>
    pad + (index * (width - pad * 2)) / (series.length - 1);
  const y = (value: number) =>
    height - pad - ((value - min) * (height - pad * 2)) / span;
  const points = series
    .map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`)
    .join(" ");
  const last = series[series.length - 1];
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-12 w-full"
      role="img"
      aria-label={`Мөнгөн үлдэгдэл ${series[0].date} — ${last.date}`}
    >
      <title>{`${series[0].date} → ${last.date}: ${fmtMnt(min)} … ${fmtMnt(max)}`}</title>
      <polyline
        points={points}
        fill="none"
        stroke="var(--ea-interactive)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={x(series.length - 1)}
        cy={y(last.value)}
        r="3"
        fill="var(--ea-interactive)"
      />
    </svg>
  );
}

// Aging сагснууд: хугацаандаа = саарал (төлөв биш), хэтэрсэн нь warning
// нэг өнгөний гүнзгийрэх шат, 60+ = danger (ноцтой төлөв). Өнгө дангаараа
// утга илэрхийлэхгүй — legend мөр бүр нэр + дүнтэй.
const AGING_SEGMENTS: {
  key: "current" | "d1_30" | "d31_60" | "d61plus";
  label: string;
  color: string;
}[] = [
  { key: "current", label: "Хугацаандаа", color: "var(--ea-border-strong)" },
  {
    key: "d1_30",
    label: "1–30 хоног",
    color: "color-mix(in srgb, var(--ea-warning) 45%, var(--ea-surface))",
  },
  {
    key: "d31_60",
    label: "31–60 хоног",
    color: "color-mix(in srgb, var(--ea-warning) 80%, var(--ea-surface))",
  },
  { key: "d61plus", label: "60+ хоног", color: "var(--ea-danger)" },
];

function AgingBar({ aging }: { aging: HomeAging }) {
  if (aging.total <= 0)
    return (
      <p className="text-[11px] text-[var(--ea-text-4)]">
        Нээлттэй үлдэгдэл алга.
      </p>
    );
  return (
    <>
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full">
        {AGING_SEGMENTS.filter((segment) => aging[segment.key] > 0).map(
          (segment) => (
            <div
              key={segment.key}
              title={`${segment.label}: ${fmtMnt(aging[segment.key])}`}
              style={{
                background: segment.color,
                width: `${Math.max((aging[segment.key] / aging.total) * 100, 3)}%`,
              }}
            />
          )
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {AGING_SEGMENTS.map((segment) => (
          <div
            key={segment.key}
            className="flex items-center gap-1.5 text-[11px] text-[var(--ea-text-3)]"
          >
            <span
              className="size-2 shrink-0 rounded-sm"
              style={{ background: segment.color }}
            />
            <span className="truncate">{segment.label}</span>
            <span className="ml-auto font-mono text-[var(--ea-text-2)]">
              {fmtMnt(aging[segment.key])}
            </span>
          </div>
        ))}
      </div>
      {aging.topName && (
        <p className="text-[11px] text-[var(--ea-text-4)]">
          Топ: {aging.topName} · {aging.topShare}%
        </p>
      )}
    </>
  );
}

/** Сүүлийн 6 сарын орлого/зардлын хос багана — 2 цуврал тул legend-тэй. */
function TrendBars({
  trend,
}: {
  trend: { month: string; revenue: number; expense: number }[];
}) {
  const max = Math.max(
    1,
    ...trend.flatMap((point) => [point.revenue, point.expense])
  );
  return (
    <>
      <div className="flex h-16 items-end gap-1.5">
        {trend.map((point) => (
          <div
            key={point.month}
            className="flex min-w-0 flex-1 items-end justify-center gap-[2px]"
          >
            <div
              title={`${fmtPeriodCode(point.month)} орлого: ${fmtMnt(point.revenue)}`}
              className="w-2/5 rounded-t-[3px]"
              style={{
                background: "var(--ea-success)",
                height: `${Math.max((point.revenue / max) * 100, point.revenue > 0 ? 4 : 1)}%`,
              }}
            />
            <div
              title={`${fmtPeriodCode(point.month)} зардал: ${fmtMnt(point.expense)}`}
              className="w-2/5 rounded-t-[3px]"
              style={{
                background: "var(--ea-danger)",
                height: `${Math.max((point.expense / max) * 100, point.expense > 0 ? 4 : 1)}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        {trend.map((point) => (
          <div
            key={point.month}
            className="flex-1 truncate text-center text-[10px] text-[var(--ea-text-4)]"
          >
            {fmtPeriodCode(point.month).slice(0, 3)}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 text-[11px] text-[var(--ea-text-3)]">
        <span className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-sm"
            style={{ background: "var(--ea-success)" }}
          />
          Орлого
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-sm"
            style={{ background: "var(--ea-danger)" }}
          />
          Зардал
        </span>
      </div>
    </>
  );
}

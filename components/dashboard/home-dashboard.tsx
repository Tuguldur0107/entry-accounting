// Системийн үндсэн самбарын үзүүлэлт. Тооцоолол бүхэлдээ серверт хийгддэг тул
// энэ component нь client bundle-д ороогүй (interaktiv зүйл байхгүй — зөвхөн
// Link болон CSS hover). Өнгө бүгд --ea-* токеноор.

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  FileSpreadsheet,
  Info,
  Landmark,
  Plus,
  Scale,
} from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { fmtPeriodCode } from "@/lib/periods/period";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

export type HomeClassSummary = {
  assets: number;
  liabilities: number;
  equity: number;
  monthRevenue: number;
  monthExpense: number;
  monthNetIncome: number;
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

const QUICK_ACTIONS = [
  { href: "/gl/journal/new", label: "Журнал бичих", icon: Plus, primary: true },
  { href: "/cash/statements", label: "Хуулга импорт", icon: FileSpreadsheet },
  { href: "/receivables/documents", label: "Нэхэмжлэл", icon: BookOpen },
  { href: "/gl/reports", label: "Тайлан", icon: Scale },
];

export function HomeDashboard({
  userName,
  periodCode,
  periodStatus,
  totalDebit,
  totalCredit,
  accountCount,
  classSummary,
  modules,
  alerts,
  recent,
}: {
  userName: string;
  periodCode: string;
  periodStatus: "open" | "closed" | "missing";
  totalDebit: number;
  totalCredit: number;
  accountCount: number;
  classSummary: HomeClassSummary;
  modules: HomeModuleTile[];
  alerts: HomeAlert[];
  recent: HomeRecentRow[];
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
            {userName ? `${userName} — системийн хяналт` : "Системийн хяналт"}
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            {fmtPeriodCode(periodCode)} · бүх модулийн нэгдсэн байдал —
            хавтан дээр дарж тухайн модуль руу орно
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
              ? "Период нээлттэй"
              : periodStatus === "closed"
                ? "Период хаагдсан"
                : "Период үүсээгүй"}
          </StatusBadge>
        </div>
      </div>

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
            <action.icon size={14} />
            {action.label}
          </Link>
        ))}
      </div>

      {/* Санхүүгийн байдал */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
          <Landmark size={15} className="text-[var(--ea-text-3)]" />
          Санхүүгийн байдал
        </h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--ea-r-md)] border border-[var(--ea-border)] bg-[var(--ea-border)] lg:grid-cols-6">
          <SummaryCell label="Актив" value={classSummary.assets} />
          <SummaryCell label="Өр төлбөр" value={classSummary.liabilities} />
          <SummaryCell label="Эздийн өмч" value={classSummary.equity} />
          <SummaryCell label="Орлого · период" value={classSummary.monthRevenue} />
          <SummaryCell label="Зардал · период" value={classSummary.monthExpense} />
          <SummaryCell
            label="Цэвэр ашиг · период"
            value={classSummary.monthNetIncome}
            tone={classSummary.monthNetIncome < 0 ? "danger" : "success"}
          />
        </div>
        <p className="mt-2 text-[11px] text-[var(--ea-text-4)]">
          Бичигдсэн журналаас өссөн дүнгээр · {accountCount} идэвхтэй данс
        </p>
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
                <ArrowRight size={13} className="text-[var(--ea-text-4)]" />
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
            <AlertTriangle size={15} className="text-[var(--ea-text-3)]" />
            Анхаарах шаардлагатай
          </h2>
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-[var(--ea-r-md)] border border-[var(--ea-border)] bg-[var(--ea-surface)] px-4 py-5 text-xs text-[var(--ea-text-3)]">
              <CheckCircle2 size={16} className="text-[var(--ea-success-fg)]" />
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
                        <Info size={15} />
                      ) : (
                        <AlertTriangle size={15} />
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
                      <ArrowRight size={11} />
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
              <CalendarClock size={15} className="text-[var(--ea-text-3)]" />
              Сүүлийн бичилтүүд
            </h2>
            <Link
              href="/gl/journal"
              className="flex items-center gap-1 text-[11px] text-[var(--ea-primary)]"
            >
              Бүгдийг харах
              <ArrowRight size={11} />
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

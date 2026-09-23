"use client";

// СИСТЕМИЙН ХЭМЖЭЭНИЙ периодын шүүлтүүр — topbar-т нэг л удаа суудаг.
//
//   [◀] [2026 · 7-р сар ▾] [▶]
//
// Мужийн төрөл (Сар / Улирлын эхнээс / Оны эхнээс) нь сонгогч цонхон ДОТОР —
// PTD/QTD/YTD товчлолыг нягтлан биш хэрэглэгч ойлгодоггүй бөгөөд топбарт
// 3 товч эзэлж байв (UI гайдын карт 8, ENT-061). PTD-ээс өөр муж сонгосон
// үед л trigger дээр ил тэмдэглэгдэнэ.
//
// Сонголт cookie-д хадгалагдаж (savePeriodSelection) БҮХ модулийн server
// хуудас getPeriodSelection()-оор уншина — навигаци хийхэд дагаж явна.
// URL-ийн ил параметр (start/end, from/to, period…) сонголтыг дардаг тул
// deep link хэвээр ажиллана.
//
// Периодын нэр "JAN-26" форматтай (fmtPeriodCode). Scope:
//   PTD — сонгосон сар | QTD — улирлынх нь эхнээс | YTD — оны эхнээс
// Дуусах огноо нь одоогийн сард өнөөдрөөр таслагдана ("to date").

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";

import { savePeriodSelection } from "@/lib/actions/period-selection";
import {
  fmtPeriodCode,
  fmtPeriodLabelMn,
  nextPeriodCode,
  previousPeriodCode,
  recentPeriodCodes,
} from "@/lib/periods/period";
import {
  PERIOD_SCOPES,
  PERIOD_SCOPE_NAMES_MN,
  scopeRange,
  type PeriodScope,
} from "@/lib/periods/scope";
import { cn } from "@/lib/utils";

interface Props {
  /** Серверээс уншсан одоогийн сонголт (cookie). */
  initialPeriodCode: string;
  initialScope: PeriodScope;
  /** Улаанбаатарын өнөөдөр — dropdown-ий дээд хязгаар, мужийн таслал. */
  today: string;
}

/** Dropdown-д үзүүлэх сарын тоо (одоогийнхоос хойш). */
const MONTH_COUNT = 36;

export function PeriodFilter({ initialPeriodCode, initialScope, today }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [periodCode, setPeriodCode] = useState(initialPeriodCode);
  const [scope, setScope] = useState<PeriodScope>(initialScope);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const currentCode = today.slice(0, 7);
  // Одоогийн сараас 1 сар урагшийг зөвшөөрнө (урьдчилсан бичилт харах).
  const options = recentPeriodCodes(nextPeriodCode(currentCode), MONTH_COUNT);

  function apply(nextCode: string, nextScope: PeriodScope) {
    setPeriodCode(nextCode);
    setScope(nextScope);
    setOpen(false);
    startTransition(async () => {
      await savePeriodSelection(nextCode, nextScope);
      // Бүх server component шинэ сонголтоор дахин ачаална.
      router.refresh();
    });
  }

  const range = scopeRange(periodCode, scope, today);

  return (
    <div
      ref={rootRef}
      className="flex items-center gap-1.5"
      // Гадна дарахад dropdown хаагдана.
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      {/* Сар сонгогч: ◀ JUL-26 ▾ ▶ */}
      <div className="relative flex items-center rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)]">
        <button
          type="button"
          onClick={() => apply(previousPeriodCode(periodCode), scope)}
          disabled={isPending}
          title="Өмнөх сар"
          aria-label="Өмнөх сар"
          className="flex h-8 w-6 items-center justify-center text-[var(--ea-text-3)] transition-colors hover:text-[var(--ea-text-1)]"
        >
          <Icon name="chevronLeft" size="sm" />
        </button>

        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          disabled={isPending}
          title={`${PERIOD_SCOPE_NAMES_MN[scope]} · ${range.from} — ${range.to} (${fmtPeriodCode(periodCode)})`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Тайлант үе: ${fmtPeriodLabelMn(periodCode)}, ${PERIOD_SCOPE_NAMES_MN[scope]}`}
          className="flex h-8 items-center gap-1.5 whitespace-nowrap px-1.5 text-xs font-semibold text-[var(--ea-text-1)]"
        >
          <Icon name="period" size="sm" className="text-[var(--ea-text-3)]" />
          {fmtPeriodLabelMn(periodCode)}
          {scope !== "PTD" && (
            <span className="hidden font-normal text-[var(--ea-text-3)] sm:inline">
              · {PERIOD_SCOPE_NAMES_MN[scope]}
            </span>
          )}
          <Icon name="chevronDown" size="xs" className={cn( "text-[var(--ea-text-3)] transition-transform", open && "rotate-180" )} />
        </button>

        <button
          type="button"
          onClick={() => apply(nextPeriodCode(periodCode), scope)}
          disabled={isPending || periodCode >= nextPeriodCode(currentCode)}
          title="Дараагийн сар"
          aria-label="Дараагийн сар"
          className="flex h-8 w-6 items-center justify-center text-[var(--ea-text-3)] transition-colors hover:text-[var(--ea-text-1)] disabled:opacity-30"
        >
          <Icon name="chevronRight" size="sm" />
        </button>

        {open && (
          <div
            role="dialog"
            aria-label="Тайлант үе сонгох"
            className="absolute left-0 top-full z-[90] mt-1 w-56 rounded-md border border-[var(--ea-border-strong)] bg-[var(--ea-surface)] p-1.5"
            style={{ boxShadow: "var(--ea-shadow-3)" }}
          >
            <div
              className="mb-1.5 grid grid-cols-3 gap-0.5 rounded-md bg-[var(--ea-bg-2)] p-0.5"
              role="radiogroup"
              aria-label="Хугацааны муж"
            >
              {PERIOD_SCOPES.map((entry) => {
                const entryRange = scopeRange(periodCode, entry, today);
                return (
                  <button
                    key={entry}
                    type="button"
                    role="radio"
                    aria-checked={scope === entry}
                    onClick={() => apply(periodCode, entry)}
                    disabled={isPending}
                    title={`${entryRange.from} — ${entryRange.to}`}
                    className={cn(
                      "rounded px-1 py-1 text-[11px] font-medium leading-tight transition-colors",
                      scope === entry
                        ? "bg-[var(--ea-surface)] text-[var(--ea-text-1)] shadow-sm"
                        : "text-[var(--ea-text-3)] hover:text-[var(--ea-text-1)]"
                    )}
                  >
                    {PERIOD_SCOPE_NAMES_MN[entry]}
                  </button>
                );
              })}
            </div>
            <div role="listbox" aria-label="Сар" className="max-h-64 overflow-y-auto">
            {options.map((code) => {
              const selected = code === periodCode;
              const isCurrent = code === currentCode;
              return (
                <button
                  key={code}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => apply(code, scope)}
                  className={cn(
                    "flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition-colors",
                    selected
                      ? "bg-[var(--ea-primary)] text-[var(--primary-foreground)]"
                      : "text-[var(--ea-text-1)] hover:bg-[var(--ea-bg-2)]"
                  )}
                >
                  {fmtPeriodLabelMn(code)}
                  {isCurrent && (
                    <span
                      className={cn(
                        "text-[10px]",
                        selected ? "text-[var(--primary-foreground)] opacity-80" : "text-[var(--ea-text-4)]"
                      )}
                    >
                      одоо
                    </span>
                  )}
                </button>
              );
            })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

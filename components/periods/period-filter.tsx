"use client";

// СИСТЕМИЙН ХЭМЖЭЭНИЙ периодын шүүлтүүр — topbar-т нэг л удаа суудаг.
//
//   [◀] [JUL-26 ▾] [▶]  [PTD|QTD|YTD]
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
  nextPeriodCode,
  previousPeriodCode,
  recentPeriodCodes,
} from "@/lib/periods/period";
import {
  PERIOD_SCOPES,
  PERIOD_SCOPE_LABELS,
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
          title={`${range.from} — ${range.to}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex h-8 items-center gap-1.5 px-1.5 font-mono text-xs font-semibold text-[var(--ea-text-1)]"
        >
          <Icon name="period" size="sm" className="text-[var(--ea-text-3)]" />
          {fmtPeriodCode(periodCode)}
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
            role="listbox"
            aria-label="Тайлант үе сонгох"
            className="absolute left-0 top-full z-[90] mt-1 max-h-72 w-40 overflow-y-auto rounded-md border border-[var(--ea-border-strong)] bg-[var(--ea-surface)] p-1"
            style={{ boxShadow: "var(--ea-shadow-3)" }}
          >
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
                    "flex w-full items-center justify-between rounded px-2 py-1.5 font-mono text-xs transition-colors",
                    selected
                      ? "bg-[var(--ea-primary)] text-white"
                      : "text-[var(--ea-text-1)] hover:bg-[var(--ea-bg-2)]"
                  )}
                >
                  {fmtPeriodCode(code)}
                  {isCurrent && (
                    <span
                      className={cn(
                        "text-[10px]",
                        selected ? "text-white/80" : "text-[var(--ea-text-4)]"
                      )}
                    >
                      одоо
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* PTD / QTD / YTD */}
      <div
        className="flex h-8 items-center gap-0.5 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-0.5"
        role="radiogroup"
        aria-label="Мужийн төрөл"
      >
        {PERIOD_SCOPES.map((entry) => (
          <button
            key={entry}
            type="button"
            role="radio"
            aria-checked={scope === entry}
            onClick={() => apply(periodCode, entry)}
            disabled={isPending}
            title={`${PERIOD_SCOPE_LABELS[entry]} · ${scopeRange(periodCode, entry, today).from} — ${scopeRange(periodCode, entry, today).to}`}
            className={cn(
              "rounded px-2 py-1 font-mono text-[11px] font-semibold transition-colors",
              scope === entry
                ? "bg-[var(--ea-primary)] text-white"
                : "text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)] hover:text-[var(--ea-text-1)]"
            )}
          >
            {entry}
          </button>
        ))}
      </div>
    </div>
  );
}

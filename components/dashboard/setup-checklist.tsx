// П19 — Нүүрний setup checklist (QBO загвар): onboarding нь бүтээгдэхүүн
// дотроо амьдарна. Алхам бүр өгөгдлөөс АВТОМАТААР "хийгдсэн" болдог тул
// заавар унших шаардлагагүй; бүгд хийгдмэгц бүхэлдээ нуугдана.
// Server Component-д render хийгдэнэ (dashboard) — зөвхөн Link.

import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type SetupStep = {
  key: string;
  label: string;
  /** Товч тайлбар — юуг яагаад хийхийг нэг өгүүлбэрээр. */
  hint: string;
  href: string;
  done: boolean;
};

export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const doneCount = steps.filter((step) => step.done).length;
  if (doneCount === steps.length) return null;

  return (
    <section
      className="rounded-lg border p-4"
      style={{
        borderColor: "var(--ea-border)",
        background: "var(--ea-surface)",
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
          <Icon name="checklist" size="sm" className="text-[var(--ea-text-3)]" />
          Эхлэлийн тохиргоо
        </h2>
        <span className="text-xs text-[var(--ea-text-3)]">
          {doneCount}/{steps.length} хийгдсэн
        </span>
      </div>
      {/* Явцын зурвас */}
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[var(--ea-bg-2)]">
        <div
          className="h-full rounded-full bg-[var(--ea-primary)] transition-all"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {steps.map((step) => (
          <li key={step.key}>
            <Link
              href={step.href}
              title={step.hint}
              className={cn(
                "ea-interactive flex items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2",
                step.done && "opacity-60"
              )}
              style={{ textDecoration: "none" }}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  step.done
                    ? "border-transparent bg-[var(--ea-success)] text-white"
                    : "border-[var(--ea-border-strong)] text-transparent"
                )}
              >
                <Icon name="approve" size="xs" />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-xs font-medium",
                    step.done
                      ? "text-[var(--ea-text-3)] line-through"
                      : "text-[var(--ea-text-1)]"
                  )}
                >
                  {step.label}
                </span>
                <span className="block truncate text-[11px] text-[var(--ea-text-3)]">
                  {step.hint}
                </span>
              </span>
              {!step.done ? (
                <Icon
                  name="chevronRight"
                  size="sm"
                  className="shrink-0 text-[var(--ea-text-4)]"
                />
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

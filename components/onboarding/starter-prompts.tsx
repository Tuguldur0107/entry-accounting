"use client";

// Бэлэн асуултууд — хуулж ChatGPT / Claude-даа асуух (lib/onboarding/first-run.ts
// `STARTER_PROMPTS` — нүүрний карт, /ai хуудас, MCP prompts/list НЭГ эх).

import { Icon } from "@/components/ui/icon";
import { useCopyFlash } from "@/lib/hooks/use-copy-flash";
import type { StarterPrompt } from "@/lib/onboarding/first-run";
import { cn } from "@/lib/utils";

export function StarterPrompts({
  prompts,
  columns = 2,
}: {
  prompts: readonly StarterPrompt[];
  /** Картын өргөнөөс хамаарч 1 (нарийн багана) эсвэл 2 (бүтэн өргөн). */
  columns?: 1 | 2;
}) {
  const { copiedKey, copy } = useCopyFlash("Хуулагдлаа — ChatGPT / Claude-даа буулгаад илгээнэ үү");
  if (prompts.length === 0) return null;
  return (
    <ul className={cn("grid gap-2", columns === 2 && "sm:grid-cols-2")}>
      {prompts.map((prompt) => {
        const copied = copiedKey === prompt.id;
        return (
        <li key={prompt.id}>
          <button
            type="button"
            onClick={() => void copy(prompt.id, prompt.text)}
            title="Дарж хуулна"
            className={cn(
              "ea-interactive group flex w-full items-start gap-2 rounded-[var(--ea-r-md)] border bg-[var(--ea-bg)] px-3 py-2 text-left transition-colors",
              copied ? "border-[var(--ea-success)]" : "border-[var(--ea-border)]"
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--ea-text-1)]">
                {prompt.title}
                {prompt.writes ? (
                  <span className="rounded-full border border-dashed border-[var(--ea-border-strong)] px-1.5 text-[10px] font-normal text-[var(--ea-text-3)]">
                    ноорог
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-[11px] text-[var(--ea-text-3)]">
                {prompt.text}
              </span>
            </span>
            {copied ? (
              <Icon
                name="approve"
                size="sm"
                label="Хуулагдлаа"
                className="ea-pop mt-0.5 shrink-0 text-[var(--ea-success-fg)]"
              />
            ) : (
              <Icon
                name="copy"
                size="sm"
                className="mt-0.5 shrink-0 text-[var(--ea-text-4)] group-hover:text-[var(--ea-primary)]"
              />
            )}
          </button>
        </li>
        );
      })}
    </ul>
  );
}

"use client";

// Нэг мөр утга + «Хуулах» товч — MCP холболтын URL-д. Хуулмагц товч 1.5 сек
// «✓ Хуулагдлаа» болно (lib/hooks/use-copy-flash.ts).
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useCopyFlash } from "@/lib/hooks/use-copy-flash";

export function CopyValue({ value }: { value: string }) {
  const { copiedKey, copy } = useCopyFlash();
  const copied = copiedKey === value;
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-[var(--ea-r-sm)] border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2 font-mono text-xs text-[var(--ea-text-1)]">
        {value}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void copy(value, value)}
        aria-live="polite"
        className={copied ? "text-[var(--ea-success-fg)]" : undefined}
      >
        {copied ? (
          <>
            <Icon name="approve" size="xs" className="ea-pop" />
            Хуулагдлаа
          </>
        ) : (
          "Хуулах"
        )}
      </Button>
    </div>
  );
}

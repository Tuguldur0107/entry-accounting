"use client";

// Нэг мөр утга + «Хуулах» товч — MCP холболтын URL-д.
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function CopyValue({ value }: { value: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Хуулагдлаа");
    } catch {
      toast.error("Хуулж чадсангүй — гараар сонгож хуулна уу");
    }
  }
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-[var(--ea-r-sm)] border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2 font-mono text-xs text-[var(--ea-text-1)]">
        {value}
      </code>
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        Хуулах
      </Button>
    </div>
  );
}

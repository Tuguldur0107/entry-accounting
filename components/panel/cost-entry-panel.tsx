"use client";

// Өртгийн бичилтийн дэлгэрэнгүй панель.
// Payload: { entryId: string } — server action-аар татна, refreshToken-д
// дахин татна.

import type { PanelInstance } from "@/lib/store/panel-store";

export function CostEntryPanel({ panel }: { panel: PanelInstance }) {
  void panel;
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center text-sm text-[var(--ea-text-3)]">
      Тун удахгүй…
    </div>
  );
}

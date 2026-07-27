"use client";

// Мөнгөн гүйлгээний баримтын дэлгэрэнгүй панель.
// Payload: { documentId: string } — өгөгдлөө server action-аар өөрөө татна,
// panel.refreshToken өөрчлөгдөх бүрд дахин татна.

import type { PanelInstance } from "@/lib/store/panel-store";

export function CashDocPanel({ panel }: { panel: PanelInstance }) {
  void panel;
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center text-sm text-[var(--ea-text-3)]">
      Тун удахгүй…
    </div>
  );
}

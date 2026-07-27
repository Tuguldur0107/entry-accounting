"use client";

// АР/АП баримтын панель — үүсгэх (documentId байхгүй) эсвэл харах (байвал).
// Payload: { documentId?: string; mode: "receivable" | "payable" | "combined" }.
// Формын dirty төлвийг setDirty(panel.id, ...)-д мэдэгдэнэ.

import type { PanelInstance } from "@/lib/store/panel-store";

export function ArapDocPanel({ panel }: { panel: PanelInstance }) {
  void panel;
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center text-sm text-[var(--ea-text-3)]">
      Тун удахгүй…
    </div>
  );
}

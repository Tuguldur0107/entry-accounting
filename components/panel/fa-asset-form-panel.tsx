"use client";

// Хөрөнгө үүсгэх / картыг бөглөж идэвхжүүлэх форм панель.
// Payload: { assetId?: string } — өгвөл идэвхжүүлэлт, өгөхгүй бол шинэ.
// Формын dirty төлвийг setDirty(panel.id, ...)-д мэдэгдэнэ; хадгалсны дараа
// closePanel + router.refresh().

import type { PanelInstance } from "@/lib/store/panel-store";

export function FaAssetFormPanel({ panel }: { panel: PanelInstance }) {
  void panel;
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center text-sm text-[var(--ea-text-3)]">
      Тун удахгүй…
    </div>
  );
}

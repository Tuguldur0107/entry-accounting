"use client";

// Үндсэн хөрөнгийн карт — дэлгэрэнгүй панель.
// Payload: { assetId: string } — server action-аар татна, refreshToken-д
// дахин татна. "Бөглөж идэвхжүүлэх" үйлдэл нь openFaAssetFormPanel({assetId})
// панелийг нээнэ.

import type { PanelInstance } from "@/lib/store/panel-store";

export function FaAssetPanel({ panel }: { panel: PanelInstance }) {
  void panel;
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center text-sm text-[var(--ea-text-3)]">
      Тун удахгүй…
    </div>
  );
}

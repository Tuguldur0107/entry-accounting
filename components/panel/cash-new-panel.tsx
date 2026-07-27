"use client";

// Шинэ мөнгөн гүйлгээ / АР-АП төлөлт бичих панель.
// Payload: { arApDocumentId?: string } — өгвөл тухайн АР/АП баримтын төлөлт
// болгож урьдчилан бөглөнө. Сонголтын өгөгдлөө (данс, GL данс, урсгал,
// нээлттэй АР/АП баримт, сегмент) server action-аар татна.
// Бөглөлтийн dirty төлвийг setDirty(panel.id, ...)-д мэдэгдэнэ.

import type { PanelInstance } from "@/lib/store/panel-store";

export function CashNewPanel({ panel }: { panel: PanelInstance }) {
  void panel;
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center text-sm text-[var(--ea-text-3)]">
      Тун удахгүй…
    </div>
  );
}

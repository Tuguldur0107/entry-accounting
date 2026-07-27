"use client";

// AI туслах — глобал хөвөгч чат панель. Аль ч модульд ажиллаж байхдаа
// хажуудаа нээгээд байлгана. Registry-д keepMounted: true — хураастай ч
// unmount хийгдэхгүй (стрийм үргэлжилж, бичсэн draft хадгалагдана).

import type { PanelInstance } from "@/lib/store/panel-store";

export function AiChatPanel({ panel }: { panel: PanelInstance }) {
  void panel;
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center text-sm text-[var(--ea-text-3)]">
      Тун удахгүй…
    </div>
  );
}

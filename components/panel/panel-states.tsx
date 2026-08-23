"use client";

// Панелийн ачаалж-байна / алдааны төлвийн НЭГДСЭН харагдац — 8 панель
// copy-paste markup хэрэглэж байсныг нэг эх сурвалж болгов.

import { Icon } from "@/components/ui/icon";

export function PanelLoading() {
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center gap-2 text-sm text-[var(--ea-text-3)]">
      <Icon name="loading" className="animate-spin" />
      Ачаалж байна…
    </div>
  );
}

export function PanelError({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-center text-sm text-[var(--ea-danger)]">
      {message}
    </div>
  );
}

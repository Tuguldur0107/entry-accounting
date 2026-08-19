"use client";

// Grid-ийн дүнгийн нүдийг ЗАДАРГАА нээдэг товч болгох нэгдсэн renderer —
// кассын тулгалт, ҮХ-ийн GL тулгалт зэрэг бүх drill-down хүснэгт үүнийг
// ашиглана (давхардсан markup бичихгүй).

import type { ICellRendererParams } from "ag-grid-community";

export function clickableAmountCell<T>(
  onOpen: (data: T) => void,
  format: (value: number) => string
) {
  return function AmountCell(params: ICellRendererParams<T>) {
    if (params.value == null || !params.data) return "";
    return (
      <button
        type="button"
        onClick={() => onOpen(params.data!)}
        title="Задаргааг харах"
        className="w-full cursor-pointer text-right underline decoration-[var(--ea-border-strong)] decoration-dotted underline-offset-4 transition-colors hover:text-[var(--ea-primary)] hover:decoration-[var(--ea-primary)]"
      >
        {format(Number(params.value))}
      </button>
    );
  };
}

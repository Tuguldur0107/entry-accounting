"use client";

// Харилцагчийн сонгогч — АР/АП баримт, хангамжийн захиалга (PO), хүлээн
// авалтын баримт БҮГД энийг хэрэглэнэ (өөр сонгогч бичихийг хориглоно).
//
// Урьд нь components/panel/arap-doc-panel.tsx-ийн cpOptions + SearchableSelect
// байсан — зан төлөв нь зөөлтийн дараа ИЖИЛ: идэвхтэй харилцагчид, mode-ийн
// дагуу авлага/өглөгийн талаар шүүгдэж, ТТД hint-ээр ч хайгдана.

import { useMemo } from "react";

import { SearchableSelect } from "@/components/ui/searchable-select";
import type { CounterpartyView } from "@/lib/arap/types";

/** Сонгогчийн шүүлтүүр: combined = бүгд, receivable = худалдан авагч,
 *  payable = ханган нийлүүлэгч ("both" хоёуланд орно). */
export type CounterpartyMode = "combined" | "receivable" | "payable";

/** Сонголтын жагсаалт (label + ТТД hint) — grid/AI-д мөн хэрэглэгдэхүйц. */
export function counterpartyOptions(
  counterparties: CounterpartyView[],
  mode: CounterpartyMode
) {
  return counterparties
    .filter((item) => item.isActive)
    .filter((item) =>
      mode === "combined"
        ? true
        : mode === "receivable"
          ? item.counterpartyType === "customer" || item.counterpartyType === "both"
          : item.counterpartyType === "supplier" || item.counterpartyType === "both"
    )
    .map((item) => ({
      value: item.id,
      label: item.name,
      // ТТД hint-д орсноор хайлт ТТД-гээр ч шүүнэ (SearchableSelect
      // нь label/hint/value гурвуулангаар нь хайдаг).
      hint: [
        item.counterpartyType === "both"
          ? "Авлага/Өглөг"
          : item.counterpartyType === "customer"
            ? "Авлага"
            : "Өглөг",
        item.registerNo ? `ТТД ${item.registerNo}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
}

export function CounterpartySelect({
  value,
  onChange,
  counterparties,
  mode = "combined",
  placeholder = "Харилцагч сонгох...",
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  counterparties: CounterpartyView[];
  mode?: CounterpartyMode;
  placeholder?: string;
  disabled?: boolean;
}) {
  const options = useMemo(
    () => counterpartyOptions(counterparties, mode),
    [counterparties, mode]
  );

  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      hideValue
    />
  );
}

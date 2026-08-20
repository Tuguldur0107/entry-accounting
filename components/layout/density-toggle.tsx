"use client";

// П16 — мөрийн нягтралын сонгогч (топбар): Шахсан / Энгийн / Өргөн.
// Бүх grid-д нэг дор үйлчилж, сонголт хэрэглэгч бүрд (localStorage)
// хадгалагдана. Цэс нь ui/dropdown primitive-ийг reuse хийнэ.

import { useEffect, useState } from "react";

import { Dropdown, DropdownItem, DropdownLabel } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icon";
import type { GridDensity } from "@/lib/grid/theme";
import { useGridDensity } from "@/lib/store/density-store";

const OPTIONS: { value: GridDensity; label: string; hint: string }[] = [
  { value: "compact", label: "Шахсан", hint: "Excel шиг нягт мөр" },
  { value: "normal", label: "Энгийн", hint: "Одоогийн стандарт өндөр" },
  { value: "comfortable", label: "Өргөн", hint: "Уншихад хамгийн чөлөөтэй" },
];

export function DensityToggle() {
  const [open, setOpen] = useState(false);
  const density = useGridDensity((state) => state.density);
  const setDensity = useGridDensity((state) => state.setDensity);
  const hydrate = useGridDensity((state) => state.hydrate);

  // localStorage-оос нэг удаа сэргээнэ — SSR-тэй зөрөхгүй (initial "normal").
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      panelClassName="w-56"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          suppressHydrationWarning
          className="ea-icon-action flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-[var(--ea-border)] text-[var(--ea-text-2)]"
          title="Хүснэгтийн мөрийн нягтрал"
          aria-label="Хүснэгтийн мөрийн нягтрал"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Icon name="list" size="lg" className="pointer-events-none" />
        </button>
      }
    >
      <DropdownLabel>Мөрийн нягтрал</DropdownLabel>
      {OPTIONS.map((option) => (
        <DropdownItem
          key={option.value}
          selected={density === option.value}
          onSelect={() => {
            setDensity(option.value);
            setOpen(false);
          }}
        >
          <span className="flex-1">{option.label}</span>
          <span className="text-[10px]" style={{ color: "var(--ea-text-4)" }}>
            {option.hint}
          </span>
        </DropdownItem>
      ))}
    </Dropdown>
  );
}

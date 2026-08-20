// П16 — grid-ийн мөрийн нягтралын глобал store. Сонголт localStorage-д
// хадгалагдаж бүх DataGrid-д нэг дор үйлчилнэ. SSR/hydration-д аюулгүй:
// эхний утга үргэлж "normal", localStorage-оос сэргээх нь client дээр
// DensityToggle-ийн effect-ээр хийгдэнэ (theme-toggle.tsx-тэй ижил хэв маяг).

import { create } from "zustand";

import type { GridDensity } from "@/lib/grid/theme";

const STORAGE_KEY = "ea-grid-density";

function isDensity(value: string | null): value is GridDensity {
  return value === "compact" || value === "normal" || value === "comfortable";
}

export const useGridDensity = create<{
  density: GridDensity;
  setDensity: (density: GridDensity) => void;
  /** localStorage-оос сэргээх — client дээр нэг удаа (DensityToggle). */
  hydrate: () => void;
}>((set) => ({
  density: "normal",
  setDensity: (density) => {
    try {
      localStorage.setItem(STORAGE_KEY, density);
    } catch {
      /* private mode г.м. — session дотроо л үйлчилнэ */
    }
    set({ density });
  },
  hydrate: () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isDensity(saved)) set({ density: saved });
    } catch {
      /* ignore */
    }
  },
}));

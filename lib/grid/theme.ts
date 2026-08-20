// AG Grid v35 Theming API — themes are JS objects, not CSS imports.
// Map our --ea-* design tokens into Quartz theme params. Both light and
// dark resolve via CSS variables, so a single theme works for both modes.

import { themeQuartz } from "ag-grid-community";

const BASE_PARAMS = {
  backgroundColor: "var(--ea-surface)",
  foregroundColor: "var(--ea-text-1)",
  borderColor: "var(--ea-border)",
  chromeBackgroundColor: "var(--ea-bg-2)",
  headerBackgroundColor: "var(--ea-bg-2)",
  headerTextColor: "var(--ea-text-2)",
  headerFontWeight: 600,
  oddRowBackgroundColor: "var(--ea-surface)",
  rowHoverColor: "var(--ea-hover-subtle)",
  selectedRowBackgroundColor: "var(--ea-selected-bg)",
  rangeSelectionBorderColor: "var(--ea-interactive)",
  rangeSelectionBackgroundColor: "var(--ea-selected-bg)",
  accentColor: "var(--ea-interactive)",
  fontFamily: "inherit",
  wrapperBorderRadius: 8,
  borderRadius: 4,
} as const;

// П16 — мөрийн нягтралын 3 түвшин: Excel-ээс ирсэн нягтлан шахсаныг,
// шинэ хэрэглэгч өргөнийг сонгодог. Хэрэглэгчийн сонголт localStorage-д
// (lib/store/density-store.ts) хадгалагдаж БҮХ grid-д нэг дор үйлчилнэ.
export type GridDensity = "compact" | "normal" | "comfortable";

const DENSITY_PARAMS: Record<
  GridDensity,
  {
    rowHeight: number;
    headerHeight: number;
    fontSize: number;
    cellHorizontalPadding: number;
  }
> = {
  compact: {
    rowHeight: 30,
    headerHeight: 32,
    fontSize: 12,
    cellHorizontalPadding: 8,
  },
  normal: {
    rowHeight: 36,
    headerHeight: 36,
    fontSize: 13,
    cellHorizontalPadding: 12,
  },
  comfortable: {
    rowHeight: 44,
    headerHeight: 40,
    fontSize: 13,
    cellHorizontalPadding: 16,
  },
};

// Theme объектууд нэг удаа бүтээгдэж тогтвортой reference өгнө — AG Grid
// theme prop өөрчлөгдөхөд л дахин стайлддаг.
const THEMES: Record<GridDensity, ReturnType<typeof themeQuartz.withParams>> =
  {
    compact: themeQuartz.withParams({
      ...BASE_PARAMS,
      ...DENSITY_PARAMS.compact,
    }),
    normal: themeQuartz.withParams({ ...BASE_PARAMS, ...DENSITY_PARAMS.normal }),
    comfortable: themeQuartz.withParams({
      ...BASE_PARAMS,
      ...DENSITY_PARAMS.comfortable,
    }),
  };

export function gridThemeFor(density: GridDensity) {
  return THEMES[density];
}

/**
 * Мөр/толгойн өндөр grid option-оор ч дамждаг — theme-ийн CSS хувьсагчийг
 * AG Grid ажиллаж байх үедээ дахин уншдаггүй тул DataGrid эдгээрийг
 * reactive prop болгож өгнө (caller өөрийн rowHeight/getRowHeight-оор
 * дарж болно).
 */
export function densityHeights(density: GridDensity) {
  return {
    rowHeight: DENSITY_PARAMS[density].rowHeight,
    headerHeight: DENSITY_PARAMS[density].headerHeight,
  };
}

/** Хуучин callsite-уудад — "энгийн" нягтралын theme. */
export const eaGridTheme = THEMES.normal;

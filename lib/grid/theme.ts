// AG Grid v35 Theming API — themes are JS objects, not CSS imports.
// Map our --ea-* design tokens into Quartz theme params. Both light and
// dark resolve via CSS variables, so a single theme works for both modes.

import { themeQuartz } from "ag-grid-community";

export const eaGridTheme = themeQuartz.withParams({
  backgroundColor: "var(--ea-surface)",
  foregroundColor: "var(--ea-text-1)",
  borderColor: "var(--ea-border)",
  chromeBackgroundColor: "var(--ea-bg-2)",
  headerBackgroundColor: "var(--ea-bg-2)",
  headerTextColor: "var(--ea-text-2)",
  headerFontWeight: 600,
  oddRowBackgroundColor: "var(--ea-surface)",
  rowHoverColor: "var(--ea-bg-2)",
  selectedRowBackgroundColor: "var(--ea-primary-50)",
  rangeSelectionBorderColor: "var(--ea-primary)",
  rangeSelectionBackgroundColor: "var(--ea-primary-50)",
  accentColor: "var(--ea-primary)",
  fontFamily: "inherit",
  fontSize: 13,
  rowHeight: 36,
  headerHeight: 36,
  cellHorizontalPadding: 12,
  wrapperBorderRadius: 8,
  borderRadius: 4,
});

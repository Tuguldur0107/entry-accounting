"use client";

import { forwardRef, useMemo, useImperativeHandle, useRef } from "react";
import { AgGridReact, type AgGridReactProps } from "ag-grid-react";
import type {
  GridApi,
  GridReadyEvent,
  ProcessDataFromClipboardParams,
  RowDataUpdatedEvent,
} from "ag-grid-community";

import { ensureGridRegistered } from "./registerGrid";
import { eaGridTheme } from "./theme";
import { ChecklistFilter } from "./filters/ChecklistFilter";

// Register AG Grid modules SYNCHRONOUSLY at module load — before any
// <AgGridReact> mounts. `useEffect` would fire after the grid tries to
// initialize, producing "No AG Grid modules are registered" (#272).
// This file is "use client" + only imported via EaGridDynamic (ssr:false),
// so the call runs once on the client per browser session.
ensureGridRegistered();

export interface EaGridHandle {
  api: GridApi | null;
}

export interface EaGridProps<TData = unknown>
  extends Omit<AgGridReactProps<TData>, "theme"> {
  clipboard?: {
    onProcess?: (rows: string[][]) => string[][];
  };
  height?: number | string;
  wrapperClassName?: string;
}

function EaGridInner<TData>(
  props: EaGridProps<TData>,
  ref: React.Ref<EaGridHandle>
) {
  const {
    clipboard,
    height = 480,
    wrapperClassName,
    onGridReady,
    onRowDataUpdated,
    processDataFromClipboard,
    defaultColDef,
    autoSizeStrategy,
    ...rest
  } = props;

  const apiRef = useRef<GridApi | null>(null);

  useImperativeHandle(ref, () => ({ api: apiRef.current }), []);

  // Default column behaviour. The header gets a dedicated filter icon
  // (Excel-style) instead of an inline floating-filter row. Clicking the
  // icon opens our custom `ChecklistFilter`: a search box plus a
  // multi-select checkbox list of the column's unique values. Surfaces
  // that don't want filtering (structured financial statements, the
  // journal-entry editor) override these flags on their own
  // `defaultColDef`.
  const mergedDefaultColDef = useMemo(
    () => ({
      resizable: true,
      sortable: true,
      filter: ChecklistFilter,
      floatingFilter: false,
      suppressHeaderFilterButton: false,
      suppressMovable: true,
      ...defaultColDef,
    }),
    [defaultColDef]
  );

  function handleReady(e: GridReadyEvent<TData>) {
    apiRef.current = e.api;
    onGridReady?.(e);
  }

  // AG Grid's `autoSizeStrategy` only fires on the initial column setup —
  // when rowData changes (e.g. user clicks the header "Хайх" with a new
  // date range), columns keep their original widths. Re-run autoSize on
  // every data update so the fit stays consistent with the current rows.
  function handleRowDataUpdated(e: RowDataUpdatedEvent<TData>) {
    if (
      autoSizeStrategy &&
      "type" in autoSizeStrategy &&
      autoSizeStrategy.type === "fitCellContents"
    ) {
      e.api.autoSizeAllColumns(false);
    }
    onRowDataUpdated?.(e);
  }

  function handleClipboard(params: ProcessDataFromClipboardParams<TData>) {
    const userResult = processDataFromClipboard?.(params);
    let rows: string[][] = userResult ?? params.data ?? [];
    if (clipboard?.onProcess) {
      rows = clipboard.onProcess(rows);
    }
    return rows;
  }

  return (
    <div
      className={wrapperClassName}
      style={{
        height,
        width: "100%",
        "--ea-grid-bg": "var(--ea-surface)",
      } as React.CSSProperties}
    >
      <AgGridReact<TData>
        theme={eaGridTheme}
        onGridReady={handleReady}
        onRowDataUpdated={handleRowDataUpdated}
        autoSizeStrategy={autoSizeStrategy}
        defaultColDef={mergedDefaultColDef}
        processDataFromClipboard={handleClipboard}
        animateRows={false}
        suppressDragLeaveHidesColumns
        // `cellSelection` (range selection) is enterprise in AG Grid v35;
        // keep it off. To still support Excel-style multi-row / multi-column
        // copy in community we disable browser-native text selection and
        // let AG Grid's row clipboard take over — Ctrl+C on selected rows
        // emits TSV that pastes into Excel / Sheets preserving columns.
        cellSelection={false}
        enableCellTextSelection={false}
        stopEditingWhenCellsLoseFocus
        singleClickEdit={false}
        suppressClickEdit={false}
        rowSelection={{
          mode: "multiRow",
          checkboxes: false,
          headerCheckbox: false,
          enableClickSelection: true,
        }}
        {...rest}
      />
    </div>
  );
}

export const EaGrid = forwardRef(EaGridInner) as <TData>(
  props: EaGridProps<TData> & { ref?: React.Ref<EaGridHandle> }
) => React.ReactElement;

export default EaGrid;

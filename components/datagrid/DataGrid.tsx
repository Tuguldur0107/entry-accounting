"use client";

import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { AgGridReact, type AgGridReactProps } from "ag-grid-react";
import type {
  GridApi,
  GridReadyEvent,
  ProcessDataFromClipboardParams,
  RowDataUpdatedEvent,
} from "ag-grid-community";

import { ensureGridRegistered } from "@/lib/grid/registerGrid";
import { eaGridTheme } from "@/lib/grid/theme";
import { ComboFilter } from "./ComboFilter";
import "./datagrid.css";

ensureGridRegistered();

export interface DataGridHandle {
  api: GridApi | null;
}

export interface DataGridProps<TData = unknown>
  extends Omit<AgGridReactProps<TData>, "theme"> {
  clipboard?: {
    onProcess?: (rows: string[][]) => string[][];
  };
  /**
   * Пикселийн өндөр, CSS утга, эсвэл "flex" — flex үед wrapper нь эцэг
   * flex-колонкоо дүүргэнэ (flex:1 min-h-0). Эцэг гинж нь main хүртэл
   * flex байх ёстой; үгүй бол minHeight fallback (320px) хэрэглэгдэнэ.
   */
  height?: number | string;
  wrapperClassName?: string;
  pageSize?: number;
  showSelectionCheckboxes?: boolean;
}

function DataGridInner<TData>(
  props: DataGridProps<TData>,
  ref: React.Ref<DataGridHandle>
) {
  const {
    clipboard,
    height = 480,
    wrapperClassName,
    pageSize,
    showSelectionCheckboxes = false,
    onGridReady,
    onRowDataUpdated,
    processDataFromClipboard,
    defaultColDef,
    autoSizeStrategy,
    pagination,
    paginationPageSize,
    rowSelection,
    ...rest
  } = props;

  const apiRef = useRef<GridApi | null>(null);

  useImperativeHandle(ref, () => ({ api: apiRef.current }), []);

  const mergedDefaultColDef = useMemo(
    () => ({
      resizable: true,
      sortable: true,
      filter: ComboFilter,
      floatingFilter: false,
      suppressHeaderFilterButton: false,
      suppressMovable: true,
      minWidth: 90,
      ...defaultColDef,
    }),
    [defaultColDef]
  );

  function handleReady(event: GridReadyEvent<TData>) {
    apiRef.current = event.api;
    onGridReady?.(event);
  }

  function handleRowDataUpdated(event: RowDataUpdatedEvent<TData>) {
    if (
      autoSizeStrategy &&
      "type" in autoSizeStrategy &&
      autoSizeStrategy.type === "fitCellContents"
    ) {
      event.api.autoSizeAllColumns(false);
    }
    onRowDataUpdated?.(event);
  }

  function handleClipboard(params: ProcessDataFromClipboardParams<TData>) {
    const userResult = processDataFromClipboard?.(params);
    let rows: string[][] = userResult ?? params.data ?? [];
    if (clipboard?.onProcess) rows = clipboard.onProcess(rows);
    return rows;
  }

  const selection =
    rowSelection ??
    ({
      mode: "multiRow",
      checkboxes: showSelectionCheckboxes,
      headerCheckbox: showSelectionCheckboxes,
      enableClickSelection: true,
    } as const);

  const resolvedPagination = pagination ?? pageSize !== undefined;
  const resolvedPageSize = paginationPageSize ?? pageSize;

  const isFlex = height === "flex";

  return (
    <div
      className={`ea-data-grid${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      style={
        {
          flex: isFlex ? "1 1 auto" : undefined,
          minHeight: isFlex ? 320 : undefined,
          height: isFlex ? undefined : height,
          width: "100%",
          "--ea-grid-bg": "var(--ea-surface)",
        } as React.CSSProperties
      }
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
        cellSelection={false}
        enableCellTextSelection={false}
        stopEditingWhenCellsLoseFocus
        singleClickEdit={false}
        suppressClickEdit={false}
        columnHoverHighlight
        rowSelection={selection}
        pagination={resolvedPagination}
        paginationPageSize={resolvedPageSize}
        {...rest}
      />
    </div>
  );
}

export const DataGrid = forwardRef(DataGridInner) as <TData>(
  props: DataGridProps<TData> & { ref?: React.Ref<DataGridHandle> }
) => React.ReactElement;

export default DataGrid;


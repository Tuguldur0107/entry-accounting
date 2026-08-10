"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { AgGridReact, type AgGridReactProps } from "ag-grid-react";
import type {
  CellClassParams,
  CellClickedEvent,
  ColDef,
  ColGroupDef,
  GridApi,
  GridReadyEvent,
  ProcessDataFromClipboardParams,
  RowDataUpdatedEvent,
} from "ag-grid-community";
import { toast } from "sonner";

import { ensureGridRegistered } from "@/lib/grid/registerGrid";
import { eaGridTheme } from "@/lib/grid/theme";
import { ComboFilter } from "./ComboFilter";
import "./datagrid.css";

ensureGridRegistered();

// Excel-маягийн нүдний мужийн сонголт: AG Grid Community-д range selection
// байхгүй (Enterprise feature) тул wrapper дээр өөрсдөө хэрэгжүүлнэ.
// Нэг агшинд НЭГ л grid-д сонголт идэвхтэй — өөр grid дээр дарахад
// өмнөхийнх нь арилна.
let clearActiveRange: (() => void) | null = null;

function isFillDownShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    (event.code === "KeyD" || event.key.toLowerCase() === "d")
  );
}

interface CellRange {
  /** Дэлгэцийн мөрийн индексийн муж [эхлэл, төгсгөл]. */
  rows: [number, number];
  /** Мужид орсон баганын colId-ууд (display дарааллын үргэлжилсэн зүсэлт). */
  colIds: Set<string>;
  /** Shift+click-ийн зангуу — анхны дарсан нүд. */
  anchor: { row: number; col: number };
}

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
    onCellClicked,
    processDataFromClipboard,
    defaultColDef,
    columnDefs,
    autoSizeStrategy,
    pagination,
    paginationPageSize,
    rowSelection,
    ...rest
  } = props;

  const apiRef = useRef<GridApi | null>(null);
  const rangeRef = useRef<CellRange | null>(null);

  useImperativeHandle(ref, () => ({ api: apiRef.current }), []);

  const clearRange = useCallback(() => {
    if (!rangeRef.current) return;
    rangeRef.current = null;
    const api = apiRef.current;
    if (api && !api.isDestroyed()) {
      api.refreshCells({ force: true, suppressFlash: true });
    }
  }, []);

  // cellClassRules предикат — сонголтын муж дотор орсон нүдэнд range класс өгнө.
  const isInRange = useCallback((params: CellClassParams<TData>) => {
    const sel = rangeRef.current;
    if (!sel || params.node.rowPinned) return false;
    const rowIndex = params.node.rowIndex;
    if (rowIndex == null || rowIndex < sel.rows[0] || rowIndex > sel.rows[1]) {
      return false;
    }
    const colId =
      params.column?.getColId() ??
      params.colDef.colId ??
      (params.colDef as ColDef<TData>).field;
    return colId != null && sel.colIds.has(colId);
  }, []);

  // Багана бүрийн cellClassRules дотор range rule-ээ шингээнэ — колонк өөрөө
  // cellClassRules зарласан байсан ч (ж: журналын Дт/Кт сөрөг дүн) дарагдахгүй.
  const decoratedColumnDefs = useMemo(() => {
    if (!columnDefs) return columnDefs;
    const decorate = (
      defs: (ColDef<TData> | ColGroupDef<TData>)[]
    ): (ColDef<TData> | ColGroupDef<TData>)[] =>
      defs.map((def) => {
        if ("children" in def && Array.isArray(def.children)) {
          return {
            ...def,
            children: decorate(
              def.children as (ColDef<TData> | ColGroupDef<TData>)[]
            ),
          };
        }
        const col = def as ColDef<TData>;
        return {
          ...col,
          cellClassRules: {
            ...col.cellClassRules,
            "ea-range-cell": isInRange,
          },
        };
      });
    return decorate(columnDefs as (ColDef<TData> | ColGroupDef<TData>)[]);
  }, [columnDefs, isInRange]);

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
      cellClassRules: {
        ...defaultColDef?.cellClassRules,
        "ea-range-cell": isInRange,
      },
    }),
    [defaultColDef, isInRange]
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

  // Нэг дарахад зангуу тавина, Shift+дарахад зангуунаас тэгш өнцөгт муж үүснэ.
  function handleCellClicked(event: CellClickedEvent<TData>) {
    const rowIndex = event.node.rowIndex;
    if (rowIndex != null && !event.node.rowPinned) {
      const displayed = event.api.getAllDisplayedColumns();
      const colIndex = displayed.indexOf(event.column);
      if (colIndex >= 0) {
        const mouse = event.event as MouseEvent | null;
        const prev = rangeRef.current;
        if (mouse?.shiftKey && prev) {
          const r1 = Math.min(prev.anchor.row, rowIndex);
          const r2 = Math.max(prev.anchor.row, rowIndex);
          const c1 = Math.min(prev.anchor.col, colIndex);
          const c2 = Math.max(prev.anchor.col, colIndex);
          rangeRef.current = {
            rows: [r1, r2],
            colIds: new Set(
              displayed.slice(c1, c2 + 1).map((col) => col.getColId())
            ),
            anchor: prev.anchor,
          };
        } else {
          rangeRef.current = {
            rows: [rowIndex, rowIndex],
            colIds: new Set([event.column.getColId()]),
            anchor: { row: rowIndex, col: colIndex },
          };
        }
        if (clearActiveRange && clearActiveRange !== clearRange) {
          clearActiveRange();
        }
        clearActiveRange = clearRange;
        event.api.refreshCells({ force: true, suppressFlash: true });
      }
    }
    onCellClicked?.(event);
  }

  function handleGridKeyDownCapture(
    event: React.KeyboardEvent<HTMLDivElement>
  ) {
    const api = apiRef.current;
    if (!api || api.isDestroyed() || !isFillDownShortcut(event.nativeEvent)) {
      return;
    }

    const focusedCell = api.getFocusedCell();
    if (!focusedCell) return;

    // Browser bookmark болон AG Grid-ийн дараагийн keyboard handler-ийг зогсооно.
    // Хуулалтыг энд шууд хийх тул custom editor event bubble хийхээс хамаарахгүй.
    event.preventDefault();
    event.stopPropagation();

    if (focusedCell.rowPinned || focusedCell.rowIndex <= 0) return;

    const currentRow = api.getDisplayedRowAtIndex(focusedCell.rowIndex);
    const previousRow = api.getDisplayedRowAtIndex(focusedCell.rowIndex - 1);
    if (
      !currentRow ||
      !previousRow ||
      currentRow.rowPinned ||
      previousRow.rowPinned ||
      currentRow.data === undefined ||
      previousRow.data === undefined ||
      !focusedCell.column.isCellEditable(currentRow)
    ) {
      return;
    }

    const previousValue = api.getCellValue({
      rowNode: previousRow,
      colKey: focusedCell.column,
    });

    // Editor нээлттэй бол бичиж байсан түр утгыг цуцлаад өмнөх мөрийн утгыг тавина.
    api.stopEditing(true);
    currentRow.setDataValue(focusedCell.column, previousValue, "edit");
    api.setFocusedCell(
      focusedCell.rowIndex,
      focusedCell.column,
      focusedCell.rowPinned
    );
  }

  // Ctrl/Cmd+C — сонгосон мужийг TSV болгож clipboard-д тавина (Excel paste-д
  // бэлэн); Esc — сонголтыг арилгана. Editor нээлттэй (input фокустай) үед
  // хөндөхгүй.
  useEffect(() => {
    function cellText(
      api: GridApi,
      rowNode: NonNullable<ReturnType<GridApi["getDisplayedRowAtIndex"]>>,
      colId: string
    ): string {
      const raw = api.getCellValue({ rowNode, colKey: colId });
      // Тоон утгыг түүхийгээр нь өгнө — "1,234,567" текст биш 1234567 гэсэн
      // тоо болж Excel-д буухын тулд.
      if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
      const formatted = api.getCellValue({
        rowNode,
        colKey: colId,
        useFormatter: true,
      });
      const value = formatted ?? raw;
      if (value == null || typeof value === "object") return "";
      return String(value).replace(/[\t\r\n]+/g, " ").trim();
    }

    function buildTsv(api: GridApi, sel: CellRange): string | null {
      const cols = api
        .getAllDisplayedColumns()
        .filter((col) => sel.colIds.has(col.getColId()));
      if (cols.length === 0) return null;
      const lines: string[] = [];
      for (let r = sel.rows[0]; r <= sel.rows[1]; r += 1) {
        const rowNode = api.getDisplayedRowAtIndex(r);
        if (!rowNode) continue;
        lines.push(
          cols.map((col) => cellText(api, rowNode, col.getColId())).join("\t")
        );
      }
      return lines.length > 0 ? lines.join("\n") : null;
    }

    function onKeyDown(e: KeyboardEvent) {
      const sel = rangeRef.current;
      const api = apiRef.current;
      if (!sel || !api || api.isDestroyed()) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape") {
        clearRange();
        return;
      }
      if (
        !(e.metaKey || e.ctrlKey) ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== "c"
      ) {
        return;
      }
      // Хэрэглэгч энгийн текст сонгосон байвал browser-ийн copy-г хөндөхгүй.
      const native = window.getSelection?.();
      if (native && !native.isCollapsed) return;
      const tsv = buildTsv(api, sel);
      if (tsv == null) return;
      e.preventDefault();
      const rowCount = sel.rows[1] - sel.rows[0] + 1;
      navigator.clipboard
        ?.writeText(tsv)
        .then(() =>
          toast.success(
            `${rowCount} мөр × ${sel.colIds.size} багана хуулагдлаа`
          )
        )
        .catch(() =>
          toast.error("Хуулж чадсангүй — clipboard зөвшөөрөл шаардлагатай")
        );
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (clearActiveRange === clearRange) clearActiveRange = null;
    };
  }, [clearRange]);

  const selection =
    rowSelection ??
    ({
      mode: "multiRow",
      checkboxes: showSelectionCheckboxes,
      headerCheckbox: showSelectionCheckboxes,
      // Нэг даралт нь нүдний мужийн зангуу — мөрийн сонголт зөвхөн
      // checkbox-оор хийгдэнэ.
      enableClickSelection: false,
    } as const);

  const resolvedPagination = pagination ?? pageSize !== undefined;
  const resolvedPageSize = paginationPageSize ?? pageSize;

  const isFlex = height === "flex";

  return (
    <div
      className={`ea-data-grid${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      onKeyDownCapture={handleGridKeyDownCapture}
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
        onCellClicked={handleCellClicked}
        autoSizeStrategy={autoSizeStrategy}
        defaultColDef={mergedDefaultColDef}
        columnDefs={decoratedColumnDefs}
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

"use client";

// Журналын мөрийн хүснэгт — дахин ашиглагдах component.
// GL журнал бичих/засах, ирээдүйд Cash/VAT/Payroll модулиудад
// Данс + Дебет + Кредит + Тайлбар бүтэцтэй мөр оруулахад ашиглана.
//
// Гэрээ (CLAUDE.md § Хүснэгтийн стандарт):
//   - Данс багана: гараар бичих + ⌄ товчоор сегмент panel (AccountSegmentEditor)
//   - Дебет ⊕ Кредит mutex — нэг мөрд зөвхөн нэг тал
//   - Paste: TSV, дансны баганад active-only эсвэл 10-part код
//   - Pinned bottom мөрөнд нийт дүн

import { useCallback, useMemo } from "react";
import type {
  CellValueChangedEvent,
  ColDef,
  ICellRendererParams,
  ProcessDataFromClipboardParams,
} from "ag-grid-community";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { fmtMnt } from "@/lib/reports/balances";
import { fmtAccountDisplay, normalizePastedAccount } from "@/lib/grid/segments";
import { parseMntInput } from "@/lib/grid/formatters";
import { AccountSegmentEditor } from "@/lib/grid/editors/AccountSegmentEditor";
import { DebitCreditEditor } from "@/lib/grid/editors/DebitCreditEditor";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

// Сторногийн сөрөг дүнг улаанаар — "улаан сторно"-гийн уламжлалт тэмдэглэгээ.
const NEGATIVE_CELL_RULE = {
  "text-[var(--ea-danger)]": (p: { value: unknown }) => Number(p.value) < 0,
};

export interface JournalLineRow {
  id: string;
  account: string;
  debit: number;
  credit: number;
  description: string;
}

export interface JournalLinesGridProps {
  lines: JournalLineRow[];
  onLinesChange: (updater: (prev: JournalLineRow[]) => JournalLineRow[]) => void;
  activeSegIds: number[];
  segOptions: Record<number, SegOption[]>;
  defaultSegments?: Record<number, string>;
  /** Хамгийн бага мөрийн тоо — үүнээс цөөрүүлж устгахыг хориглоно (default 2) */
  minLines?: number;
  onError?: (message: string) => void;
  maxHeight?: number;
  /** Зөвхөн харах — засварлах, мөр устгах, paste идэвхгүй. */
  readOnly?: boolean;
}

export function JournalLinesGrid({
  lines,
  onLinesChange,
  activeSegIds,
  segOptions,
  defaultSegments = {},
  minLines = 2,
  onError,
  maxHeight = 560,
  readOnly = false,
}: JournalLinesGridProps) {
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

  const accountColWidth = useMemo(
    () =>
      Math.max(
        220,
        activeSegIds.reduce((s, id) => {
          const def = SEGMENT_DEFS.find((d) => d.id === id);
          return s + (def?.length ?? 4) * 9 + 14;
        }, 0)
      ),
    [activeSegIds]
  );

  // Single source of truth: AG Grid's onCellValueChanged → onLinesChange.
  const handleCellChange = useCallback(
    (e: CellValueChangedEvent<JournalLineRow>) => {
      const id = e.data.id;
      const field = e.colDef.field as keyof JournalLineRow | undefined;
      if (!field) return;
      onLinesChange((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          const next: JournalLineRow = { ...l, [field]: e.newValue } as JournalLineRow;
          // Dr ⊕ Cr mutex — state давхаргад баталгаажуулна.
          if (field === "debit" && (next.debit ?? 0) > 0) next.credit = 0;
          else if (field === "credit" && (next.credit ?? 0) > 0) next.debit = 0;
          return next;
        })
      );
    },
    [onLinesChange]
  );

  // Харах горимд дансны НЭРИЙГ тусдаа баганаар үзүүлнэ (S3 сонголтоос).
  const accountNameByMain = useMemo(
    () => new Map((segOptions[3] ?? []).map((option) => [option.code, option.name])),
    [segOptions]
  );

  const columnDefs = useMemo<ColDef<JournalLineRow>[]>(() => {
    const cols: ColDef<JournalLineRow>[] = [
      {
        headerName: "#",
        colId: "row-num",
        width: 48,
        cellClass: "ag-center-cell text-xs",
        editable: false,
        sortable: false,
        valueGetter: (p) =>
          p.node?.rowPinned || p.node?.rowIndex == null
            ? ""
            : p.node.rowIndex + 1,
      },
      {
        headerName: "Данс",
        field: "account",
        width: accountColWidth,
        editable: !readOnly,
        cellClass: "font-mono text-xs",
        cellEditor: AccountSegmentEditor,
        cellEditorParams: {
          activeSegIds,
          segOptions,
          extraDefaults: defaultSegments,
        },
        valueFormatter: (p) => fmtAccountDisplay(String(p.value ?? ""), activeSegIds),
      },
      {
        headerName: "Дансны нэр",
        colId: "account-name",
        width: 200,
        editable: false,
        sortable: false,
        cellClass: "text-xs text-[var(--ea-text-2)]",
        valueGetter: (p) => {
          if (!p.data || p.data.id === "__totals__") return "";
          const parts = String(p.data.account ?? "").split(".");
          const main = parts.length === 10 ? parts[2] : String(p.data.account ?? "");
          return accountNameByMain.get(main) ?? "";
        },
      },
      {
        headerName: "Дебет",
        field: "debit",
        width: 150,
        editable: !readOnly,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        cellEditor: DebitCreditEditor,
        valueParser: (p) => {
          const n = parseMntInput(p.newValue);
          return Number.isFinite(n) && n > 0 ? n : 0;
        },
        valueFormatter: (p) =>
          p.value && p.value !== 0 ? fmtMnt(Number(p.value)) : "",
        cellClassRules: NEGATIVE_CELL_RULE,
      },
      {
        headerName: "Кредит",
        field: "credit",
        width: 150,
        editable: !readOnly,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        cellEditor: DebitCreditEditor,
        valueParser: (p) => {
          const n = parseMntInput(p.newValue);
          return Number.isFinite(n) && n > 0 ? n : 0;
        },
        valueFormatter: (p) =>
          p.value && p.value !== 0 ? fmtMnt(Number(p.value)) : "",
        cellClassRules: NEGATIVE_CELL_RULE,
      },
      {
        headerName: "Тайлбар",
        field: "description",
        flex: 1,
        minWidth: 200,
        editable: !readOnly,
        cellClass: "text-xs",
      },
      {
        headerName: "",
        colId: "actions",
        width: 44,
        editable: false,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-center",
        cellRenderer: (p: ICellRendererParams<JournalLineRow>) => {
          const id = p.data?.id;
          return (
            <button
              type="button"
              onClick={() => {
                onLinesChange((prev) => {
                  if (prev.length <= minLines) {
                    onError?.(
                      `Дор хаяж ${minLines} мөр шаардлагатай. Мөр нэмээд буцаад устгана уу.`
                    );
                    return prev;
                  }
                  onError?.("");
                  return prev.filter((l) => l.id !== id);
                });
              }}
              title="Мөр устгах"
              className="w-6 h-6 flex items-center justify-center text-base leading-none cursor-pointer rounded transition-colors"
              style={{ color: "var(--ea-text-4)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--ea-danger)";
                e.currentTarget.style.background =
                  "color-mix(in srgb, var(--ea-danger) 10%, transparent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--ea-text-4)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              ×
            </button>
          );
        },
      },
    ];
    // Засварлах горимд нэрийн багана хэрэггүй (editor доторх picker нэрийг
    // үзүүлдэг); харах горимд устгах багана хэрэггүй.
    return readOnly
      ? cols.filter((col) => col.colId !== "actions")
      : cols.filter((col) => col.colId !== "account-name");
  }, [accountColWidth, activeSegIds, segOptions, defaultSegments, minLines, onError, onLinesChange, readOnly, accountNameByMain]);

  const processDataFromClipboard = useCallback(
    (p: ProcessDataFromClipboardParams<JournalLineRow>) => {
      const rows = p.data;
      if (!rows || rows.length === 0) return rows;
      const types = columnDefs.map((c) =>
        c.field === "account" ? "account-segment" : "other"
      );
      return rows.map((row) =>
        row.map((cell, i) =>
          types[i] === "account-segment"
            ? normalizePastedAccount(cell, activeSegIds, defaultSegments)
            : cell
        )
      );
    },
    [columnDefs, activeSegIds, defaultSegments]
  );

  const pinnedBottom = useMemo(
    () => [
      {
        id: "__totals__",
        account: "",
        debit: totalDebit,
        credit: totalCredit,
        description: "Нийт дүн",
      } as JournalLineRow,
    ],
    [totalDebit, totalCredit]
  );

  return (
    <DataGridDynamic<JournalLineRow>
      rowData={lines}
      columnDefs={columnDefs}
      getRowId={(p) => p.data.id}
      pinnedBottomRowData={pinnedBottom}
      onCellValueChanged={handleCellChange}
      processDataFromClipboard={processDataFromClipboard}
      height={Math.min(maxHeight, 90 + lines.length * 36 + 48)}
      singleClickEdit
      stopEditingWhenCellsLoseFocus
      undoRedoCellEditing
      undoRedoCellEditingLimit={100}
      suppressClickEdit={false}
      wrapperClassName="ea-journal-lines"
      enableCellTextSelection
    />
  );
}

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

import { useCallback, useMemo, useState } from "react";
import { IconAction } from "@/components/ui/icon-action";
import { Icon } from "@/components/ui/icon";
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
import { AccountSegmentPanel } from "@/components/account/account-segment-panel";
import { DebitCreditEditor } from "@/lib/grid/editors/DebitCreditEditor";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { applyJournalAmountSuggestion } from "@/lib/grid/journal-amount-suggestion";

// Буцаалтгийн сөрөг дүнг улаанаар — "улаан буцаалт"-гийн уламжлалт тэмдэглэгээ.
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

  // Харах горимд ДАНС нүд дээр дарахад — журнал бичихэд гардагтай ижил
  // сегментийн panel (readOnly).
  const [segPanel, setSegPanel] = useState<{
    code: string;
    anchor: DOMRect;
  } | null>(null);
  const closeSegPanel = useCallback(() => setSegPanel(null), []);

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
      if (field === "debit" || field === "credit") {
        onLinesChange((prev) =>
          applyJournalAmountSuggestion(prev, id, field, e.newValue)
        );
        return;
      }
      onLinesChange((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          return { ...l, [field]: e.newValue } as JournalLineRow;
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
        editable: (p) => !readOnly && !p.node?.rowPinned,
        cellEditor: AccountSegmentEditor,
        cellEditorParams: {
          activeSegIds,
          segOptions,
          extraDefaults: defaultSegments,
        },
        valueFormatter: (p) =>
          p.node?.rowPinned
            ? "Нийт дүн"
            : fmtAccountDisplay(String(p.value ?? ""), activeSegIds),
        cellClass: (p) =>
          p.node?.rowPinned
            ? "font-semibold text-[var(--ea-text-1)]"
            : "font-mono text-xs",
        // Харах горимд нүд засагдахгүй тул дарахад сегментийн panel нээнэ.
        cellRenderer: readOnly
          ? (p: ICellRendererParams<JournalLineRow>) => {
              if (!p.data || p.node?.rowPinned) return p.valueFormatted ?? "";
              const code = String(p.data.account ?? "");
              return (
                <button
                  type="button"
                  data-account-segment-trigger
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    // Ижил нүд дээр дахин дарвал хаана (toggle).
                    setSegPanel((prev) =>
                      prev && prev.code === code ? null : { code, anchor: rect }
                    );
                  }}
                  title="Сегментээр харах"
                  className="flex h-full w-full items-center gap-1.5 text-left transition-colors hover:text-[var(--ea-primary)]"
                >
                  <span className="min-w-0 truncate">
                    {p.valueFormatted ?? ""}
                  </span>
                  <Icon name="chevronDown" size="xs" className="shrink-0 text-[var(--ea-text-4)]" />
                </button>
              );
            }
          : undefined,
      },
      {
        headerName: "Дансны нэр",
        colId: "account-name",
        width: 210,
        editable: false,
        sortable: false,
        cellClass: "text-xs text-[var(--ea-text-2)]",
        valueGetter: (p) => {
          if (!p.data || p.node?.rowPinned) return "";
          const parts = String(p.data.account ?? "").split(".");
          const main = parts.length === 10 ? parts[2] : String(p.data.account ?? "");
          return accountNameByMain.get(main) ?? "";
        },
      },
      {
        headerName: "Дебет",
        field: "debit",
        width: 150,
        editable: (p) => !readOnly && !p.node?.rowPinned,
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
        editable: (p) => !readOnly && !p.node?.rowPinned,
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
        editable: (p) => !readOnly && !p.node?.rowPinned,
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
          if (p.node?.rowPinned) return null;
          const id = p.data?.id;
          return (
            <IconAction
              name="delete"
              label="Мөр устгах"
              size="sm"
              variant="danger"
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
            />
          );
        },
      },
    ];
    // Дансны нэр хоёр горимд ч харагдана (нэг UX); харах горимд мөр
    // устгах багана хэрэггүй.
    return readOnly ? cols.filter((col) => col.colId !== "actions") : cols;
  }, [accountColWidth, activeSegIds, segOptions, defaultSegments, minLines, onError, onLinesChange, readOnly, accountNameByMain]);

  const processDataFromClipboard = useCallback(
    (p: ProcessDataFromClipboardParams<JournalLineRow>) => {
      const rows = p.data;
      if (!rows || rows.length === 0) return rows;
      // Clipboard-ийн 0-р багана нь grid-ийн 0-р багана БИШ — фокустай
      // нүдний баганаас эхэлдэг. Тиймээс тухайн offset-оос зурвасална.
      const displayed = p.api.getAllDisplayedColumns();
      const focused = p.api.getFocusedCell();
      const startIndex = focused
        ? Math.max(
            0,
            displayed.findIndex(
              (column) => column.getColId() === focused.column.getColId()
            )
          )
        : 0;
      return rows.map((row) =>
        row.map((cell, i) =>
          displayed[startIndex + i]?.getColDef()?.field === "account"
            ? normalizePastedAccount(cell, activeSegIds, defaultSegments)
            : cell
        )
      );
    },
    [activeSegIds, defaultSegments]
  );

  const pinnedBottom = useMemo(
    () => [
      {
        id: "__totals__",
        account: "",
        debit: totalDebit,
        credit: totalCredit,
        description: "",
      } as JournalLineRow,
    ],
    [totalDebit, totalCredit]
  );

  return (
    <>
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
    <AccountSegmentPanel
      anchor={segPanel?.anchor ?? null}
      value={segPanel?.code ?? ""}
      onCancel={closeSegPanel}
      activeSegIds={activeSegIds}
      segmentOptions={segOptions}
      readOnly
    />
    </>
  );
}

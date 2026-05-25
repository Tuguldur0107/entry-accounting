"use client";

import { useCallback, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import type {
  CellValueChangedEvent,
  ColDef,
  ICellRendererParams,
  ProcessDataFromClipboardParams,
} from "ag-grid-community";
import { createVoucher, updateVoucher } from "@/lib/actions/gl";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import type { ChartOfAccount, SegmentValue } from "@/lib/db/schema";
import { EaGridDynamic } from "@/lib/grid/EaGridDynamic";
import { fmtMnt } from "@/lib/reports/balances";
import {
  buildSegCode,
  fmtAccountDisplay,
  normalizePastedAccount,
} from "@/lib/grid/segments";
import { parseMntInput } from "@/lib/grid/formatters";
import { AccountSegmentEditor } from "@/lib/grid/editors/AccountSegmentEditor";
import { DebitCreditEditor } from "@/lib/grid/editors/DebitCreditEditor";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

function closeWindow() {
  if (typeof window === "undefined") return;
  if (window.opener) {
    window.opener.location.reload();
    window.close();
  } else {
    window.location.href = "/gl/journal";
  }
}

interface LineRow {
  id: string;
  account: string;
  debit: number;
  credit: number;
  description: string;
}

interface InitialLine {
  account: string;
  debit: string | number;
  credit: string | number;
  description: string;
}

interface InitialVoucher {
  date: string;
  description: string;
  lines: InitialLine[];
}

interface Props {
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  segmentValues: SegmentValue[];
  defaultSegments?: Record<number, string>;
  voucherId?: string;
  initialVoucher?: InitialVoucher;
}

const fmt = (n: number) => fmtMnt(n);

export function JournalEntryForm({
  accounts,
  activeSegIds,
  segmentValues,
  defaultSegments = {},
  voucherId,
  initialVoucher,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!voucherId;

  const makeEmptyLine = useCallback((): LineRow => {
    const parts: Record<number, string> = {};
    for (const id of activeSegIds) parts[id] = defaultSegments[id] ?? "";
    return {
      id: nanoid(),
      account: buildSegCode(parts, activeSegIds, defaultSegments),
      debit: 0,
      credit: 0,
      description: "",
    };
  }, [activeSegIds, defaultSegments]);

  const [date, setDate] = useState(initialVoucher?.date ?? today);
  const [description, setDescription] = useState(initialVoucher?.description ?? "");
  const [lines, setLines] = useState<LineRow[]>(() => {
    if (initialVoucher?.lines && initialVoucher.lines.length >= 2) {
      return initialVoucher.lines.map((l) => ({
        id: nanoid(),
        account: l.account,
        debit: typeof l.debit === "number" ? l.debit : parseFloat(String(l.debit)) || 0,
        credit: typeof l.credit === "number" ? l.credit : parseFloat(String(l.credit)) || 0,
        description: l.description,
      }));
    }
    return [makeEmptyLine(), makeEmptyLine()];
  });

  const [saving, setSaving] = useState<"draft" | "posted" | null>(null);
  const [error, setError] = useState("");

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const diff = totalDebit - totalCredit;
  const isEmpty = totalDebit === 0 && totalCredit === 0;
  const balanced = !isEmpty && Math.abs(diff) <= 0.01;

  const segOptions = useMemo<Record<number, SegOption[]>>(() => {
    const map: Record<number, SegOption[]> = {};
    for (const segId of activeSegIds) {
      map[segId] =
        segId === 3
          ? accounts.map((a) => ({ code: a.number, name: a.name }))
          : segmentValues
              .filter((sv) => sv.segmentId === segId)
              .map((sv) => ({ code: sv.code, name: sv.name }));
    }
    return map;
  }, [activeSegIds, accounts, segmentValues]);

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

  // Single source of truth: AG Grid's onCellValueChanged → setLines.
  const handleCellChange = useCallback(
    (e: CellValueChangedEvent<LineRow>) => {
      const id = e.data.id;
      const field = e.colDef.field as keyof LineRow | undefined;
      if (!field) return;
      setLines((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          const next: LineRow = { ...l, [field]: e.newValue } as LineRow;
          // Enforce Dr ⊕ Cr mutex at state layer.
          if (field === "debit" && (next.debit ?? 0) > 0) next.credit = 0;
          else if (field === "credit" && (next.credit ?? 0) > 0) next.debit = 0;
          return next;
        })
      );
    },
    []
  );

  const columnDefs = useMemo<ColDef<LineRow>[]>(() => {
    const cols: ColDef<LineRow>[] = [
      {
        headerName: "#",
        colId: "row-num",
        width: 48,
        cellClass: "ag-center-cell text-xs",
        editable: false,
        sortable: false,
        valueGetter: (p) => (p.node?.rowIndex != null ? p.node.rowIndex + 1 : ""),
      },
      {
        headerName: "Данс",
        field: "account",
        width: accountColWidth,
        editable: true,
        cellClass: "font-mono text-xs",
        cellEditor: AccountSegmentEditor,
        cellEditorPopup: true,
        cellEditorParams: {
          activeSegIds,
          segOptions,
          extraDefaults: defaultSegments,
        },
        valueFormatter: (p) => fmtAccountDisplay(String(p.value ?? ""), activeSegIds),
      },
      {
        headerName: "Дебет",
        field: "debit",
        width: 150,
        editable: true,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        cellEditor: DebitCreditEditor,
        valueParser: (p) => {
          const n = parseMntInput(p.newValue);
          return Number.isFinite(n) && n > 0 ? n : 0;
        },
        valueFormatter: (p) =>
          p.value && p.value !== 0 ? fmtMnt(Number(p.value)) : "",
      },
      {
        headerName: "Кредит",
        field: "credit",
        width: 150,
        editable: true,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        cellEditor: DebitCreditEditor,
        valueParser: (p) => {
          const n = parseMntInput(p.newValue);
          return Number.isFinite(n) && n > 0 ? n : 0;
        },
        valueFormatter: (p) =>
          p.value && p.value !== 0 ? fmtMnt(Number(p.value)) : "",
      },
      {
        headerName: "Тайлбар",
        field: "description",
        flex: 1,
        minWidth: 200,
        editable: true,
        cellClass: "text-xs",
      },
      {
        headerName: "",
        colId: "actions",
        width: 44,
        editable: false,
        sortable: false,
        cellClass: "flex items-center justify-center",
        cellRenderer: (p: ICellRendererParams<LineRow>) => {
          const id = p.data?.id;
          return (
            <button
              type="button"
              onClick={() => {
                setLines((prev) => {
                  if (prev.length <= 2) {
                    setError("Дор хаяж 2 мөр шаардлагатай. Мөр нэмээд буцаад устгана уу.");
                    return prev;
                  }
                  setError("");
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

    return cols;
  }, [accountColWidth, activeSegIds, segOptions, defaultSegments]);

  const processDataFromClipboard = useCallback(
    (p: ProcessDataFromClipboardParams<LineRow>) => {
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
      } as LineRow,
    ],
    [totalDebit, totalCredit]
  );

  async function handleSave(status: "draft" | "posted") {
    if (!date || !description.trim()) {
      setError("Огноо ба гүйлгээний утгыг бөглөнө үү");
      return;
    }
    if (status === "posted" && !balanced) return;
    setSaving(status);
    setError("");
    try {
      const payload = {
        date,
        description: description.trim(),
        status,
        lines: lines.map((l) => ({
          account: l.account,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
        })),
      };
      if (isEdit && voucherId) {
        await updateVoucher(voucherId, payload);
      } else {
        await createVoucher(payload);
      }
      closeWindow();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Алдаа гарлаа");
      setSaving(null);
    }
  }

  return (
    <div
      className="h-screen flex flex-col"
      style={{ background: "var(--ea-bg)", fontFamily: "var(--ea-font-sans)" }}
    >
      <header
        className="px-6 flex items-center shrink-0 h-12 gap-3"
        style={{
          background: "var(--ea-surface)",
          borderBottom: "1px solid var(--ea-border)",
        }}
      >
        <button
          onClick={closeWindow}
          className="flex items-center gap-2 text-sm transition-colors"
          style={{ color: "var(--ea-text-3)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ea-text-1)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ea-text-3)")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 3L5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Буцах
        </button>
        <div style={{ width: 1, height: 20, background: "var(--ea-border)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--ea-text-1)" }}>
          {isEdit ? "Журнал засах" : "Журнал бичих"}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto py-6 px-6">
        <div className="max-w-screen-xl mx-auto space-y-4">
          <div
            className="p-5"
            style={{
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border)",
              borderRadius: 10,
            }}
          >
            <div className="grid gap-5" style={{ gridTemplateColumns: "180px 1fr" }}>
              <div className="space-y-1.5">
                <label
                  className="text-xs font-semibold block"
                  style={{ color: "var(--ea-text-3)" }}
                >
                  Огноо
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md outline-none transition-colors"
                  style={{
                    border: "1px solid var(--ea-border-strong)",
                    background: "var(--ea-surface)",
                    color: "var(--ea-text-1)",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ea-primary)")}
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "var(--ea-border-strong)")
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-xs font-semibold block"
                  style={{ color: "var(--ea-text-3)" }}
                >
                  Гүйлгээний утга
                </label>
                <input
                  type="text"
                  placeholder="Гүйлгээний тайлбар оруулна уу"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md outline-none transition-colors"
                  style={{
                    border: "1px solid var(--ea-border-strong)",
                    background: "var(--ea-surface)",
                    color: "var(--ea-text-1)",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ea-primary)")}
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "var(--ea-border-strong)")
                  }
                />
              </div>
            </div>
          </div>

          <div
            style={{
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <EaGridDynamic<LineRow>
              rowData={lines}
              columnDefs={columnDefs}
              getRowId={(p) => p.data.id}
              pinnedBottomRowData={pinnedBottom}
              onCellValueChanged={handleCellChange}
              processDataFromClipboard={processDataFromClipboard}
              height={Math.min(560, 90 + lines.length * 36 + 48)}
              singleClickEdit
              stopEditingWhenCellsLoseFocus
              undoRedoCellEditing
              undoRedoCellEditingLimit={100}
              suppressClickEdit={false}
              wrapperClassName="ea-journal-lines"
              // Editing surface — no filter row, keep cell-level text
              // selection so the user can highlight inside the Тайлбар
              // text column while typing.
              defaultColDef={{ filter: false, floatingFilter: false }}
              enableCellTextSelection
            />
          </div>
        </div>
      </div>

      <footer
        className="px-6 py-3 flex items-center justify-between shrink-0"
        style={{
          background: "var(--ea-surface)",
          borderTop: "1px solid var(--ea-border)",
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-sm px-3 py-1.5 rounded-md font-medium"
            style={
              isEmpty
                ? { color: "var(--ea-text-3)", background: "var(--ea-bg-2)" }
                : balanced
                ? {
                    color: "var(--ea-success)",
                    background:
                      "color-mix(in srgb, var(--ea-success) 10%, var(--ea-surface))",
                    border: "1px solid color-mix(in srgb, var(--ea-success) 30%, transparent)",
                  }
                : {
                    color: "var(--ea-danger)",
                    background:
                      "color-mix(in srgb, var(--ea-danger) 10%, var(--ea-surface))",
                    border: "1px solid color-mix(in srgb, var(--ea-danger) 30%, transparent)",
                  }
            }
          >
            {isEmpty ? "Дүн оруулаагүй" : balanced ? "✓ Тэнцсэн" : `Зөрүү: ${fmt(diff)}`}
          </span>
          {error && (
            <span className="text-sm" style={{ color: "var(--ea-danger)" }}>
              {error}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLines((p) => [...p, makeEmptyLine()])}
            className="px-4 py-2 text-sm font-medium rounded-md transition-colors"
            style={{
              border: "1px solid var(--ea-border-strong)",
              background: "var(--ea-surface)",
              color: "var(--ea-text-2)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ea-bg-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--ea-surface)")}
          >
            + Мөр нэмэх
          </button>
          <div style={{ width: 1, height: 20, background: "var(--ea-border)" }} />
          <button
            onClick={closeWindow}
            className="px-4 py-2 text-sm font-medium rounded-md transition-colors"
            style={{
              border: "1px solid var(--ea-border-strong)",
              background: "var(--ea-surface)",
              color: "var(--ea-text-2)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ea-bg-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--ea-surface)")}
          >
            Болих
          </button>
          <button
            onClick={() => handleSave("draft")}
            disabled={saving !== null}
            className="px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              border: "1px solid var(--ea-border-strong)",
              background: "var(--ea-surface)",
              color: "var(--ea-text-2)",
            }}
            onMouseEnter={(e) => {
              if (saving === null) e.currentTarget.style.background = "var(--ea-bg-2)";
            }}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--ea-surface)")}
          >
            {saving === "draft" ? "Хадгалж байна..." : "Ноорог"}
          </button>
          <button
            onClick={() => handleSave("posted")}
            disabled={!balanced || saving !== null}
            className="px-5 py-2 text-sm font-semibold text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "var(--ea-primary)" }}
            onMouseEnter={(e) => {
              if (balanced && saving === null)
                e.currentTarget.style.background = "var(--ea-primary-700)";
            }}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--ea-primary)")}
          >
            {saving === "posted" ? "Хадгалж байна..." : "Хадгалах"}
          </button>
        </div>
      </footer>
    </div>
  );
}

"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type {
  CellValueChangedEvent,
  ColDef,
  GridApi,
  ICellRendererParams,
} from "ag-grid-community";
import {
  Check,
  ClipboardPaste,
  Copy,
  Download,
  FileSpreadsheet,
  Filter,
  Search,
  Upload,
} from "lucide-react";

import { AccountSegmentPicker } from "@/components/account/account-segment-picker";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import type { DataGridHandle } from "@/components/datagrid/DataGrid";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ParsedBankStatement,
  ParsedBankStatementRow,
} from "@/lib/cash/bank-statement-types";
import type { CashAccountView } from "@/lib/cash/types";
import { fmtMnt } from "@/lib/reports/balances";
import {
  buildSegCode,
  fmtAccountDisplay,
} from "@/lib/grid/segments";
import { AccountSegmentEditor } from "@/lib/grid/editors/AccountSegmentEditor";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { cn } from "@/lib/utils";

export type BankStatementSummary = {
  id: string;
  fileName: string;
  bankName: string;
  cashAccountName: string;
  periodStart: string;
  periodEnd: string;
  rowCount: number;
  totalIncome: number;
  totalExpense: number;
  createdAt: string;
};

interface Props {
  accounts: CashAccountView[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  statements: BankStatementSummary[];
}

type AssignmentSide = "debit" | "credit";
type AssignmentScope = "selected" | "filtered";

function emptyAccountCode(
  activeSegIds: number[],
  defaultSegments: Record<number, string>
) {
  return buildSegCode(
    { ...defaultSegments, 3: "" },
    activeSegIds,
    defaultSegments
  );
}

function isCompleteAccountCode(
  code: string,
  activeSegIds: number[],
  segmentOptions: Record<number, SegOption[]>
) {
  const parts = code.split(".");
  return (
    parts.length === 10 &&
    activeSegIds.every((segmentId) => {
      const value = parts[segmentId - 1] ?? "";
      return (
        value.length > 0 &&
        segmentOptions[segmentId]?.some((option) => option.code === value)
      );
    })
  );
}

export function BankStatementImport({
  accounts,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  statements,
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<DataGridHandle>(null);
  const [cashAccountId, setCashAccountId] = useState("");
  const [parsed, setParsed] = useState<ParsedBankStatement | null>(null);
  const [rows, setRows] = useState<ParsedBankStatementRow[]>([]);
  const [quickFilter, setQuickFilter] = useState("");
  const [selectedCount, setSelectedCount] = useState(0);
  const [error, setError] = useState("");
  const [assignmentSide, setAssignmentSide] =
    useState<AssignmentSide>("debit");
  const [assignmentScope, setAssignmentScope] =
    useState<AssignmentScope>("selected");
  const [assignmentCode, setAssignmentCode] = useState("");
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const cashAccount = accounts.find((account) => account.id === cashAccountId);
  const totals = useMemo(
    () => ({
      income: rows.reduce((sum, row) => sum + row.income, 0),
      expense: rows.reduce((sum, row) => sum + row.expense, 0),
      invalid: rows.filter(
        (row) =>
          !isCompleteAccountCode(
            row.debitAccountNumber,
            activeSegIds,
            segmentOptions
          ) ||
          !isCompleteAccountCode(
            row.creditAccountNumber,
            activeSegIds,
            segmentOptions
          ) ||
          (cashAccount?.currency !== "MNT" &&
            (!(row.exchangeRate && row.exchangeRate > 0) ||
              !(row.baseAmount && row.baseAmount > 0)))
      ).length,
    }),
    [activeSegIds, cashAccount?.currency, rows, segmentOptions]
  );

  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent<ParsedBankStatementRow>) => {
      const field = event.colDef.field;
      if (
        field !== "debitAccountNumber" &&
        field !== "creditAccountNumber" &&
        field !== "exchangeRate" &&
        field !== "baseAmount"
      )
        return;
      setRows((current) =>
        current.map((row) =>
          row.id === event.data.id
            ? field === "exchangeRate"
              ? {
                  ...row,
                  exchangeRate: Number(event.newValue) || null,
                  baseAmount:
                    Number(event.newValue) > 0
                      ? Math.round(
                          (row.income || row.expense) *
                            Number(event.newValue) *
                            100
                        ) / 100
                      : null,
                }
              : field === "baseAmount"
                ? { ...row, baseAmount: Number(event.newValue) || null }
                : { ...row, [field]: String(event.newValue ?? "") }
            : row
        )
      );
    },
    []
  );

  const columnDefs = useMemo<ColDef<ParsedBankStatementRow>[]>(
    () => [
      {
        headerName: "#",
        field: "rowNumber",
        width: 74,
        cellClass: "font-mono text-xs text-[var(--ea-text-3)]",
      },
      {
        headerName: "Огноо",
        field: "transactionDate",
        width: 112,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Утгын огноо",
        field: "valueDate",
        width: 116,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Гүйлгээний утга",
        field: "description",
        minWidth: 240,
        flex: 1,
      },
      {
        headerName: "Харилцагч",
        field: "counterparty",
        minWidth: 150,
      },
      {
        headerName: "Харьцсан данс",
        field: "counterAccount",
        minWidth: 150,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Орлого",
        field: "income",
        width: 140,
        cellClass:
          "ag-right-aligned-cell font-mono text-[var(--ea-success)]",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          Number(params.value) > 0 ? fmtMnt(Number(params.value)) : "",
      },
      {
        headerName: "Зарлага",
        field: "expense",
        width: 140,
        cellClass:
          "ag-right-aligned-cell font-mono text-[var(--ea-danger)]",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          Number(params.value) > 0 ? fmtMnt(Number(params.value)) : "",
      },
      {
        headerName: "Үлдэгдэл",
        field: "balance",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.value == null ? "" : fmtMnt(Number(params.value)),
      },
      {
        headerName: "Гүйлгээний ханш",
        field: "exchangeRate",
        width: 150,
        editable: cashAccount?.currency !== "MNT",
        singleClickEdit: true,
        hide: cashAccount?.currency === "MNT",
        cellClass:
          "ag-right-aligned-cell font-mono bg-[var(--ea-primary-soft)]",
        headerClass: "ag-right-aligned-header",
        valueParser: (params) => {
          const value = Number(params.newValue);
          return Number.isFinite(value) && value > 0 ? value : null;
        },
        valueFormatter: (params) =>
          params.value == null
            ? ""
            : Number(params.value).toLocaleString("mn-MN", {
                maximumFractionDigits: 8,
              }),
      },
      {
        headerName: "MNT дүн",
        field: "baseAmount",
        width: 150,
        editable: cashAccount?.currency !== "MNT",
        singleClickEdit: true,
        hide: cashAccount?.currency === "MNT",
        cellClass:
          "ag-right-aligned-cell font-mono bg-[var(--ea-primary-soft)]",
        headerClass: "ag-right-aligned-header",
        valueParser: (params) => {
          const value = Number(params.newValue);
          return Number.isFinite(value) && value > 0 ? value : null;
        },
        valueFormatter: (params) =>
          params.value == null ? "" : fmtMnt(Number(params.value)),
      },
      {
        headerName: "DR данс",
        field: "debitAccountNumber",
        width: 260,
        editable: true,
        singleClickEdit: true,
        cellClass: (params) =>
          isCompleteAccountCode(
            String(params.value ?? ""),
            activeSegIds,
            segmentOptions
          )
            ? "font-mono text-xs"
            : "font-mono text-xs bg-[var(--ea-danger-bg)] text-[var(--ea-danger)]",
        valueFormatter: (params) =>
          fmtAccountDisplay(String(params.value ?? ""), activeSegIds),
        cellEditor: AccountSegmentEditor,
        cellEditorParams: {
          activeSegIds,
          segOptions: segmentOptions,
          extraDefaults: defaultSegments,
        },
      },
      {
        headerName: "CR данс",
        field: "creditAccountNumber",
        width: 260,
        editable: true,
        singleClickEdit: true,
        cellClass: (params) =>
          isCompleteAccountCode(
            String(params.value ?? ""),
            activeSegIds,
            segmentOptions
          )
            ? "font-mono text-xs"
            : "font-mono text-xs bg-[var(--ea-danger-bg)] text-[var(--ea-danger)]",
        valueFormatter: (params) =>
          fmtAccountDisplay(String(params.value ?? ""), activeSegIds),
        cellEditor: AccountSegmentEditor,
        cellEditorParams: {
          activeSegIds,
          segOptions: segmentOptions,
          extraDefaults: defaultSegments,
        },
      },
      {
        headerName: "Шалгалт",
        colId: "validation",
        width: 104,
        valueGetter: (params) =>
          isCompleteAccountCode(
            params.data?.debitAccountNumber ?? "",
            activeSegIds,
            segmentOptions
          ) &&
          isCompleteAccountCode(
            params.data?.creditAccountNumber ?? "",
            activeSegIds,
            segmentOptions
          )
            ? "Бэлэн"
            : "Данс дутуу",
        cellRenderer: (
          params: ICellRendererParams<ParsedBankStatementRow>
        ) => {
          const valid =
            isCompleteAccountCode(
              params.data?.debitAccountNumber ?? "",
              activeSegIds,
              segmentOptions
            ) &&
            isCompleteAccountCode(
              params.data?.creditAccountNumber ?? "",
              activeSegIds,
              segmentOptions
            );
          return (
            <span
              className={cn(
                "text-xs font-medium",
                valid
                  ? "text-[var(--ea-success)]"
                  : "text-[var(--ea-danger)]"
              )}
            >
              {valid ? "Бэлэн" : "Данс дутуу"}
            </span>
          );
        },
      },
    ],
    [activeSegIds, cashAccount?.currency, defaultSegments, segmentOptions]
  );

  function applyQuickFilter(value: string) {
    setQuickFilter(value);
    gridRef.current?.api?.setGridOption("quickFilterText", value);
  }

  async function parseFile(file: File) {
    if (!cashAccount) {
      setError("Эхлээд банкны мөнгөн хөрөнгийн данс сонгоно уу");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/cash/statements/parse", {
          method: "POST",
          body: formData,
        });
        const result = (await response.json()) as
          | ParsedBankStatement
          | { error: string };
        if (!response.ok || "error" in result)
          throw new Error("error" in result ? result.error : "Parse алдаа");

        const cashCode = buildSegCode(
          { ...defaultSegments, 3: cashAccount.glAccountNumber },
          activeSegIds,
          defaultSegments
        );
        const blankCode = emptyAccountCode(activeSegIds, defaultSegments);
        const normalizedRows = result.rows.map((row) => ({
          ...row,
          exchangeRate:
            cashAccount.currency === "MNT" ? 1 : row.exchangeRate,
          baseAmount:
            cashAccount.currency === "MNT"
              ? row.income || row.expense
              : row.baseAmount ??
                (row.exchangeRate
                  ? Math.round(
                      (row.income || row.expense) * row.exchangeRate * 100
                    ) / 100
                  : null),
          debitAccountNumber: row.income > 0 ? cashCode : blankCode,
          creditAccountNumber: row.expense > 0 ? cashCode : blankCode,
        }));
        setParsed(result);
        setRows(normalizedRows);
        setSelectedCount(0);
        applyQuickFilter("");
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Хуулга уншиж чадсангүй"
        );
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  }

  function targetRowIds(api: GridApi<ParsedBankStatementRow>) {
    if (assignmentScope === "selected") {
      return new Set(api.getSelectedRows().map((row) => row.id));
    }
    const ids = new Set<string>();
    api.forEachNodeAfterFilter((node) => {
      if (node.data) ids.add(node.data.id);
    });
    return ids;
  }

  function applyAccountCode(code: string, side: AssignmentSide) {
    const api = gridRef.current?.api as
      | GridApi<ParsedBankStatementRow>
      | undefined;
    if (!api) return;
    const ids = targetRowIds(api);
    if (ids.size === 0) {
      setError("Оноох мөр сонгоно уу");
      return;
    }
    const field =
      side === "debit" ? "debitAccountNumber" : "creditAccountNumber";
    setRows((current) =>
      current.map((row) =>
        ids.has(row.id) ? { ...row, [field]: code } : row
      )
    );
    setAssignmentOpen(false);
  }

  function openAssignment(side: AssignmentSide) {
    setAssignmentSide(side);
    setAssignmentScope(selectedCount > 0 ? "selected" : "filtered");
    setAssignmentCode(emptyAccountCode(activeSegIds, defaultSegments));
    setAssignmentOpen(true);
  }

  async function copyAssignments() {
    const selected =
      (
        gridRef.current?.api as
          | GridApi<ParsedBankStatementRow>
          | undefined
      )?.getSelectedRows() ?? [];
    if (selected.length !== 1) {
      setError("Данс хуулахын тулд яг нэг мөр сонгоно уу");
      return;
    }
    await navigator.clipboard.writeText(
      JSON.stringify({
        type: "entry-accounting/cash-account-pair",
        debitAccountNumber: selected[0].debitAccountNumber,
        creditAccountNumber: selected[0].creditAccountNumber,
      })
    );
    setError("");
  }

  async function pasteAssignments() {
    try {
      const copied = JSON.parse(await navigator.clipboard.readText()) as {
        type?: string;
        debitAccountNumber?: string;
        creditAccountNumber?: string;
      };
      if (
        copied.type !== "entry-accounting/cash-account-pair" ||
        !copied.debitAccountNumber ||
        !copied.creditAccountNumber
      )
        throw new Error("Clipboard-д мөнгөн хөрөнгийн DR/CR данс алга");

      const api = gridRef.current?.api as
        | GridApi<ParsedBankStatementRow>
        | undefined;
      if (!api) return;
      const scope: AssignmentScope =
        api.getSelectedRows().length > 0 ? "selected" : "filtered";
      const ids =
        scope === "selected"
          ? new Set(api.getSelectedRows().map((row) => row.id))
          : (() => {
              const filtered = new Set<string>();
              api.forEachNodeAfterFilter((node) => {
                if (node.data) filtered.add(node.data.id);
              });
              return filtered;
            })();
      setRows((current) =>
        current.map((row) =>
          ids.has(row.id)
            ? {
                ...row,
                debitAccountNumber: copied.debitAccountNumber!,
                creditAccountNumber: copied.creditAccountNumber!,
              }
            : row
        )
      );
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Данс буулгаж чадсангүй"
      );
    }
  }

  function saveStatement() {
    if (!parsed || !cashAccount) return;
    if (totals.invalid > 0) {
      setError(`${totals.invalid} мөрийн DR/CR данс дутуу байна`);
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/cash/statements/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...parsed,
            cashAccountId: cashAccount.id,
            rows,
          }),
        });
        const result = (await response.json()) as {
          id?: string;
          rowCount?: number;
          error?: string;
        };
        if (!response.ok || result.error)
          throw new Error(result.error || "Хуулга хадгалж чадсангүй");
        setParsed(null);
        setRows([]);
        setSelectedCount(0);
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Хуулга хадгалж чадсангүй"
        );
      }
    });
  }

  const statementColumns = useMemo<ColDef<BankStatementSummary>[]>(
    () => [
      { headerName: "Импортолсон", field: "createdAt", width: 150 },
      { headerName: "Файл", field: "fileName", minWidth: 180, flex: 1 },
      { headerName: "Банк", field: "bankName", minWidth: 140 },
      {
        headerName: "Мөнгөн хөрөнгийн данс",
        field: "cashAccountName",
        minWidth: 160,
      },
      {
        headerName: "Хугацаа",
        colId: "period",
        minWidth: 190,
        valueGetter: (params) =>
          `${params.data?.periodStart ?? ""} – ${
            params.data?.periodEnd ?? ""
          }`,
      },
      { headerName: "Мөр", field: "rowCount", width: 86 },
      {
        headerName: "Орлого",
        field: "totalIncome",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Зарлага",
        field: "totalExpense",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
    ],
    []
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
              Дансны хуулга импорт
            </h1>
            <p className="mt-1 text-xs text-[var(--ea-text-3)]">
              CSV/XLSX хуулгыг шалгаж, DR/CR данс оноосны дараа GL-д бичнэ.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <a
              href="/examples/golomt-bank-statement-sample.xlsx"
              download
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--ea-border)] px-2.5 text-sm font-medium text-[var(--ea-text-2)] hover:bg-[var(--ea-bg-2)]"
            >
              <Download size={15} />
              Жишээ XLSX
            </a>
            <a
              href="/examples/golomt-bank-statement-sample.csv"
              download
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--ea-border)] px-2.5 text-sm font-medium text-[var(--ea-text-2)] hover:bg-[var(--ea-bg-2)]"
            >
              <Download size={15} />
              Жишээ CSV
            </a>
            <select
              value={cashAccountId}
              onChange={(event) => {
                setCashAccountId(event.target.value);
                setParsed(null);
                setRows([]);
              }}
              className="ea-form-select sm:w-64"
              aria-label="Банкны мөнгөн хөрөнгийн данс"
            >
              <option value="">Банкны данс сонгох...</option>
              {accounts
                .filter(
                  (account) =>
                    account.isActive && account.accountType === "bank"
                )
                .map((account) => (
                  <option
                    key={account.id}
                    value={account.id}
                  >
                    {account.name} · {account.currency}
                  </option>
                ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.xlsx"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void parseFile(file);
              }}
            />
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={!cashAccountId || isPending}
            >
              <Upload />
              Хуулга сонгох
            </Button>
          </div>
        </div>

        {error && (
          <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
            {error}
          </p>
        )}
      </section>

      {rows.length > 0 && parsed && (
        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1 sm:max-w-sm">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ea-text-4)]"
              />
              <Input
                value={quickFilter}
                onChange={(event) => applyQuickFilter(event.target.value)}
                placeholder="Бүх баганаас нэг дор хайх..."
                className="pl-8"
              />
            </div>
            <Button variant="outline" onClick={() => openAssignment("debit")}>
              <Filter />
              DR данс оноох
            </Button>
            <Button variant="outline" onClick={() => openAssignment("credit")}>
              <Filter />
              CR данс оноох
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Нэг мөрийн DR/CR дансыг хуулах"
              aria-label="DR/CR данс хуулах"
              onClick={() => void copyAssignments()}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Сонгосон эсвэл шүүгдсэн мөрүүдэд данс буулгах"
              aria-label="DR/CR данс буулгах"
              onClick={() => void pasteAssignments()}
            >
              <ClipboardPaste />
            </Button>
            <span className="text-xs text-[var(--ea-text-3)]">
              {selectedCount > 0
                ? `${selectedCount} мөр сонгосон`
                : `${rows.length} мөр`}
            </span>
          </div>

          <DataGridDynamic<ParsedBankStatementRow>
            ref={gridRef}
            rowData={rows}
            columnDefs={columnDefs}
            getRowId={(params) => params.data.id}
            height={620}
            showSelectionCheckboxes
            pagination
            paginationPageSize={100}
            paginationPageSizeSelector={[50, 100, 250, 500]}
            onSelectionChanged={(event) =>
              setSelectedCount(event.api.getSelectedRows().length)
            }
            onCellValueChanged={handleCellValueChanged}
            singleClickEdit
            stopEditingWhenCellsLoseFocus
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          />

          <div className="flex flex-col gap-3 border-t border-[var(--ea-border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <span className="text-[var(--ea-text-3)]">
                Файл: <strong className="text-[var(--ea-text-1)]">{parsed.fileName}</strong>
              </span>
              <span className="text-[var(--ea-success)]">
                Орлого: {fmtMnt(totals.income)}
              </span>
              <span className="text-[var(--ea-danger)]">
                Зарлага: {fmtMnt(totals.expense)}
              </span>
              <span
                className={
                  totals.invalid > 0
                    ? "text-[var(--ea-danger)]"
                    : "text-[var(--ea-success)]"
                }
              >
                {totals.invalid > 0
                  ? `${totals.invalid} мөрийн данс дутуу`
                  : "Бүх мөр бэлэн"}
              </span>
            </div>
            <Button
              onClick={saveStatement}
              disabled={isPending || totals.invalid > 0}
            >
              <Check />
              Хуулга хадгалж GL-д бичих
            </Button>
          </div>
        </section>
      )}

      {statements.length > 0 && (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-center gap-2">
            <FileSpreadsheet
              size={16}
              className="text-[var(--ea-primary)]"
            />
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
              Импортын түүх
            </h2>
          </div>
          <DataGridDynamic<BankStatementSummary>
            rowData={statements}
            columnDefs={statementColumns}
            getRowId={(params) => params.data.id}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        </section>
      )}

      {rows.length === 0 && statements.length === 0 && (
        <div className="flex min-h-56 items-center justify-center rounded-md border border-dashed border-[var(--ea-border-strong)] text-sm text-[var(--ea-text-4)]">
          Банкны данс сонгоод CSV эсвэл XLSX хуулга оруулна уу
        </div>
      )}

      <Dialog open={assignmentOpen} onOpenChange={setAssignmentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {assignmentSide === "debit" ? "DR" : "CR"} данс олноор оноох
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div>
              <Label className="mb-2">Хамрах мөр</Label>
              <div className="grid grid-cols-2 overflow-hidden rounded-md border border-[var(--ea-border)]">
                <button
                  type="button"
                  disabled={selectedCount === 0}
                  onClick={() => setAssignmentScope("selected")}
                  className={cn(
                    "h-9 text-xs font-medium disabled:opacity-40",
                    assignmentScope === "selected"
                      ? "bg-[var(--ea-primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--ea-bg-2)] text-[var(--ea-text-2)]"
                  )}
                >
                  Сонгосон ({selectedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setAssignmentScope("filtered")}
                  className={cn(
                    "h-9 text-xs font-medium",
                    assignmentScope === "filtered"
                      ? "bg-[var(--ea-primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--ea-bg-2)] text-[var(--ea-text-2)]"
                  )}
                >
                  Шүүгдсэн бүх мөр
                </button>
              </div>
            </div>

            <AccountSegmentPicker
              value={assignmentCode}
              onChange={setAssignmentCode}
              activeSegIds={activeSegIds}
              segmentOptions={segmentOptions}
              defaultSegments={defaultSegments}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAssignmentOpen(false)}
            >
              Болих
            </Button>
            <Button
              onClick={() =>
                applyAccountCode(assignmentCode, assignmentSide)
              }
              disabled={
                !isCompleteAccountCode(
                  assignmentCode,
                  activeSegIds,
                  segmentOptions
                )
              }
            >
              Данс оноох
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

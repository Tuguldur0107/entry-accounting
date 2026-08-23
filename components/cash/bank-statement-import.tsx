"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import type {
  CellValueChangedEvent,
  ColDef,
  GridApi,
  ICellRendererParams,
} from "ag-grid-community";

import { AccountSegmentPicker } from "@/components/account/account-segment-picker";
import {
  BankRulesDialog,
  type BankRuleDraft,
} from "@/components/cash/bank-rules-dialog";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterChips } from "@/components/ui/tabs";
import type {
  ParsedBankStatement,
  ParsedBankStatementRow,
} from "@/lib/cash/bank-statement-types";
import {
  firstMatchingRule,
  toRuleSuggestion,
  type BankRule,
  type RuleSuggestion,
} from "@/lib/cash/bank-rules";
import {
  suggestMatches,
  type MatchContext,
  type RowSuggestion,
} from "@/lib/cash/statement-matching";
import type { CashAccountView } from "@/lib/cash/types";
import { fmtMnt } from "@/lib/reports/balances";
import {
  buildSegCode,
  fmtAccountDisplay,
} from "@/lib/grid/segments";
import { AccountSegmentEditor } from "@/lib/grid/editors/AccountSegmentEditor";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { openCashDocPanel } from "@/lib/store/panel-store";
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

/** «Санал» баганы нэгдсэн төрөл — дүрэм → нэхэмжлэх → түүхэн загвар. */
type AnySuggestion = RuleSuggestion | RowSuggestion;

/** Саналын лавлах + П8 дүрмүүд — suggestions endpoint-ийн хариу. */
type ImportContext = MatchContext & { rules?: BankRule[] };

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
  const [matchContext, setMatchContext] = useState<ImportContext | null>(null);
  // П8 — дүрмийн диалог + мөрөөс урьдчилан бөглөх draft.
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<BankRuleDraft | null>(null);
  const [linesStatement, setLinesStatement] =
    useState<BankStatementSummary | null>(null);
  const [isPending, startTransition] = useTransition();

  const cashAccount = accounts.find((account) => account.id === cashAccountId);
  const [triageFilter, setTriageFilter] = useState<
    "all" | "ready" | "suggested" | "missing"
  >("all");
  // Мөрийн triage төлөв: бэлэн = данс бүрэн + (валюттай бол) ханш/MNT дүн.
  const rowReady = useCallback(
    (row: ParsedBankStatementRow) =>
      isCompleteAccountCode(
        row.debitAccountNumber,
        activeSegIds,
        segmentOptions
      ) &&
      isCompleteAccountCode(
        row.creditAccountNumber,
        activeSegIds,
        segmentOptions
      ) &&
      (cashAccount?.currency === "MNT" ||
        (!!row.exchangeRate &&
          row.exchangeRate > 0 &&
          !!row.baseAmount &&
          row.baseAmount > 0)),
    [activeSegIds, segmentOptions, cashAccount?.currency]
  );

  // invalid = rowReady-гийн урвуу — нэг л шалгуур, хоёр газар салаалахгүй.
  const totals = useMemo(
    () => ({
      income: rows.reduce((sum, row) => sum + row.income, 0),
      expense: rows.reduce((sum, row) => sum + row.expense, 0),
      invalid: rows.filter((row) => !rowReady(row)).length,
    }),
    [rows, rowReady]
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
                : {
                    ...row,
                    [field]: String(event.newValue ?? ""),
                    // ХАРЬЦАХ талын дансыг гараар өөрчилбөл нэхэмжлэхийн
                    // холбоос цуцлагдана; банкны талын засвар settlement-д
                    // нөлөөгүй тул холбоосыг хадгална.
                    ...(field ===
                    (row.income > 0
                      ? "creditAccountNumber"
                      : "debitAccountNumber")
                      ? { settleInvoiceId: null }
                      : {}),
                  }
            : row
        )
      );
    },
    []
  );

  // Саналууд нь parse хийсэн эх мөрүүдээс (дүн/харилцагч/утга засагдахгүй
  // талбарууд) бодогдоно — засвар хийхэд дахин тооцоолохгүй.
  const cashCurrency = cashAccount?.currency;
  const suggestions = useMemo<Record<string, RowSuggestion[]>>(() => {
    if (!parsed || !matchContext) return {};
    // Валют зөрсөн нэхэмжлэх санал болохгүй — save route хориглодог тул
    // ийм санал хадгалах үед бүх импортыг унагана.
    const context = cashCurrency
      ? {
          ...matchContext,
          openInvoices: matchContext.openInvoices.filter(
            (invoice) => (invoice.currency ?? "MNT") === cashCurrency
          ),
        }
      : matchContext;
    return suggestMatches(parsed.rows, context);
  }, [parsed, matchContext, cashCurrency]);

  // П8 — мөр бүрд таарах ЭХНИЙ дүрэм (parse хийсэн эх мөрүүдээс, саналуудтай
  // ижил зарчим — засвар хийхэд дахин тооцоолохгүй).
  const rules = matchContext?.rules;
  const ruleHits = useMemo<Record<string, BankRule>>(() => {
    if (!parsed || !rules?.length) return {};
    const hits: Record<string, BankRule> = {};
    for (const row of parsed.rows) {
      const rule = firstMatchingRule(row, rules);
      if (rule) hits[row.id] = rule;
    }
    return hits;
  }, [parsed, rules]);

  // Нэгдсэн саналууд — дүрэм ЭХЭНД, дараа нь нэхэмжлэх/түүхэн загвар
  // (батлагдсан дараалал: AI/тулгалтын санал rules-ийн ДАРАА давхарлана).
  const allSuggestions = useMemo<Record<string, AnySuggestion[]>>(() => {
    const merged: Record<string, AnySuggestion[]> = {};
    const ids = new Set([
      ...Object.keys(ruleHits),
      ...Object.keys(suggestions),
    ]);
    for (const id of ids) {
      const list: AnySuggestion[] = [];
      const rule = ruleHits[id];
      if (rule) list.push(toRuleSuggestion(rule));
      list.push(...(suggestions[id] ?? []));
      merged[id] = list;
    }
    return merged;
  }, [ruleHits, suggestions]);

  // Саналын дансыг бүтэн 10-part сегмент код болгоно (хуучин дата ганц
  // 8 оронтой үндсэн данс хадгалсан байж болно).
  const suggestionCode = useCallback(
    (suggestion: AnySuggestion) => {
      const raw = suggestion.counterAccountNumber ?? "";
      if (!raw) return "";
      return raw.split(".").length === 10
        ? raw
        : buildSegCode(
            { ...defaultSegments, 3: raw },
            activeSegIds,
            defaultSegments
          );
    },
    [activeSegIds, defaultSegments]
  );

  // Саналыг мөрөнд буулгах НЭГ зам: данс + (нэхэмжлэх бол) settlement
  // холбоос + (дүрэм бол) харилцагч/тайлбар солих. «Ашиглах», batch,
  // авто дүрэм гурвуулаа энийг ашиглана.
  const patchRowWithSuggestion = useCallback(
    (
      row: ParsedBankStatementRow,
      suggestion: AnySuggestion,
      code: string
    ): ParsedBankStatementRow => {
      const settleInvoiceId =
        suggestion.kind === "invoice" ? suggestion.invoiceId : null;
      const patched =
        row.income > 0
          ? { ...row, creditAccountNumber: code, settleInvoiceId }
          : { ...row, debitAccountNumber: code, settleInvoiceId };
      if (suggestion.kind === "rule") {
        if (suggestion.setCounterparty)
          patched.counterparty = suggestion.setCounterparty;
        if (suggestion.setDescription)
          patched.description = suggestion.setDescription;
      }
      return patched;
    },
    []
  );

  const applySuggestion = useCallback(
    (rowId: string, suggestion: AnySuggestion) => {
      const code = suggestionCode(suggestion);
      if (!code) return;
      // Нэхэмжлэхийн санал → хадгалахад settlement (төлбөрийн холбоос)
      // үүсгэнэ; дансны загвар/дүрмийн санал → мөрийн талбарууд бөглөнө.
      const settleInvoiceId =
        suggestion.kind === "invoice" ? suggestion.invoiceId : null;
      setError("");
      setRows((current) =>
        current.map((row) => {
          if (row.id === rowId)
            return patchRowWithSuggestion(row, suggestion, code);
          // Нэг нэхэмжлэх нэг л мөрөнд — өөр мөрөнд байсан холбоос энэ мөр
          // рүү ШИЛЖИНЭ (давхардал нь хадгалах үед бүх импортыг унагадаг).
          if (settleInvoiceId && row.settleInvoiceId === settleInvoiceId)
            return { ...row, settleInvoiceId: null };
          return row;
        })
      );
    },
    [suggestionCode, patchRowWithSuggestion]
  );

  // Санал мөрөнд бүрэн хэрэгжсэн үү: данс таарсан БА (нэхэмжлэхийн санал
  // бол) settlement холбоос нь мөн тавигдсан. Данс нь өөр замаар (олноор
  // оноох, paste) таарчихсан ч холбоогүй мөр "хэрэгжсэн" биш — холбох
  // боломж (товч) харагдана.
  const suggestionApplied = useCallback(
    (row: ParsedBankStatementRow, top: AnySuggestion, code: string) => {
      const current =
        row.income > 0 ? row.creditAccountNumber : row.debitAccountNumber;
      return (
        code !== "" &&
        current === code &&
        (top.kind !== "invoice" || row.settleInvoiceId === top.invoiceId)
      );
    },
    []
  );

  // Batch accept: өндөр итгэлтэй (нэр+дүн таарсан) top саналтай, хараахан
  // хэрэгжүүлээгүй мөрүүд — Xero-гийн "ногооныг OK" урсгал. Товчны тоолуур
  // болон үйлдэл ЯГ энэ жагсаалтаас гарна. Нэг нэхэмжлэхийг нэг л мөрөнд
  // онооно — давхардал нь хадгалах үед бүх импортыг унагадаг.
  const highConfidencePending = useMemo(() => {
    const linkedInvoiceIds = new Set(
      rows
        .map((row) => row.settleInvoiceId)
        .filter((value): value is string => !!value)
    );
    const pending: { rowId: string; top: AnySuggestion }[] = [];
    for (const row of rows) {
      const top = allSuggestions[row.id]?.[0];
      if (!top || top.confidence !== "high") continue;
      const code = suggestionCode(top);
      if (!code || suggestionApplied(row, top, code)) continue;
      if (top.kind === "invoice") {
        if (linkedInvoiceIds.has(top.invoiceId)) continue;
        linkedInvoiceIds.add(top.invoiceId);
      }
      pending.push({ rowId: row.id, top });
    }
    return pending;
  }, [rows, allSuggestions, suggestionCode, suggestionApplied]);

  const applyAllHighConfidence = useCallback(() => {
    const pendingByRowId = new Map(
      highConfidencePending.map((entry) => [entry.rowId, entry.top])
    );
    setRows((current) =>
      current.map((row) => {
        const top = pendingByRowId.get(row.id);
        if (!top) return row;
        const code = suggestionCode(top);
        if (!code) return row;
        return patchRowWithSuggestion(row, top, code);
      })
    );
  }, [highConfidencePending, suggestionCode, patchRowWithSuggestion]);

  // Дүрэм өөрчлөгдсөний дараа саналын лавлахыг сэргээнэ (мөрүүд хөндөгдөхгүй —
  // авто дүрэм зөвхөн шинэ parse дээр л шууд хэрэгжинэ).
  const refreshMatchContext = useCallback(() => {
    void fetch("/api/cash/statements/suggestions")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: (ImportContext & { error?: string }) | null) => {
        if (data && !data.error) setMatchContext(data);
      })
      .catch(() => {});
  }, []);

  // Xero-гийн "Create rule" урсгал: сонгосон мөрийн текст/чиглэл/дансаар
  // шинэ дүрмийн формыг урьдчилан бөглөж нээнэ.
  const createRuleFromSelection = useCallback(() => {
    const selected =
      (
        gridRef.current?.api as GridApi<ParsedBankStatementRow> | undefined
      )?.getSelectedRows() ?? [];
    if (selected.length !== 1) {
      setError("Дүрэм үүсгэхийн тулд яг нэг мөр сонгоно уу");
      return;
    }
    const row = selected[0];
    // Харьцах тал: орлогод кредит, зарлагад дебет данс.
    const counterOfRow =
      row.income > 0 ? row.creditAccountNumber : row.debitAccountNumber;
    setError("");
    setRuleDraft({
      matchText: (row.counterparty || row.description).trim(),
      side: row.income > 0 ? "income" : "expense",
      counterAccountNumber: isCompleteAccountCode(
        counterOfRow,
        activeSegIds,
        segmentOptions
      )
        ? counterOfRow
        : "",
    });
    setRulesOpen(true);
  }, [activeSegIds, segmentOptions]);

  const triageCounts = useMemo(() => {
    let ready = 0;
    let suggested = 0;
    let missing = 0;
    for (const row of rows) {
      if (rowReady(row)) ready += 1;
      else if (allSuggestions[row.id]?.length) suggested += 1;
      else missing += 1;
    }
    return { ready, suggested, missing };
  }, [rows, rowReady, allSuggestions]);

  const displayedRows = useMemo(() => {
    if (triageFilter === "all") return rows;
    return rows.filter((row) => {
      const ready = rowReady(row);
      if (triageFilter === "ready") return ready;
      if (triageFilter === "suggested")
        return !ready && (allSuggestions[row.id]?.length ?? 0) > 0;
      return !ready && (allSuggestions[row.id]?.length ?? 0) === 0;
    });
  }, [rows, triageFilter, rowReady, allSuggestions]);

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
          "ag-right-aligned-cell font-mono bg-[var(--ea-primary-50)]",
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
          "ag-right-aligned-cell font-mono bg-[var(--ea-primary-50)]",
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
        headerName: "Санал",
        colId: "suggestion",
        width: 280,
        sortable: false,
        cellRenderer: (
          params: ICellRendererParams<ParsedBankStatementRow>
        ) => {
          const row = params.data;
          if (!row) return null;
          const top = allSuggestions[row.id]?.[0];
          if (!top) return null;
          const targetCode = suggestionCode(top);
          const applied = suggestionApplied(row, top, targetCode);
          const label =
            top.kind === "invoice"
              ? top.documentNo
              : top.kind === "rule"
                ? `${fmtAccountDisplay(targetCode, activeSegIds)} · ${top.ruleName}`
                : `${fmtAccountDisplay(targetCode, activeSegIds)} · түгээмэл данс`;
          const hint =
            top.kind === "invoice"
              ? `${top.counterpartyName} — үлдэгдэл ${fmtMnt(top.balance)}. «Ашиглах» дарвал хадгалах үед энэ нэхэмжлэхтэй ШУУД холбогдож, төлсөн дүн нь шинэчлэгдэнэ.`
              : top.kind === "rule"
                ? `«${top.ruleName}» дүрэм — данс${
                    top.setCounterparty ? ", харилцагч" : ""
                  }${top.setDescription ? ", тайлбар" : ""} бөглөнө.`
                : `"${top.matchedText}" харилцагчид ${top.count} удаа ашигласан данс`;
          const settleLinked = applied && !!row.settleInvoiceId;
          return (
            <span className="flex h-full items-center gap-1.5">
              {/* Итгэлийн түвшний дохио — QBO/Digits загвар: ногоон=хүчтэй;
                  дүрмийн санал эх сурвалжаа «Дүрэм» гэж ил зарлана */}
              <StatusBadge
                tone={top.confidence === "high" ? "success" : "warning"}
                size="sm"
                className="shrink-0"
              >
                {top.kind === "rule"
                  ? "Дүрэм"
                  : top.confidence === "high"
                    ? "Хүчтэй"
                    : "Дунд"}
              </StatusBadge>
              <span
                title={hint}
                className={cn(
                  "min-w-0 flex-1 truncate text-xs",
                  top.confidence === "high"
                    ? "font-medium text-[var(--ea-success-fg)]"
                    : "text-[var(--ea-text-3)]"
                )}
              >
                {label}
              </span>
              {applied ? (
                <span
                  className="shrink-0 text-xs font-medium text-[var(--ea-success-fg)]"
                  title={
                    settleLinked
                      ? "Хадгалахад нэхэмжлэхийн төлбөр болж бүртгэгдэнэ"
                      : undefined
                  }
                >
                  {settleLinked ? "Холбогдсон ✓" : "Ашигласан"}
                </span>
              ) : targetCode !== "" ? (
                <button
                  type="button"
                  title={hint}
                  onClick={() => applySuggestion(row.id, top)}
                  className="shrink-0 rounded-md border border-[var(--ea-border)] px-2 py-0.5 text-xs font-medium text-[var(--ea-primary)] hover:bg-[var(--ea-primary-50)]"
                >
                  Ашиглах
                </button>
              ) : null}
            </span>
          );
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
    [
      activeSegIds,
      applySuggestion,
      cashAccount?.currency,
      defaultSegments,
      segmentOptions,
      suggestionApplied,
      suggestionCode,
      allSuggestions,
    ]
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
    // Хуучин лавлахаар (өмнөх импортын дараах хуучирсан нээлттэй нэхэмжлэх)
    // шинэ мөрүүдэд санал гаргахгүй — fetch эргэж иртэл саналгүй байна.
    setMatchContext(null);
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
        // Өмнөх хуулгын chip шүүлт үлдвэл шинэ мөрүүд далдлагдана.
        setTriageFilter("all");
        applyQuickFilter("");
        // Саналын лавлах дата (нээлттэй нэхэмжлэх + түүхэн загвар + П8
        // дүрмүүд) — фонд ачаална; амжилтгүй бол саналгүйгээр үргэлжилнэ.
        void fetch("/api/cash/statements/suggestions")
          .then((response) => (response.ok ? response.json() : null))
          .then((data: (ImportContext & { error?: string }) | null) => {
            if (!data || data.error) return;
            setMatchContext(data);
            // «Шууд бөглөх» дүрэм уншигдмагц хэрэгжинэ — хэрэглэгч
            // хадгалахаас өмнө хянаж засна (§9). Аль хэдийн бөглөгдсөн
            // (хэрэглэгчийн засварласан) талыг дарж бичихгүй.
            const autoRules = (data.rules ?? []).filter(
              (rule) => rule.mode === "auto"
            );
            if (autoRules.length === 0) return;
            const hits = new Map(
              result.rows.flatMap((row) => {
                const rule = firstMatchingRule(row, autoRules);
                return rule ? [[row.id, rule] as const] : [];
              })
            );
            if (hits.size === 0) return;
            setRows((current) =>
              current.map((row) => {
                const rule = hits.get(row.id);
                if (!rule) return row;
                const counterField =
                  row.income > 0
                    ? ("creditAccountNumber" as const)
                    : ("debitAccountNumber" as const);
                if (row[counterField] !== blankCode) return row;
                const suggestion = toRuleSuggestion(rule);
                const code = suggestionCode(suggestion);
                if (!code) return row;
                return patchRowWithSuggestion(row, suggestion, code);
              })
            );
          })
          .catch(() => {});
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
      current.map((row) => {
        if (!ids.has(row.id)) return row;
        // Харьцах талын данс өөрчлөгдвөл нэхэмжлэхийн холбоос цуцлагдана;
        // банкны талын оноолт settlement-д нөлөөгүй.
        const counterSide = row.income > 0 ? "credit" : "debit";
        return {
          ...row,
          [field]: code,
          ...(side === counterSide ? { settleInvoiceId: null } : {}),
        };
      })
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
                // Данс өөрчлөгдсөн тул нэхэмжлэхийн холбоос цуцлагдана.
                settleInvoiceId: null,
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
            <Button
              variant="outline"
              className="h-8"
              onClick={() => {
                setRuleDraft(null);
                setRulesOpen(true);
              }}
            >
              <Icon name="settings" size="sm" />
              Дүрэм{rules?.length ? ` (${rules.length})` : ""}
            </Button>
            <a
              href="/examples/golomt-bank-statement-sample.xlsx"
              download
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--ea-border)] px-2.5 text-sm font-medium text-[var(--ea-text-2)] hover:bg-[var(--ea-bg-2)]"
            >
              <Icon name="download" size="sm" />
              Жишээ XLSX
            </a>
            <a
              href="/examples/golomt-bank-statement-sample.csv"
              download
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--ea-border)] px-2.5 text-sm font-medium text-[var(--ea-text-2)] hover:bg-[var(--ea-bg-2)]"
            >
              <Icon name="download" size="sm" />
              Жишээ CSV
            </a>
            <select
              value={cashAccountId}
              onChange={(event) => {
                setCashAccountId(event.target.value);
                setParsed(null);
                setRows([]);
                setTriageFilter("all");
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
              <Icon name="upload" />
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
              <Icon name="search" size="sm" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ea-text-4)]" />
              <Input
                value={quickFilter}
                onChange={(event) => applyQuickFilter(event.target.value)}
                placeholder="Бүх баганаас нэг дор хайх..."
                className="pl-8"
              />
            </div>
            <Button variant="outline" onClick={() => openAssignment("debit")}>
              <Icon name="filter" />
              DR данс оноох
            </Button>
            <Button variant="outline" onClick={() => openAssignment("credit")}>
              <Icon name="filter" />
              CR данс оноох
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Нэг мөрийн DR/CR дансыг хуулах"
              aria-label="DR/CR данс хуулах"
              onClick={() => void copyAssignments()}
            >
              <Icon name="copy" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Сонгосон эсвэл шүүгдсэн мөрүүдэд данс буулгах"
              aria-label="DR/CR данс буулгах"
              onClick={() => void pasteAssignments()}
            >
              <Icon name="paste" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Сонгосон мөрөөс дүрэм үүсгэх"
              aria-label="Мөрөөс дүрэм үүсгэх"
              onClick={createRuleFromSelection}
            >
              <Icon name="addDocument" />
            </Button>
            <span className="text-xs text-[var(--ea-text-3)]">
              {selectedCount > 0
                ? `${selectedCount} мөр сонгосон`
                : `${rows.length} мөр`}
            </span>
          </div>

          {/* Triage — Xero загвар: төлөвөөр шүүж, өндөр итгэлтэйг нэг товчоор */}
          <div className="flex flex-wrap items-center gap-2">
            <FilterChips
              options={[
                { value: "all", label: "Бүгд", count: rows.length },
                { value: "ready", label: "Бэлэн", count: triageCounts.ready },
                {
                  value: "suggested",
                  label: "Саналтай",
                  count: triageCounts.suggested,
                  tone: "warning",
                },
                {
                  value: "missing",
                  label: "Данс дутуу",
                  count: triageCounts.missing,
                  tone: "warning",
                },
              ]}
              value={triageFilter}
              onChange={setTriageFilter}
            />
            {highConfidencePending.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={applyAllHighConfidence}
              >
                <Icon name="approveAll" size="sm" />
                Хүчтэй саналыг бүгдийг ашиглах ({highConfidencePending.length})
              </Button>
            )}
          </div>

          <DataGridDynamic<ParsedBankStatementRow>
            ref={gridRef}
            rowData={displayedRows}
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
              <Icon name="approve" />
              Хуулга хадгалж GL-д бичих
            </Button>
          </div>
        </section>
      )}

      {statements.length > 0 && (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-center gap-2">
            <Icon name="spreadsheet" className="text-[var(--ea-primary)]" />
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
              Импортын түүх
            </h2>
          </div>
          <p className="mb-1.5 text-[11px] text-[var(--ea-text-4)]">
            Мөр дээр давхар даралт — импортын мөрүүд, баримт руу очиж буцаах
            боломжтой
          </p>
          <DataGridDynamic<BankStatementSummary>
            rowData={statements}
            columnDefs={statementColumns}
            getRowId={(params) => params.data.id}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
            onRowDoubleClicked={(event) => {
              if (event.data) setLinesStatement(event.data);
            }}
          />
        </section>
      )}

      {/* Импортын мөрүүдийн drill — undo зам: мөр → кассын баримт → Буцаах */}
      <Dialog
        open={linesStatement !== null}
        onOpenChange={(open) => !open && setLinesStatement(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          {linesStatement && (
            <StatementLinesBody statement={linesStatement} />
          )}
        </DialogContent>
      </Dialog>

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

      {/* П8 — банкны хуулгын дүрмийн удирдлага */}
      <BankRulesDialog
        open={rulesOpen}
        onOpenChange={(open) => {
          setRulesOpen(open);
          if (!open) setRuleDraft(null);
        }}
        activeSegIds={activeSegIds}
        segmentOptions={segmentOptions}
        defaultSegments={defaultSegments}
        draft={ruleDraft}
        onRulesChanged={refreshMatchContext}
      />
    </div>
  );
}

// ── Импортын мөрүүдийн drill — түүхээс мөр бүрийн баримт руу ────────────────

type StatementLineView = {
  id: string;
  rowNumber: number;
  transactionDate: string;
  description: string;
  counterparty: string | null;
  income: number;
  expense: number;
  cashDocumentId: string | null;
  documentNo: string | null;
  documentStatus: string | null;
};

// cash-doc-panel-ийн статусын өнгөтэй ИЖИЛ — нэг баримт хоёр UI-д өөр
// өнгөөр харагдаж болохгүй (reversed = muted).
const LINE_DOC_STATUS: Record<string, { label: string; tone: "success" | "danger" | "muted" }> = {
  posted: { label: "Батлагдсан", tone: "success" },
  reversed: { label: "Буцаагдсан", tone: "muted" },
};

function StatementLinesBody({
  statement,
}: {
  statement: BankStatementSummary;
}) {
  const [loaded, setLoaded] = useState<
    | { ok: true; lines: StatementLineView[] }
    | { ok: false; message: string }
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cash/statements/${statement.id}/lines`)
      .then(async (response) => {
        const data = (await response.json()) as {
          lines?: StatementLineView[];
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || data.error || !data.lines)
          setLoaded({ ok: false, message: data.error || "Ачаалж чадсангүй" });
        else setLoaded({ ok: true, lines: data.lines });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ ok: false, message: "Ачаалж чадсангүй" });
      });
    return () => {
      cancelled = true;
    };
  }, [statement.id]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{statement.fileName} — импортын мөрүүд</DialogTitle>
      </DialogHeader>
      <p className="text-xs text-[var(--ea-text-3)]">
        Мөр бүрийн «Баримт» товчоор кассын баримтыг нээж, шаардлагатай бол
        тэндээсээ «Буцаах» хийнэ (undo).
      </p>
      {loaded === null ? (
        <p className="py-4 text-center text-xs text-[var(--ea-text-4)]">
          Ачаалж байна…
        </p>
      ) : !loaded.ok ? (
        <p className="text-sm text-[var(--ea-danger-fg)]">{loaded.message}</p>
      ) : (
        <ul className="max-h-[55vh] space-y-1 overflow-y-auto">
          {loaded.lines.map((line) => {
            const status = line.documentStatus
              ? LINE_DOC_STATUS[line.documentStatus] ?? {
                  label: line.documentStatus,
                  tone: "muted" as const,
                }
              : { label: "Баримт устгагдсан", tone: "muted" as const };
            return (
              <li
                key={line.id}
                className="flex items-center gap-2 rounded border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-2.5 py-1.5 text-xs"
              >
                <span className="w-8 shrink-0 font-mono text-[var(--ea-text-4)]">
                  {line.rowNumber}
                </span>
                <span className="w-20 shrink-0 font-mono text-[var(--ea-text-4)]">
                  {line.transactionDate}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--ea-text-1)]">
                  {line.description}
                  {line.counterparty ? ` · ${line.counterparty}` : ""}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-mono",
                    line.income > 0
                      ? "text-[var(--ea-success-fg)]"
                      : "text-[var(--ea-danger-fg)]"
                  )}
                >
                  {line.income > 0
                    ? fmtMnt(line.income)
                    : `−${fmtMnt(line.expense)}`}
                </span>
                <StatusBadge
                  tone={status.tone}
                  size="sm"
                  className="shrink-0"
                >
                  {status.label}
                </StatusBadge>
                {line.cashDocumentId && (
                  <Button
                    variant="outline"
                    size="xs"
                    className="shrink-0 text-[var(--ea-primary)]"
                    onClick={() =>
                      openCashDocPanel(
                        line.cashDocumentId!,
                        line.documentNo ?? undefined
                      )
                    }
                  >
                    Баримт
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

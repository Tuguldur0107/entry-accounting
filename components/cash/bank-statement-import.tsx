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
import { PageTabs } from "@/components/ui/tabs";
import {
  Dropdown,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { IconAction } from "@/components/ui/icon-action";
import { fmtMntCompact } from "@/lib/format/money";
import { col } from "@/lib/grid/columnTypes";
import {
  GolomtConnectionDialog,
  GolomtFetchDialog,
} from "@/components/cash/golomt-dialogs";
import {
  isGolomtCashAccount,
  type GolomtConnectionView,
  type GolomtPendingPull,
} from "@/lib/bank/golomt/constants";
import { dismissGolomtPull, openGolomtPull } from "@/lib/actions/bank-api";
import { getAdvanceSettings } from "@/lib/actions/arap-advances";
import { createCounterparty } from "@/lib/actions/arap";
import {
  CounterpartyDialog,
  blankCounterpartyForm,
  counterpartyPayload,
  type CounterpartyFormState,
} from "@/components/arap/arap-workspace";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InvoicePickerDialog } from "@/components/cash/invoice-picker-dialog";
import {
  BankRowPreviewDialog,
  BankRowPreviewStrip,
} from "@/components/cash/bank-row-preview-dialog";
import {
  fillInvoiceCounterAccounts,
  mainAccountOfCode,
  suggestInvoiceCounterAccount,
  type InvoiceAccountHints,
  type PreviewContext,
  type PreviewCounterparty,
  type PreviewVatSettings,
} from "@/lib/cash/bank-row-preview";
import type { EntityKindOption } from "@/lib/arap/counterparty-kind";
import {
  AdvanceSettingsDialog,
  type AdvanceSettingsView,
} from "@/components/cash/advance-settings-dialog";
import type {
  ParsedBankStatement,
  ParsedBankStatementRow,
  StatementDraft,
} from "@/lib/cash/bank-statement-types";
import {
  firstMatchingRule,
  toRuleSuggestion,
  type BankRule,
  type RuleSuggestion,
} from "@/lib/cash/bank-rules";
import {
  suggestEwalletSettlements,
  type EwalletSettlementMethod,
  type EwalletSettlementSuggestion,
} from "@/lib/cash/ewallet-settlement";
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
import {
  SearchSelectCellEditor,
  type SearchSelectOption,
} from "@/lib/grid/editors/SearchSelectCellEditor";
import {
  BANK_ROW_ACTION_LABELS,
  bankRowActionAdvanceSide,
  bankRowActionDirection,
  bankRowActionInvoiceType,
  BANK_ROW_ACTIONS,
  isBankRowAction,
  type AdvanceSide,
} from "@/lib/arap/advance-math";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { openCashDocPanel } from "@/lib/store/panel-store";
import { feedback } from "@/lib/ui/feedback";
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
  /** Голомт банкны API (docs/dev/bank-api.md) — null бол товчнууд харагдахгүй. */
  golomt?: {
    connection: GolomtConnectionView | null;
    defaultRegisterNo: string;
    /** admin+ — холболтын тохиргоог засна. */
    canManage: boolean;
    /** Өдрийн автомат татлагаар ирсэн, хянагдаагүй хуулга (docs/dev/bank-api.md §7). */
    pendingPulls: GolomtPendingPull[];
  } | null;
  /** «+ Шинэ харилцагч» — хуулгын дэлгэцээс гаралгүй (docs/dev/arap.md §5l). */
  counterpartyCreate?: {
    entityKinds: EntityKindOption[];
    defaultAccountNumbers: { receivable: string; payable: string };
  };
  /** Хадгалаагүй хуулгын ноорог — хуудсанд буцаж ороход сэргэнэ. */
  draft?: StatementDraft | null;
}

/** "counter" — мөр бүрийн ХАРЬЦАХ тал (орлогод CR, зарлагад DR); банкны тал хөндөгдөхгүй. */
type AssignmentSide = "debit" | "credit" | "counter";
type AssignmentScope = "selected" | "filtered";

/** «Санал» баганы нэгдсэн төрөл — дүрэм → э-хэтэвчийн settlement → нэхэмжлэх → түүхэн загвар. */
type AnySuggestion = RuleSuggestion | EwalletSettlementSuggestion | RowSuggestion;

/** Саналын лавлах + П8 дүрмүүд + э-хэтэвчийн хэлбэрүүд — suggestions endpoint-ийн хариу. */
type ImportContext = MatchContext & {
  rules?: BankRule[];
  ewalletMethods?: EwalletSettlementMethod[];
  /** Идэвхтэй харилцагчид — мөрийн харилцагч сонгогч (docs/dev/arap.md §5l). */
  counterparties?: (PreviewCounterparty & { counterpartyType: string })[];
  /** Нэхэмжлэх үүсгэх мөрийн харьцах дансны санал (өмнөх нэхэмжлэхээс). */
  invoiceAccountHints?: InvoiceAccountHints;
  /** Бичилтийн урьдчилсан харагдацад — НӨАТ, default хяналтын данс. */
  vat?: PreviewVatSettings;
  defaultControl?: { receivable: string; payable: string };
  /** Урьдчилгааны дансны роль — «Бүртгэл» сонгоход харьцах тал бөглөгдөнө. */
  advanceSettings?: {
    customerAdvanceAccountNumber: string;
    supplierAdvanceAccountNumber: string;
  };
};

/**
 * «Бүртгэл» баганы түр утга (мөрийн объектоор, WeakMap — мөр солигдмогц
 * алга). AG Grid valueSetter-ийн дараа шинэ утгыг valueGetter-ээр ДАХИН
 * уншдаг тул сонголтыг энд барьж, handler өмнөх төлвийг (нэхэмжлэх /
 * урьдчилгаа) хөндөлгүй applyBookingEdit-ээр бичнэ.
 */
const PENDING_BOOKING = new WeakMap<ParsedBankStatementRow, string>();

/** Харилцагч сонгогчийн «+ Шинэ харилцагч» сонголтын утга (бодит ID биш). */
const NEW_COUNTERPARTY = "__new_counterparty__";

/** «Бүртгэл» сонгогчийн «Нэхэмжлэх сонгох…» — InvoicePickerDialog нээнэ. */
const PICK_INVOICE = "__pick_invoice__";

const COUNTERPARTY_TYPE_HINTS: Record<string, string> = {
  customer: "Авлага",
  supplier: "Өглөг",
  both: "Авлага/Өглөг",
};

/**
 * Харьцах талыг ГАРААР өөрчлөхөд: нэхэмжлэх / settlement-ийн холбоос болон
 * урьдчилгааны бүртгэл цуцлагдана (данс нь урьдчилгааных байхаа больсон).
 * «Авлага үүсгэж борлуулалтад» / «Өглөг үүсгэж зардалд» нь харьцах тал =
 * орлого / зардал тул хэвээр.
 */
function counterSideReset(row: ParsedBankStatementRow): Partial<ParsedBankStatementRow> {
  return {
    settleInvoiceId: null,
    ewalletSettlement: null,
    rowAction: bankRowActionInvoiceType(row.rowAction) ? row.rowAction : null,
  };
}

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
  golomt,
  counterpartyCreate,
  draft,
}: Props) {
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirm();
  // «+ Шинэ харилцагч» — тухайн мөрөнд үүсгээд шууд холбоно.
  const [newCounterparty, setNewCounterparty] = useState<{
    rowId: string;
    form: CounterpartyFormState;
  } | null>(null);
  const [newCounterpartyError, setNewCounterpartyError] = useState("");
  // Хуудасны цэгц: «Хуулга оруулах ▾», ⚙ тохиргоо, автомат татлагын chip,
  // хянах үед «Хянах | Импортын түүх» таб.
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [pullsMenuOpen, setPullsMenuOpen] = useState(false);
  const [view, setView] = useState<"review" | "history">("review");
  const fileRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<DataGridHandle>(null);
  // Хадгалаагүй хуулгын ноорог (§5l) — идэвхтэй банкны данстай бол анхны
  // төлөв болж сэргэнэ (хуудсанд буцаж ороход ажил алга болохгүй).
  const [initialDraft] = useState(() =>
    draft &&
    draft.rows.length > 0 &&
    accounts.some(
      (item) => item.id === draft.cashAccountId && item.isActive && item.accountType === "bank"
    )
      ? draft
      : null
  );
  const [cashAccountId, setCashAccountId] = useState(initialDraft?.cashAccountId ?? "");
  const [parsed, setParsed] = useState<ParsedBankStatement | null>(
    initialDraft ? { ...initialDraft.statement, rows: initialDraft.rows } : null
  );
  const [rows, setRows] = useState<ParsedBankStatementRow[]>(initialDraft?.rows ?? []);
  const [quickFilter, setQuickFilter] = useState("");
  const [selectedCount, setSelectedCount] = useState(0);
  // Бичилтийн урьдчилсан харагдац — сонгосон мөрүүд, эс бөгөөс бүх мөр.
  const [previewRows, setPreviewRows] = useState<ParsedBankStatementRow[] | null>(null);
  // Хүснэгтийн доорх бичилтийн хэсэг — курсортой (дарсан / гараар шилжсэн) мөр.
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const activeRow = useMemo(
    () => (activeRowId ? rows.find((row) => row.id === activeRowId) ?? null : null),
    [activeRowId, rows]
  );
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
  const [golomtConnection, setGolomtConnection] = useState(
    golomt?.connection ?? null
  );
  const [golomtSettingsOpen, setGolomtSettingsOpen] = useState(false);
  const [golomtFetchOpen, setGolomtFetchOpen] = useState(false);
  const [advanceSettings, setAdvanceSettings] = useState<AdvanceSettingsView | null>(null);
  // Нэхэмжлэх сонгох цонх — мөрийн ID.
  const [invoicePicker, setInvoicePicker] = useState<string | null>(null);

  const cashAccount = accounts.find((account) => account.id === cashAccountId);
  // Мөр бэлэн эсэх: данс бүрэн + (валюттай бол) ханш/MNT дүн.
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
          row.baseAmount > 0)) &&
      // Урьдчилгаа / өглөг үүсгэх мөрд харилцагч ЗААВАЛ (save ч шалгана).
      (!row.rowAction || !!row.counterpartyId),
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

  // «Бүртгэл», харилцагч, нэхэмжлэх сонголт (docs/dev/arap.md §5l) — харьцах
  // талыг бөглөх / цэвэрлэх НЭГ зам. Урьдчилгаа → тохиргооны урьдчилгааны
  // данс; нэхэмжлэх → түүний хяналтын данс + харилцагч.
  const applyBookingEdit = useCallback(
    (
      rowId: string,
      field: "counterpartyId" | "rowAction" | "settleInvoiceId",
      value: unknown
    ) => {
      const blankCode = emptyAccountCode(activeSegIds, defaultSegments);
      const codeOf = (main: string) =>
        main.split(".").length === 10
          ? main
          : buildSegCode({ ...defaultSegments, 3: main }, activeSegIds, defaultSegments);
      const advanceCode = (side: AdvanceSide) => {
        const settings = matchContext?.advanceSettings;
        if (!settings) return null;
        return codeOf(
          side === "customer"
            ? settings.customerAdvanceAccountNumber
            : settings.supplierAdvanceAccountNumber
        );
      };
      // «Авлага үүсгэж борлуулалтад» / «Өглөг үүсгэж зардалд»: харьцах тал
      // хоосон бол өмнөх нэхэмжлэхээс санал болгосон орлого / зардлын данс
      // (lib/cash/bank-row-preview.ts — данс ЗОХИОХГҮЙ, түүхгүй бол хоосон).
      const invoiceCounterCode = (
        documentType: "ar_invoice" | "ap_bill" | null,
        counterpartyId: string | null | undefined,
        current: string
      ) => {
        if (!documentType || mainAccountOfCode(current)) return current;
        const main = suggestInvoiceCounterAccount(
          matchContext?.invoiceAccountHints,
          documentType,
          counterpartyId
        );
        return main ? codeOf(main) : current;
      };
      const text = value == null ? "" : String(value);
      setRows((current) =>
        current.map((row) => {
          if (row.id !== rowId) return row;
          const counterField =
            row.income > 0 ? ("creditAccountNumber" as const) : ("debitAccountNumber" as const);
          if (field === "counterpartyId") {
            const master = text
              ? matchContext?.counterparties?.find((item) => item.id === text)
              : undefined;
            const original =
              parsed?.rows.find((item) => item.id === rowId)?.counterparty ?? row.counterparty;
            const linked = row.settleInvoiceId
              ? matchContext?.openInvoices.find((item) => item.id === row.settleInvoiceId)
              : undefined;
            const filled = invoiceCounterCode(
              bankRowActionInvoiceType(row.rowAction),
              master?.id ?? null,
              row[counterField]
            );
            return {
              ...row,
              counterpartyId: master?.id ?? null,
              counterparty: master?.name ?? original,
              [counterField]: filled,
              // Өөр харилцагчийн нэхэмжлэх холбоотой үлдэхгүй.
              ...(linked && master && linked.counterpartyId && linked.counterpartyId !== master.id
                ? { settleInvoiceId: null, [counterField]: blankCode }
                : {}),
            };
          }
          if (field === "rowAction") {
            const action = isBankRowAction(text) ? text : null;
            const side = action ? bankRowActionAdvanceSide(action) : null;
            const previousSide = row.rowAction ? bankRowActionAdvanceSide(row.rowAction) : null;
            const keptCode = previousSide || row.settleInvoiceId || row.ewalletSettlement
              ? blankCode
              : row[counterField];
            const nextCode = side
              ? advanceCode(side)
              : invoiceCounterCode(bankRowActionInvoiceType(action), row.counterpartyId, keptCode);
            return {
              ...row,
              rowAction: action,
              settleInvoiceId: null,
              ewalletSettlement: null,
              [counterField]: nextCode ?? row[counterField],
            };
          }
          const invoice = text
            ? matchContext?.openInvoices.find((item) => item.id === text)
            : undefined;
          if (!invoice)
            return {
              ...row,
              settleInvoiceId: null,
              [counterField]: row.settleInvoiceId ? blankCode : row[counterField],
            };
          const master = invoice.counterpartyId
            ? matchContext?.counterparties?.find((item) => item.id === invoice.counterpartyId)
            : undefined;
          return {
            ...row,
            settleInvoiceId: invoice.id,
            rowAction: null,
            ewalletSettlement: null,
            [counterField]: invoice.controlAccountNumber
              ? codeOf(invoice.controlAccountNumber)
              : row[counterField],
            counterpartyId: invoice.counterpartyId ?? row.counterpartyId ?? null,
            counterparty: master?.name ?? invoice.counterpartyName,
          };
        })
      );
    },
    [activeSegIds, defaultSegments, matchContext, parsed]
  );

  // Саналын лавлах ирмэгц «Бүртгэл» нь нэхэмжлэх үүсгэх боловч харьцах тал
  // хоосон мөрүүдийг бөглөнө (сэргээсэн ноорог г.м.). Fetch-ийн callback-аас
  // дуудагддаг тул ref-ээр хамгийн сүүлийн сегментийн тохиргоог авна.
  const applyInvoiceHintsRef = useRef<(hints: InvoiceAccountHints | undefined) => void>(() => {});
  useEffect(() => {
    applyInvoiceHintsRef.current = (hints) =>
      setRows((current) =>
        fillInvoiceCounterAccounts(current, hints, (main) =>
          buildSegCode({ ...defaultSegments, 3: main }, activeSegIds, defaultSegments)
        )
      );
  }, [activeSegIds, defaultSegments]);

  // Бичилтийн урьдчилсан харагдац (lib/cash/bank-row-preview.ts) — сервертэй
  // ижил дүрмээр; хадгалахаас өмнө давхар бичилтийг харуулна.
  const previewContext = useMemo<PreviewContext>(
    () => ({
      vat: matchContext?.vat ?? null,
      counterparties: matchContext?.counterparties ?? [],
      defaultControl: matchContext?.defaultControl ?? null,
      invoiceControl: (invoiceId) =>
        matchContext?.openInvoices.find((invoice) => invoice.id === invoiceId)?.controlAccountNumber ?? null,
    }),
    [matchContext]
  );
  const accountNameOf = useCallback(
    (main: string) => segmentOptions[3]?.find((option) => option.code === main)?.name ?? "",
    [segmentOptions]
  );
  const openPreview = useCallback(() => {
    // Сонгосон мөрийг ID-аар ОДООГИЙН төлвөөс авна (grid-ийн хуучин объект биш).
    const selectedIds = new Set(
      ((gridRef.current?.api?.getSelectedRows() ?? []) as ParsedBankStatementRow[]).map((row) => row.id)
    );
    const selected = rows.filter((row) => selectedIds.has(row.id));
    setPreviewRows(selected.length > 0 ? selected : rows);
  }, [rows]);

  // «+ Шинэ харилцагч» — нэр, харьцсан данс хуулгын мөрөөс; орлого → авлага,
  // зарлага → өглөгийн харилцагч. Хадгалмагц тухайн мөрөнд шууд холбоно.
  const openNewCounterparty = useCallback(
    (row: ParsedBankStatementRow) => {
      if (!counterpartyCreate) return;
      const original = parsed?.rows.find((item) => item.id === row.id);
      const form = blankCounterpartyForm({
        counterpartyType: row.income > 0 ? "customer" : "supplier",
        defaultAccountNumbers: counterpartyCreate.defaultAccountNumbers,
        activeSegIds,
        defaultSegments,
      });
      setNewCounterpartyError("");
      setNewCounterparty({
        rowId: row.id,
        form: {
          ...form,
          name: (original?.counterparty ?? row.counterparty ?? "").trim(),
          bankAccountNo: (row.counterAccount ?? "").trim(),
        },
      });
    },
    [counterpartyCreate, parsed, activeSegIds, defaultSegments]
  );

  function saveNewCounterparty() {
    if (!newCounterparty) return;
    const { rowId, form } = newCounterparty;
    setNewCounterpartyError("");
    startTransition(async () => {
      const result = await createCounterparty(counterpartyPayload(form));
      if (result.error || !result.id) {
        setNewCounterpartyError(result.error ?? "Харилцагч үүсгэж чадсангүй");
        return;
      }
      const created = { id: result.id, name: form.name.trim(), counterpartyType: form.counterpartyType };
      setMatchContext((current) =>
        current
          ? { ...current, counterparties: [...(current.counterparties ?? []), created] }
          : current
      );
      setRows((current) =>
        current.map((row) =>
          row.id === rowId ? { ...row, counterpartyId: created.id, counterparty: created.name } : row
        )
      );
      setNewCounterparty(null);
      feedback.saved(`${created.name} үүсч мөрөнд холбогдлоо`);
    });
  }

  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent<ParsedBankStatementRow>) => {
      const colId = event.colDef.colId;
      // «Бүртгэл» (нэгдсэн): "" ердийн · "action:<төрөл>" · "invoice:<id>".
      if (colId === "booking") {
        const value = String(event.newValue ?? "");
        PENDING_BOOKING.delete(event.data);
        if (value === PICK_INVOICE) {
          // Мөрийн утга хөндөгдөөгүй — нүдийг хуучнаар нь дахин зурж цонх нээнэ.
          event.api.refreshCells({ rowNodes: [event.node], columns: ["booking"], force: true });
          setInvoicePicker(event.data.id);
          return;
        }
        if (value.startsWith("invoice:"))
          applyBookingEdit(event.data.id, "settleInvoiceId", value.slice("invoice:".length));
        else
          applyBookingEdit(
            event.data.id,
            "rowAction",
            value.startsWith("action:") ? value.slice("action:".length) : null
          );
        return;
      }
      // «Харьцах данс» — мөрийн чиглэлээр DR эсвэл CR тал.
      const field =
        colId === "counterAccountCode"
          ? event.data.income > 0
            ? "creditAccountNumber"
            : "debitAccountNumber"
          : event.colDef.field;
      if (field === "counterpartyId" && event.newValue === NEW_COUNTERPARTY) {
        // Grid утгыг шууд өөрчилсөн — хуучнаар нь сэргээгээд үүсгэх цонх нээнэ.
        const rowId = event.data.id;
        setRows((current) =>
          current.map((row) =>
            row.id === rowId ? { ...row, counterpartyId: (event.oldValue as string | null) ?? null } : row
          )
        );
        openNewCounterparty(event.data);
        return;
      }
      if (
        field === "counterpartyId" ||
        field === "rowAction" ||
        field === "settleInvoiceId"
      ) {
        applyBookingEdit(event.data.id, field, event.newValue);
        return;
      }
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
                      ? counterSideReset(row)
                      : {}),
                  }
            : row
        )
      );
    },
    [applyBookingEdit, openNewCounterparty]
  );

  // Мөрийн харилцагч / нэхэмжлэх сонгогчийн жагсаалт (docs/dev/arap.md §5l).
  const counterpartyOptions = useMemo<SearchSelectOption[]>(
    () => [
      // Бүртгэлгүй харилцагчийг хуулгын дэлгэцээс гаралгүй үүсгэнэ.
      ...(counterpartyCreate
        ? [{ value: NEW_COUNTERPARTY, label: "+ Шинэ харилцагч үүсгэх…" }]
        : []),
      ...(matchContext?.counterparties ?? []).map((item) => ({
        value: item.id,
        label: item.name,
        hint: COUNTERPARTY_TYPE_HINTS[item.counterpartyType] ?? "",
      })),
    ],
    [matchContext, counterpartyCreate]
  );
  const invoiceLabelById = useMemo(
    () => new Map((matchContext?.openInvoices ?? []).map((item) => [item.id, item.documentNo])),
    [matchContext]
  );
  // Мөрийн чиглэл (АР/АП) ба валютад тохирох нээлттэй нэхэмжлэхүүд —
  // харилцагчаар шүүхгүй (нэхэмжлэх сонгох цонх өөрөө «Энэ харилцагч»-аар шүүнэ).
  const invoicesForRow = useCallback(
    (row: ParsedBankStatementRow | undefined) => {
      if (!row) return [];
      const type = row.income > 0 ? "ar_invoice" : "ap_bill";
      return (matchContext?.openInvoices ?? []).filter(
        (item) =>
          item.documentType === type &&
          (item.currency ?? "MNT") === (cashAccount?.currency ?? "MNT")
      );
    },
    [matchContext, cashAccount?.currency]
  );
  // «Бүртгэл» сонгогч: мөрийн чиглэлд тохирох төрлүүд + «Нэхэмжлэх сонгож
  // хаах…» (том цонх) + мөрийн дүнтэй ЯГ таарсан нэхэмжлэх (≤3, шууд сонголт).
  const bookingOptionsFor = useCallback(
    (row: ParsedBankStatementRow | undefined): SearchSelectOption[] => {
      if (!row) return [];
      const direction = row.income > 0 ? "income" : "expense";
      const amount = row.income || row.expense;
      const invoices = invoicesForRow(row);
      const exact = invoices
        .filter(
          (item) =>
            (!row.counterpartyId || !item.counterpartyId || item.counterpartyId === row.counterpartyId) &&
            Math.abs(item.totalAmount - item.paidAmount - amount) <= 0.005
        )
        .slice(0, 3);
      return [
        ...BANK_ROW_ACTIONS.filter((action) => bankRowActionDirection(action) === direction).map(
          (action) => ({ value: `action:${action}`, label: BANK_ROW_ACTION_LABELS[action] })
        ),
        ...(invoices.length > 0
          ? [
              {
                value: PICK_INVOICE,
                label: `${direction === "income" ? "Авлага" : "Өглөг"} хаах — нэхэмжлэх сонгох…`,
                hint: String(invoices.length),
              },
            ]
          : []),
        ...exact.map((item) => ({
          value: `invoice:${item.id}`,
          label: `Хаах · ${item.documentNo} · ${item.counterpartyName}`,
          hint: fmtMnt(item.totalAmount - item.paidAmount),
        })),
      ];
    },
    [invoicesForRow]
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

  // Э-хэтэвчийн (QPay) settlement — түр дансны тулгагдаагүй орлогуудыг FIFO-оор
  // тулгана (зөвхөн MNT банкны данс; save route ч хориглодог).
  const ewalletMethods = matchContext?.ewalletMethods;
  const ewalletSuggestions = useMemo<Record<string, EwalletSettlementSuggestion[]>>(() => {
    if (!parsed || !ewalletMethods?.length || cashCurrency !== "MNT") return {};
    return suggestEwalletSettlements(parsed.rows, ewalletMethods);
  }, [parsed, ewalletMethods, cashCurrency]);

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
      ...Object.keys(ewalletSuggestions),
      ...Object.keys(suggestions),
    ]);
    for (const id of ids) {
      const list: AnySuggestion[] = [];
      const rule = ruleHits[id];
      if (rule) list.push(toRuleSuggestion(rule));
      list.push(...(ewalletSuggestions[id] ?? []));
      list.push(...(suggestions[id] ?? []));
      merged[id] = list;
    }
    return merged;
  }, [ruleHits, ewalletSuggestions, suggestions]);

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
      // Settlement санал → хадгалахад шилжүүлэг + шимтгэл (import-statement.ts).
      const ewalletSettlement =
        suggestion.kind === "ewallet_settlement"
          ? {
              paymentMethodId: suggestion.paymentMethodId,
              grossAmount: suggestion.grossAmount,
              feeAmount: suggestion.feeAmount,
            }
          : null;
      // Санал харьцах талыг солих тул урьдчилгаа / өглөг үүсгэх бүртгэл цуцлагдана.
      const patched =
        row.income > 0
          ? { ...row, creditAccountNumber: code, settleInvoiceId, ewalletSettlement, rowAction: null }
          : { ...row, debitAccountNumber: code, settleInvoiceId, ewalletSettlement, rowAction: null };
      if (suggestion.kind === "invoice") {
        // Нэхэмжлэхийн харилцагчийг мөрөнд бүртгэлээр нь холбоно.
        const invoice = matchContext?.openInvoices.find((item) => item.id === suggestion.invoiceId);
        if (invoice?.counterpartyId) patched.counterpartyId = invoice.counterpartyId;
      }
      if (suggestion.kind === "rule") {
        if (suggestion.setCounterparty)
          patched.counterparty = suggestion.setCounterparty;
        if (suggestion.setDescription)
          patched.description = suggestion.setDescription;
      }
      return patched;
    },
    [matchContext]
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
        (top.kind !== "invoice" || row.settleInvoiceId === top.invoiceId) &&
        (top.kind !== "ewallet_settlement" ||
          (row.ewalletSettlement?.paymentMethodId === top.paymentMethodId &&
            row.ewalletSettlement.grossAmount === top.grossAmount))
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
        if (!data || data.error) return;
        setMatchContext(data);
        applyInvoiceHintsRef.current(data.invoiceAccountHints);
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

  const validationText = useCallback(
    (row: ParsedBankStatementRow | undefined) => {
      if (!row) return "";
      const accountsReady =
        isCompleteAccountCode(row.debitAccountNumber, activeSegIds, segmentOptions) &&
        isCompleteAccountCode(row.creditAccountNumber, activeSegIds, segmentOptions);
      if (!accountsReady) return "Данс дутуу";
      if (row.rowAction && !row.counterpartyId) return "Харилцагч дутуу";
      return "Бэлэн";
    },
    [activeSegIds, segmentOptions]
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
        headerName: "Гүйлгээний утга",
        field: "description",
        minWidth: 240,
        flex: 1,
      },
      {
        // Бүртгэлтэй харилцагч сонгоно — урьдчилгаа / өглөг үүсгэхэд ЗААВАЛ.
        headerName: "Харилцагч",
        field: "counterpartyId",
        colId: "counterparty",
        minWidth: 170,
        editable: true,
        cellEditor: SearchSelectCellEditor,
        cellEditorPopup: true,
        cellEditorParams: {
          options: counterpartyOptions,
          emptyLabel: "— бүртгэлгүй (хуулгын нэрээр)",
        },
        // Хуулгын «харьцсан данс» (текст) тусдаа баганагүй — tooltip, хайлтад.
        getQuickFilterText: (params) =>
          `${params.data?.counterparty ?? ""} ${params.data?.counterAccount ?? ""}`,
        tooltipValueGetter: (params) =>
          params.data?.counterAccount ? `Харьцсан данс: ${params.data.counterAccount}` : undefined,
        valueFormatter: (params) => params.data?.counterparty ?? "",
        cellClass: (params) =>
          params.data?.counterpartyId
            ? "font-medium text-[var(--ea-text-1)]"
            : "text-[var(--ea-text-3)]",
      },
      {
        headerName: "Харьцсан данс",
        field: "counterAccount",
        minWidth: 150,
        hide: true,
        cellClass: "font-mono text-xs",
      },
      // Орлого (+) / зарлага (−) НЭГ багана — стандарт readonly-money.
      col<ParsedBankStatementRow>({
        eaType: "readonly-money",
        headerName: "Дүн",
        colId: "amount",
        width: 150,
        valueGetter: (params: { data?: ParsedBankStatementRow }) =>
          params.data ? (params.data.income > 0 ? params.data.income : -params.data.expense) : 0,
      }),
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
        // Мөрийн бүртгэл (docs/dev/arap.md §5l) — төрөл ба хаах нэхэмжлэх НЭГ
        // сонгогчид: "" ердийн · "action:<төрөл>" · "invoice:<id>".
        headerName: "Бүртгэл",
        colId: "booking",
        width: 230,
        editable: (params) => !params.data?.ewalletSettlement,
        cellEditor: SearchSelectCellEditor,
        cellEditorPopup: true,
        cellEditorParams: (params: { data?: ParsedBankStatementRow }) => ({
          options: bookingOptionsFor(params.data),
          emptyLabel: "Ердийн (харьцах данс)",
        }),
        valueGetter: (params) => {
          const row = params.data;
          if (!row) return "";
          const pending = PENDING_BOOKING.get(row);
          if (pending !== undefined) return pending;
          if (row.settleInvoiceId) return `invoice:${row.settleInvoiceId}`;
          if (row.rowAction) return `action:${row.rowAction}`;
          return "";
        },
        // Шинэ утгыг түр барина — бодит бичилт handleCellValueChanged → applyBookingEdit.
        valueSetter: (params) => {
          if (!params.data) return false;
          PENDING_BOOKING.set(params.data, String(params.newValue ?? ""));
          return true;
        },
        valueFormatter: (params) => {
          const row = params.data;
          if (!row) return "";
          if (row.settleInvoiceId)
            return `${row.income > 0 ? "Авлага хаах" : "Өглөг хаах"} · ${
              invoiceLabelById.get(row.settleInvoiceId) ?? "нэхэмжлэх"
            }`;
          if (row.rowAction && isBankRowAction(row.rowAction))
            return BANK_ROW_ACTION_LABELS[row.rowAction];
          if (row.ewalletSettlement) return "Э-хэтэвчийн settlement";
          return "Ердийн";
        },
        cellClass: (params) =>
          params.data?.rowAction || params.data?.settleInvoiceId || params.data?.ewalletSettlement
            ? "text-xs font-medium text-[var(--ea-primary)]"
            : "text-xs text-[var(--ea-text-3)]",
      },
      {
        // Харьцах тал (орлогод CR, зарлагад DR) — банкны тал нь сонгосон данс
        // тул тогтмол; DR/CR баганыг баганын тохиргооноос л нээнэ.
        headerName: "Харьцах данс",
        colId: "counterAccountCode",
        width: 260,
        editable: (params) => !params.data?.ewalletSettlement,
        singleClickEdit: true,
        valueGetter: (params) =>
          params.data
            ? params.data.income > 0
              ? params.data.creditAccountNumber
              : params.data.debitAccountNumber
            : "",
        // DR/CR баганатай ижил — мөрийн чиглэлийн талбарыг шууд бичнэ (handler state-д буулгана).
        valueSetter: (params) => {
          if (!params.data) return false;
          const value = String(params.newValue ?? "");
          if (params.data.income > 0) params.data.creditAccountNumber = value;
          else params.data.debitAccountNumber = value;
          return true;
        },
        cellClass: (params) =>
          isCompleteAccountCode(String(params.value ?? ""), activeSegIds, segmentOptions)
            ? "font-mono text-xs"
            : "font-mono text-xs bg-[var(--ea-danger-bg)] text-[var(--ea-danger)]",
        valueFormatter: (params) => fmtAccountDisplay(String(params.value ?? ""), activeSegIds),
        cellEditor: AccountSegmentEditor,
        cellEditorParams: {
          activeSegIds,
          segOptions: segmentOptions,
          extraDefaults: defaultSegments,
        },
      },
      {
        headerName: "DR данс",
        field: "debitAccountNumber",
        width: 260,
        hide: true,
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
        hide: true,
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
        // Санал ба шалгалт НЭГ баганад: хэрэглээгүй санал байвал санал +
        // «Ашиглах», эс бөгөөс мөрийн төлөв (Бэлэн / Данс дутуу / Харилцагч дутуу).
        headerName: "Санал / төлөв",
        colId: "suggestion",
        width: 280,
        valueGetter: (params) => validationText(params.data),
        cellRenderer: (
          params: ICellRendererParams<ParsedBankStatementRow>
        ) => {
          const row = params.data;
          if (!row) return null;
          const top = allSuggestions[row.id]?.[0];
          const targetCode = top ? suggestionCode(top) : "";
          const applied = top ? suggestionApplied(row, top, targetCode) : true;
          if (!top || applied) {
            const status = validationText(row);
            return (
              <span className="flex h-full items-center">
                <StatusBadge
                  tone={status === "Бэлэн" ? "success" : "danger"}
                  size="sm"
                  icon={status === "Бэлэн" ? "success" : "error"}
                >
                  {status}
                </StatusBadge>
              </span>
            );
          }
          const label =
            top.kind === "invoice"
              ? top.documentNo
              : top.kind === "ewallet_settlement"
                ? `${top.methodName} settlement · нийт ${fmtMnt(top.grossAmount)}`
                : top.kind === "rule"
                  ? `${fmtAccountDisplay(targetCode, activeSegIds)} · ${top.ruleName}`
                  : `${fmtAccountDisplay(targetCode, activeSegIds)} · түгээмэл данс`;
          const hint =
            top.kind === "invoice"
              ? `${top.counterpartyName} — үлдэгдэл ${fmtMnt(top.balance)}.${top.staleDays ? ` Төлөх хугацаанаас ${top.staleDays} хоног зөрүүтэй тул «Дунд».` : ""} «Ашиглах» дарвал хадгалах үед энэ нэхэмжлэхтэй ШУУД холбогдож, төлсөн дүн нь шинэчлэгдэнэ.`
              : top.kind === "ewallet_settlement"
                ? `«${top.cashAccountName}» түр дансны ${top.receiptIds.length} орлого (нийт ${fmtMnt(top.grossAmount)}) − шимтгэл ${fmtMnt(top.feeAmount)}${Math.abs(top.expectedFeeAmount - top.feeAmount) > 0.005 ? ` (хувиар ${fmtMnt(top.expectedFeeAmount)})` : ""} = банкинд орсон ${fmtMnt(top.netAmount)}. «Ашиглах» дарвал хадгалахад түр данс → банк шилжүүлэг + шимтгэлийн зарлага үүснэ.`
                : top.kind === "rule"
                  ? `«${top.ruleName}» дүрэм — данс${
                      top.setCounterparty ? ", харилцагч" : ""
                    }${top.setDescription ? ", тайлбар" : ""} бөглөнө.`
                  : `"${top.matchedText}" харилцагчид ${top.count} удаа ашигласан данс`;
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
              {targetCode !== "" ? (
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
    ],
    [
      activeSegIds,
      applySuggestion,
      cashAccount?.currency,
      counterpartyOptions,
      defaultSegments,
      invoiceLabelById,
      bookingOptionsFor,
      segmentOptions,
      suggestionApplied,
      suggestionCode,
      allSuggestions,
      validationText,
    ]
  );

  function applyQuickFilter(value: string) {
    setQuickFilter(value);
    gridRef.current?.api?.setGridOption("quickFilterText", value);
  }

  // Файлаас (parse) эсвэл Голомтын API-аас ирсэн хуулгыг НЭГ хэлбэрээр
  // хүснэгтэд ачаална: банкны тал = сонгосон данс, саналын лавлах фонд.
  function applyParsedStatement(
    result: ParsedBankStatement,
    cashAccount: CashAccountView
  ) {
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
    setActiveRowId(null);
    // Шинэ хуулга ачаалмагц «Хянах» таб руу (өмнө нь түүх нээгдсэн байж болно).
    setView("review");
    // Өмнөх хуулгын chip шүүлт үлдвэл шинэ мөрүүд далдлагдана.
    applyQuickFilter("");
    // Саналын лавлах дата (нээлттэй нэхэмжлэх + түүхэн загвар + П8
    // дүрмүүд) — фонд ачаална; амжилтгүй бол саналгүйгээр үргэлжилнэ.
    void fetch("/api/cash/statements/suggestions")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: (ImportContext & { error?: string }) | null) => {
        if (!data || data.error) return;
        setMatchContext(data);
        applyInvoiceHintsRef.current(data.invoiceAccountHints);
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
  }

  /** Автомат татлагыг хянах хүснэгтэд ачаална — тухайн дансыг сонгоно. */
  function reviewGolomtPull(pull: GolomtPendingPull) {
    setError("");
    startTransition(async () => {
      const opened = await openGolomtPull(pull.id);
      const account = accounts.find((item) => item.id === opened.cashAccountId);
      if (opened.error || !opened.statement || !account) {
        setError(opened.error ?? "Татлагын банкны данс идэвхгүй эсвэл олдсонгүй");
        feedback.error();
        return;
      }
      setCashAccountId(account.id);
      setMatchContext(null);
      applyParsedStatement(opened.statement, account);
      feedback.saved(
        `Голомтоос ${opened.statement.rows.length} гүйлгээ ачааллаа${opened.skipped ? ` (${opened.skipped} өмнө импортлогдсон тул алгасав)` : ""} — данс оноогоод хадгална уу`
      );
    });
  }

  function dismissPull(pull: GolomtPendingPull) {
    setError("");
    startTransition(async () => {
      const result = await dismissGolomtPull(pull.id);
      if (result.error) {
        setError(result.error);
        feedback.error();
        return;
      }
      router.refresh();
    });
  }

  function loadGolomtStatement(result: ParsedBankStatement, skipped: number) {
    if (!cashAccount) return;
    setError("");
    setMatchContext(null);
    applyParsedStatement(result, cashAccount);
    feedback.saved(
      `Голомтоос ${result.rows.length} гүйлгээ татлаа${skipped ? ` (${skipped} өмнө импортлогдсон тул алгасав)` : ""} — данс оноогоод хадгална уу`
    );
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

        applyParsedStatement(result, cashAccount);
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
    setRows((current) =>
      current.map((row) => {
        if (!ids.has(row.id)) return row;
        // Харьцах талын данс өөрчлөгдвөл нэхэмжлэхийн холбоос цуцлагдана;
        // банкны талын оноолт settlement-д нөлөөгүй.
        const counterSide = row.income > 0 ? "credit" : "debit";
        const target = side === "counter" ? counterSide : side;
        const field =
          target === "debit" ? "debitAccountNumber" : "creditAccountNumber";
        return {
          ...row,
          [field]: code,
          ...(target === counterSide ? counterSideReset(row) : {}),
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
                ...counterSideReset(row),
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

  // ── Хадгалаагүй хуулгын ноорог (docs/dev/arap.md §5l) ─────────────────────
  // Хуудаснаас гарахад данс оноолт, харилцагч, бүртгэлийн сонголт алга
  // болохгүй: засвар бүрээс 1.5 сек-ийн дараа сервер дээр хадгална, хуудсанд
  // буцаж ороход сэргээнэ. GL-д юу ч бичихгүй; «Хадгалах» / «Хаях»-аар устна.
  // Сэргээсэн ноорогт саналын лавлах (харилцагч, нэхэмжлэх, урьдчилгааны
  // данс) ачаална — мөрүүд аль хэдийн засварлагдсан тул авто дүрэм дахин хэрэглэхгүй.
  useEffect(() => {
    if (!initialDraft) return;
    void fetch("/api/cash/statements/suggestions")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: (ImportContext & { error?: string }) | null) => {
        if (!data || data.error) return;
        setMatchContext(data);
        applyInvoiceHintsRef.current(data.invoiceAccountHints);
      })
      .catch(() => {});
    feedback.saved(
      `Хадгалаагүй хуулга сэргээгдлээ — ${initialDraft.statement.fileName} (${initialDraft.rows.length} мөр)`
    );
  }, [initialDraft]);

  useEffect(() => {
    if (!parsed || rows.length === 0 || !cashAccountId) return;
    const timer = setTimeout(() => {
      void fetch("/api/cash/statements/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashAccountId, statement: { ...parsed, rows: [] }, rows }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [parsed, rows, cashAccountId]);

  function discardDraft() {
    void fetch("/api/cash/statements/draft", { method: "DELETE" }).catch(() => {});
  }

  async function discardStatement() {
    const ok = await confirm({
      title: "Хуулгыг хаях уу?",
      description:
        "Хадгалаагүй хуулга, түүн дээрх данс оноолт, харилцагч, бүртгэлийн сонголт устна. GL-д юу ч бичигдээгүй тул өөр нөлөөгүй.",
      confirmText: "Хаях",
      danger: true,
    });
    if (!ok) return;
    setParsed(null);
    setRows([]);
    setSelectedCount(0);
    setActiveRowId(null);
    discardDraft();
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
        setActiveRowId(null);
        discardDraft();
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

  // Хоёр горим: хуулга хянаж байх үед зөвхөн хүснэгт (түүх — тусдаа таб),
  // үгүй бол импортын хэсэг + автомат татлага + импортын түүх.
  const reviewing = rows.length > 0 && !!parsed;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col items-start justify-between gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 lg:flex-1">
            <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
              Дансны хуулга импорт
            </h1>
            <p className="mt-1 text-xs text-[var(--ea-text-3)]">
              CSV/XLSX хуулгыг (эсвэл Голомтоос шууд татаж) шалгаад, DR/CR
              данс оноосны дараа GL-д бичнэ.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto lg:shrink-0">
            {/* .ea-form-select нь width:100% — өргөнийг wrapper тогтооно. */}
            <div className="w-full sm:w-64 sm:shrink-0">
              <select
                value={cashAccountId}
                onChange={(event) => {
                  const next = event.target.value;
                  const switchAccount = () => {
                    setCashAccountId(next);
                    setParsed(null);
                    setRows([]);
                    discardDraft();
                  };
                  // Хадгалаагүй хуулгатай үед данс солих нь түүнийг хаяна — асууна.
                  if (rows.length === 0) return switchAccount();
                  void confirm({
                    title: "Данс солих уу?",
                    description:
                      "Хянаж буй хуулга хадгалагдаагүй байна. Данс солибол хуулга, түүн дээрх сонголтууд устна.",
                    confirmText: "Солих",
                    danger: true,
                  }).then((ok) => {
                    if (ok) switchAccount();
                  });
                }}
                className="ea-form-select"
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
            </div>
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
            {/* Өдөр бүр хэрэглэх ГАНЦ үйлдэл — эх сурвалжаа цэснээс сонгоно. */}
            <Dropdown
              open={importMenuOpen}
              onOpenChange={setImportMenuOpen}
              panelClassName="w-64"
              trigger={
                <Button
                  onClick={() => setImportMenuOpen((open) => !open)}
                  disabled={!cashAccountId || isPending}
                  aria-haspopup="menu"
                  aria-expanded={importMenuOpen}
                  title={!cashAccountId ? "Эхлээд банкны данс сонгоно уу" : undefined}
                >
                  <Icon name="upload" />
                  Хуулга оруулах
                  <Icon name="chevronDown" size="sm" />
                </Button>
              }
            >
              <DropdownItem
                onSelect={() => {
                  setImportMenuOpen(false);
                  fileRef.current?.click();
                }}
              >
                <Icon name="spreadsheet" size="sm" className="text-[var(--ea-text-3)]" />
                Файлаас (XLSX / CSV)
              </DropdownItem>
              {golomtConnection?.isEnabled && (
                <DropdownItem
                  disabled={!cashAccount || !isGolomtCashAccount(cashAccount)}
                  onSelect={() => {
                    setImportMenuOpen(false);
                    setGolomtFetchOpen(true);
                  }}
                >
                  <Icon name="bank" size="sm" className="text-[var(--ea-text-3)]" />
                  Голомтоос татах
                  {cashAccount && !isGolomtCashAccount(cashAccount) && (
                    <span className="ml-auto text-[10px] text-[var(--ea-text-4)]">Голомтын данс биш</span>
                  )}
                </DropdownItem>
              )}
            </Dropdown>
            {/* Нэг удаа тохируулах зүйлс — ⚙ цэсэнд. */}
            <Dropdown
              open={settingsMenuOpen}
              onOpenChange={setSettingsMenuOpen}
              trigger={
                <IconAction
                  name="settings"
                  label="Хуулгын тохиргоо"
                  variant="outline"
                  aria-haspopup="menu"
                  aria-expanded={settingsMenuOpen}
                  onClick={() => setSettingsMenuOpen((open) => !open)}
                />
              }
            >
              <DropdownItem
                onSelect={() => {
                  setSettingsMenuOpen(false);
                  setRuleDraft(null);
                  setRulesOpen(true);
                }}
              >
                <Icon name="settings" size="sm" className="text-[var(--ea-text-3)]" />
                Дүрэм{rules?.length ? ` (${rules.length})` : ""}
              </DropdownItem>
              {golomt?.canManage && (
                <DropdownItem
                  onSelect={() => {
                    setSettingsMenuOpen(false);
                    setGolomtSettingsOpen(true);
                  }}
                >
                  <Icon name="key" size="sm" className="text-[var(--ea-text-3)]" />
                  Голомт API
                </DropdownItem>
              )}
              {golomt?.canManage && (
                <DropdownItem
                  disabled={isPending}
                  onSelect={() => {
                    setSettingsMenuOpen(false);
                    startTransition(async () => {
                      const result = await getAdvanceSettings();
                      if (result.error || !result.settings) {
                        setError(result.error ?? "Урьдчилгааны тохиргоог уншиж чадсангүй");
                        return;
                      }
                      setAdvanceSettings(result.settings);
                    });
                  }}
                >
                  <Icon name="settings" size="sm" className="text-[var(--ea-text-3)]" />
                  Урьдчилгааны данс
                </DropdownItem>
              )}
              <DropdownSeparator />
              <DropdownLabel>Жишээ файл</DropdownLabel>
              {[
                { href: "/examples/golomt-bank-statement-sample.xlsx", label: "Жишээ XLSX" },
                { href: "/examples/golomt-bank-statement-sample.csv", label: "Жишээ CSV" },
              ].map((sample) => (
                <DropdownItem
                  key={sample.href}
                  onSelect={() => {
                    setSettingsMenuOpen(false);
                    const link = document.createElement("a");
                    link.href = sample.href;
                    link.download = "";
                    link.click();
                  }}
                >
                  <Icon name="download" size="sm" className="text-[var(--ea-text-3)]" />
                  {sample.label}
                </DropdownItem>
              ))}
            </Dropdown>
          </div>
        </div>

        {error && (
          <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
            {error}
          </p>
        )}

        {/* Автомат татлага — нэг мөрт chip, жагсаалт нь цэсэнд (хянаагүй үед л). */}
        {!reviewing && (golomt?.pendingPulls.length ?? 0) > 0 && (
          <div className="flex">
            <Dropdown
              open={pullsMenuOpen}
              onOpenChange={setPullsMenuOpen}
              panelClassName="left-0 right-auto w-96"
              trigger={
                <button
                  type="button"
                  onClick={() => setPullsMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={pullsMenuOpen}
                >
                  <StatusBadge tone="warning" size="sm" icon="bank">
                    Голомтоос {golomt?.pendingPulls.length} хуулга хүлээгдэж байна
                    <Icon name="chevronDown" size="sm" />
                  </StatusBadge>
                </button>
              }
            >
              <DropdownLabel>Хянагдаагүй — GL-д бичигдээгүй</DropdownLabel>
              {golomt?.pendingPulls.map((pull) => (
                <div key={pull.id} className="flex items-center gap-1">
                  <DropdownItem
                    disabled={isPending}
                    onSelect={() => {
                      setPullsMenuOpen(false);
                      reviewGolomtPull(pull);
                    }}
                    className="min-w-0 flex-1"
                  >
                    <Icon name="search" size="sm" className="text-[var(--ea-text-3)]" />
                    <span className="truncate">
                      {pull.cashAccountName} ·{" "}
                      {pull.startDate === pull.endDate
                        ? pull.startDate
                        : `${pull.startDate} – ${pull.endDate}`}
                    </span>
                    <span className="ml-auto shrink-0 text-[var(--ea-text-3)]">
                      {pull.newRows} гүйлгээ
                    </span>
                  </DropdownItem>
                  <IconAction
                    name="close"
                    label="Хэрэгсэхгүй"
                    size="sm"
                    disabled={isPending}
                    onClick={() => dismissPull(pull)}
                  />
                </div>
              ))}
            </Dropdown>
          </div>
        )}
      </section>

      {reviewing && (
        <PageTabs
          tabs={[
            { value: "review", label: `Хянах (${rows.length})` },
            { value: "history", label: "Импортын түүх" },
          ]}
          value={view}
          onChange={setView}
          ariaLabel="Банкны хуулга"
        />
      )}

      {reviewing && parsed && view === "review" && (
        <section className="flex min-h-0 flex-1 flex-col gap-3">
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
            <Button
              variant="outline"
              onClick={() => openAssignment("counter")}
              title="Сонгосон / шүүгдсэн мөрүүдийн харьцах данс (орлогод CR, зарлагад DR) — банкны тал хөндөгдөхгүй"
            >
              <Icon name="filter" />
              Данс оноох
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
              title="Бичилт харах — сонгосон (эсвэл бүх) мөр хадгалагдахад үүсэх журнал"
              aria-label="Бичилтийн урьдчилсан харагдац"
              onClick={openPreview}
            >
              <Icon name="journal" />
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
            rowData={rows}
            columnDefs={columnDefs}
            getRowId={(params) => params.data.id}
            height="flex"
            showSelectionCheckboxes
            pagination
            paginationPageSize={100}
            paginationPageSizeSelector={[50, 100, 250, 500]}
            onSelectionChanged={(event) =>
              setSelectedCount(event.api.getSelectedRows().length)
            }
            onCellValueChanged={handleCellValueChanged}
            onCellFocused={(event) => {
              if (event.rowIndex == null || event.rowPinned) return;
              const id = event.api.getDisplayedRowAtIndex(event.rowIndex)?.data?.id;
              if (id) setActiveRowId(id);
            }}
            singleClickEdit
            stopEditingWhenCellsLoseFocus
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          />

          {activeRow && (
            <BankRowPreviewStrip
              row={activeRow}
              context={previewContext}
              accountName={accountNameOf}
              onClose={() => setActiveRowId(null)}
            />
          )}

          {/* Тогтмол доод мөр — хүснэгт өндрийг дүүргэх тул үргэлж харагдана. */}
          <div className="flex shrink-0 flex-col gap-3 border-t border-[var(--ea-border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="max-w-64 truncate text-[var(--ea-text-3)]" title={parsed.fileName}>
                {parsed.fileName}
              </span>
              <span className="font-mono text-[var(--ea-success-fg)]" title={`Орлого ${fmtMnt(totals.income)}`}>
                +{fmtMntCompact(totals.income)}
              </span>
              <span className="font-mono text-[var(--ea-danger-fg)]" title={`Зарлага ${fmtMnt(totals.expense)}`}>
                −{fmtMntCompact(totals.expense)}
              </span>
              <StatusBadge
                tone={totals.invalid > 0 ? "danger" : "success"}
                size="sm"
                icon={totals.invalid > 0 ? "error" : "success"}
              >
                {totals.invalid > 0 ? `${totals.invalid} мөр дутуу` : "Бүх мөр бэлэн"}
              </StatusBadge>
            </div>
            <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              onClick={() => void discardStatement()}
              disabled={isPending}
              title="Хадгалаагүй хуулгыг хаях (GL-д юу ч бичигдээгүй)"
            >
              <Icon name="delete" />
              Хаях
            </Button>
            <Button
              onClick={saveStatement}
              disabled={isPending || totals.invalid > 0}
            >
              <Icon name="approve" />
              Хуулга хадгалж батлах
            </Button>
            </div>
          </div>
        </section>
      )}

      {statements.length > 0 && (!reviewing || view === "history") && (
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

      <BankRowPreviewDialog
        open={previewRows !== null}
        onOpenChange={(open) => !open && setPreviewRows(null)}
        rows={previewRows ?? []}
        context={previewContext}
        accountName={accountNameOf}
        scopeLabel={
          previewRows && previewRows.length !== rows.length
            ? `Сонгосон ${previewRows.length} мөрийг`
            : `Бүх ${rows.length} мөрийг`
        }
      />

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
              {assignmentSide === "counter"
                ? "Харьцах данс"
                : assignmentSide === "debit"
                  ? "DR данс"
                  : "CR данс"}{" "}
              олноор оноох
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

      {/* Голомт банкны API — docs/dev/bank-api.md (ЗӨВХӨН унших) */}
      {golomt?.canManage && golomtSettingsOpen && (
        <GolomtConnectionDialog
          open={golomtSettingsOpen}
          onOpenChange={setGolomtSettingsOpen}
          connection={golomtConnection}
          defaultRegisterNo={golomt.defaultRegisterNo}
          onChanged={(connection) => {
            setGolomtConnection(connection);
            router.refresh();
          }}
          onChecked={setGolomtConnection}
        />
      )}
      {newCounterparty && counterpartyCreate && (
        <CounterpartyDialog
          open
          onOpenChange={(open) => {
            if (!open) setNewCounterparty(null);
          }}
          title="Харилцагч үүсгэх"
          form={newCounterparty.form}
          setForm={(update) =>
            setNewCounterparty((current) =>
              current
                ? {
                    ...current,
                    form: typeof update === "function" ? update(current.form) : update,
                  }
                : current
            )
          }
          entityKinds={counterpartyCreate.entityKinds}
          activeSegIds={activeSegIds}
          segmentOptions={segmentOptions}
          defaultSegments={defaultSegments}
          isPending={isPending}
          error={newCounterpartyError}
          onSave={saveNewCounterparty}
        />
      )}
      {confirmDialog}
      {(() => {
        const pickerRow = invoicePicker ? rows.find((row) => row.id === invoicePicker) : undefined;
        if (!pickerRow) return null;
        // Нэг нэхэмжлэхийг хэд хэдэн мөрөөр хааж болно — бусад мөрийн дүнг
        // үлдэгдлээс хасч харуулна (хадгалахад сервер дахин шалгана).
        const linkedElsewhere = new Map<string, number>();
        for (const row of rows) {
          if (row.id === pickerRow.id || !row.settleInvoiceId) continue;
          linkedElsewhere.set(
            row.settleInvoiceId,
            (linkedElsewhere.get(row.settleInvoiceId) ?? 0) + (row.income || row.expense)
          );
        }
        return (
          <InvoicePickerDialog
            row={pickerRow}
            invoices={invoicesForRow(pickerRow)}
            linkedElsewhere={linkedElsewhere}
            onSelect={(invoiceId) => applyBookingEdit(pickerRow.id, "settleInvoiceId", invoiceId)}
            onClose={() => setInvoicePicker(null)}
          />
        );
      })()}
      {advanceSettings && (
        <AdvanceSettingsDialog
          open
          onOpenChange={(open) => {
            if (!open) setAdvanceSettings(null);
          }}
          settings={advanceSettings}
          activeSegIds={activeSegIds}
          segmentOptions={segmentOptions}
          defaultSegments={defaultSegments}
          onSaved={(settings) =>
            setMatchContext((current) => (current ? { ...current, advanceSettings: settings } : current))
          }
        />
      )}
      {golomtFetchOpen && cashAccount && (
        <GolomtFetchDialog
          open={golomtFetchOpen}
          onOpenChange={setGolomtFetchOpen}
          cashAccountId={cashAccount.id}
          cashAccountLabel={`${cashAccount.name} · ${cashAccount.accountNumber ?? ""}`}
          onFetched={loadGolomtStatement}
        />
      )}
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

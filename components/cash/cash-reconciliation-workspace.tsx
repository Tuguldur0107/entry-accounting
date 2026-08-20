"use client";

import {
  useCallback,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import type {
  CellValueChangedEvent,
  ColDef,
  ICellRendererParams,
} from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { clickableAmountCell } from "@/components/datagrid/clickable-amount";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createCashOpeningVoucher,
  postCashDocument,
  postCashFxRevaluation,
  reverseCashFxRevaluation,
} from "@/lib/actions/cash";
import { openCashDocPanel, openVoucherPanel } from "@/lib/store/panel-store";
import {
  rateForBasis,
  type ExchangeRateBasis,
  type ExchangeRateQuote,
} from "@/lib/cash/exchange-rates";
import { calculateFxRevaluation } from "@/lib/cash/reconciliation";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type CashReconciliationRow = {
  id: string;
  isActive: boolean;
  accountName: string;
  accountType: string;
  currency: string;
  glAccountNumber: string;
  cashBalance: number;
  bankBalance: number | null;
  bankBalanceDate: string | null;
  closingRate: number | null;
  cashBalanceMnt: number | null;
  glBalance: number;
  bankToCashDifference: number | null;
  cashToGlDifference: number | null;
  /** Модульд бүртгэлтэй нээлтийн үлдэгдэл — GL-д дутуу бол зөрүүний шалтгаан. */
  openingBalance: number;
  /** Тоон дээр дарахад гарах задаргаа — эх сурвалж тус бүрийн мөрүүд. */
  details: {
    /** Кассын бүртгэл: нээлт + батлагдсан баримт бүр (дансны валютаар). */
    cash: { id: string; date: string; label: string; amount: number }[];
    /** GL: энэ дансны дугаарт нөлөөлсөн журнал бүрийн цэвэр дүн (MNT). */
    gl: { id: string; date: string; label: string; amount: number }[];
    /** Банкны хуулга бүрийн сүүлийн үлдэгдэл мөр. */
    bank: { id: string; date: string; label: string; amount: number }[];
  };
  /** Дансанд хамаатай НООРОГ баримтууд — зөрүүний оношилгоонд. */
  pendingDrafts: {
    id: string;
    documentNo: string;
    date: string;
    documentType: string;
    baseAmount: number;
    /** GL журналаас үүссэн (журнал нь GL-д аль хэдийн бичигдсэн). */
    fromGl: boolean;
    /** Валютын ханш тодорхойгүй — батлахын өмнө ханш оруулна. */
    rateUnknown: boolean;
    /** Батлагдвал энэ дансны бүртгэлд орох чиглэлтэй дүн (+ орлого, − зарлага). */
    effect: number;
  }[];
  rateSource: string | null;
  rateBasis: string | null;
  sourceDate: string | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
  status:
    | "balanced"
    | "exception"
    | "missing-rate"
    | "no-statement"
    | "stale-statement";
};

export type CashFxHistoryRow = {
  id: string;
  cashAccountId: string;
  revision: number;
  valuationDate: string;
  accountName: string;
  currency: string;
  closingRate: number;
  rateSource: string;
  rateBasis: string;
  sourceDate: string | null;
  foreignBalance: number;
  carryingAmount: number;
  revaluedAmount: number;
  adjustmentAmount: number;
  gainLossAccountNumber: string;
  voucherId: string;
  status: string;
};

type RateEvidence = {
  source: "mongolbank" | "tdb" | "golomt";
  basis: ExchangeRateBasis;
  sourceDate: string;
  sourceUrl: string;
  fetchedAt: string | null;
};

type FxInputRow = CashReconciliationRow & {
  inputRate: number | null;
  rateEvidence: RateEvidence | null;
};

const STATUS_LABELS = {
  balanced: "Тэнцсэн",
  exception: "Зөрүүтэй",
  "missing-rate": "Ханш дутуу",
  "no-statement": "Хуулга дутуу",
  "stale-statement": "Хуулга хуучирсан",
} as const;

const RATE_SOURCE_LABELS: Record<string, string> = {
  mongolbank: "Монголбанк",
  tdb: "Худалдаа, хөгжлийн банк",
  golomt: "Голомт банк",
  manual: "Гараар оруулсан",
};

const RATE_BASIS_LABELS: Record<string, string> = {
  official: "Албан ханш",
  mid: "Бэлэн бус дундаж",
  buy: "Банкны авах",
  sell: "Банкны зарах",
};

const RATE_BASIS_OPTIONS: Array<{
  value: ExchangeRateBasis;
  label: string;
}> = [
  { value: "official", label: "Албан ханш" },
  { value: "mid", label: "Бэлэн бус дундаж" },
  { value: "buy", label: "Банкны авах" },
  { value: "sell", label: "Банкны зарах" },
];

function numberOrBlank(value: number | null) {
  return value == null ? "" : fmtMnt(value);
}

export function CashReconciliationWorkspace({
  asOf,
  rows,
  history,
  fxAccountOptions,
}: {
  asOf: string;
  rows: CashReconciliationRow[];
  history: CashFxHistoryRow[];
  fxAccountOptions: Array<{ number: string; name: string }>;
}) {
  const router = useRouter();
  const [date, setDate] = useState(asOf);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  // Тоон дээр дарахад гарах задаргааны dialog.
  const [detail, setDetail] = useState<{
    row: CashReconciliationRow;
    measure: "bank" | "cash" | "gl" | "bankToCash" | "cashToGl";
  } | null>(null);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [rateBasis, setRateBasis] =
    useState<ExchangeRateBasis>("official");
  const [rateQuotes, setRateQuotes] = useState<ExchangeRateQuote[]>([]);
  const [rateErrors, setRateErrors] = useState<string[]>([]);
  const [rateFetchError, setRateFetchError] = useState("");
  const [postingTarget, setPostingTarget] = useState<FxInputRow | null>(null);
  const [manualReason, setManualReason] = useState("");
  const [gainAccountNumber, setGainAccountNumber] = useState(
    fxAccountOptions.some((account) => account.number === "51800001")
      ? "51800001"
      : ""
  );
  const [lossAccountNumber, setLossAccountNumber] = useState(
    fxAccountOptions.some((account) => account.number === "87000003")
      ? "87000003"
      : ""
  );
  const [fxRows, setFxRows] = useState<FxInputRow[]>(
    rows
      .filter((row) => row.isActive && row.currency !== "MNT")
      .map((row) => ({
        ...row,
        inputRate: row.closingRate,
        rateEvidence:
          row.rateSource &&
          row.rateSource !== "manual" &&
          row.sourceDate &&
          row.sourceUrl
            ? {
                source: row.rateSource as RateEvidence["source"],
                basis: (row.rateBasis ?? "official") as ExchangeRateBasis,
                sourceDate: row.sourceDate,
                sourceUrl: row.sourceUrl,
                fetchedAt: row.fetchedAt,
              }
            : null,
      }))
  );

  const summary = useMemo(
    () => ({
      balanced: rows.filter((row) => row.status === "balanced").length,
      exception: rows.filter((row) => row.status === "exception").length,
      missingRate: rows.filter((row) => row.status === "missing-rate").length,
      noStatement: rows.filter(
        (row) =>
          row.status === "no-statement" || row.status === "stale-statement"
      ).length,
    }),
    [rows]
  );

  // Зөрүүтэй данс бүрийн ОНОШИЛГОО — «Бүртгэл − GL» дүн дээр дарахад гарах
  // задаргааны dialog-т шалтгаан бүрийг дүнтэй нь, засах товчтой нь үзүүлнэ.
  const fixCards = useMemo(
    () =>
      rows
        .map((row) => {
          const diff = row.cashToGlDifference ?? 0;
          if (Math.abs(diff) <= 0.01) return null;

          // Шалтгаан 1: нээлтийн үлдэгдэл GL-д бичигдээгүй.
          const openingMissing =
            Math.abs(row.openingBalance) > 0.005 &&
            Math.abs(diff - row.openingBalance) <= 0.01;

          // Шалтгаан 2: GL-ээс үүссэн ноорог — журнал нь GL-д бичигдсэн ч
          // кассын бүртгэлд ноорог хэвээр. Батлагдвал зөрүү арилна.
          const glDrafts = row.pendingDrafts.filter((doc) => doc.fromGl);
          const glDraftsEffect = glDrafts.reduce((sum, doc) => sum + doc.effect, 0);

          // Тайлбарлагдаагүй үлдэгдэл зөрүү.
          const residual =
            Math.round(
              (diff - (openingMissing ? row.openingBalance : 0) + glDraftsEffect) * 100
            ) / 100;

          return {
            row,
            diff,
            openingMissing,
            glDrafts,
            plainDrafts: row.pendingDrafts.filter((doc) => !doc.fromGl),
            residual,
          };
        })
        .filter((card): card is NonNullable<typeof card> => card !== null),
    [rows]
  );

  function handlePostPendingDoc(doc: CashReconciliationRow["pendingDrafts"][number]) {
    void confirm({
      title: "Баримт батлах",
      description: `${doc.documentNo} (${doc.date}, ${fmtMnt(doc.baseAmount)}) ноорог баримтыг батлах уу?${doc.fromGl ? " Журнал нь GL-д аль хэдийн бичигдсэн тул шинэ журнал үүсэхгүй — зөвхөн кассын бүртгэлд орно." : " Батлагдахад GL журнал үүснэ."}`,
      confirmText: "Батлах",
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          const result = await postCashDocument(doc.id);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(`${doc.documentNo} батлагдлаа`);
          router.refresh();
        } catch {
          toast.error("Батлах амжилтгүй");
        }
      });
    });
  }

  function handleCreateOpeningVoucher(row: CashReconciliationRow) {
    void confirm({
      title: "Нээлтийн журнал үүсгэх",
      description: `${row.accountName} дансны нээлтийн үлдэгдэл ${fmtMnt(row.openingBalance)}-г GL-д бичих НООРОГ журнал (харьцах данс: эздийн өмч) үүсгэх үү? Баталмагц тулгалтын зөрүү арилна.`,
      confirmText: "Үүсгэх",
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          await createCashOpeningVoucher({ cashAccountId: row.id });
          toast.success(
            "Нээлтийн ноорог журнал үүслээ — GL журналын жагсаалтаас шалгаж батална уу"
          );
          router.refresh();
        } catch (caught) {
          toast.error(
            caught instanceof Error ? caught.message : "Үүсгэж чадсангүй"
          );
        }
      });
    });
  }

  const adjustment = useCallback((row: FxInputRow | undefined) => {
    if (!row?.inputRate) return null;
    return calculateFxRevaluation(row.cashBalance, row.inputRate, row.glBalance);
  }, []);

  const fxSummary = useMemo(() => {
    let missingRate = 0;
    let noAdjustment = 0;
    let readyToPost = 0;

    for (const row of fxRows) {
      const result = adjustment(row);
      if (!row.inputRate) missingRate += 1;
      else if (Math.abs(result?.adjustmentAmount ?? 0) <= 0.01) noAdjustment += 1;
      else readyToPost += 1;
    }

    return {
      total: fxRows.length,
      missingRate,
      noAdjustment,
      readyToPost,
    };
  }, [fxRows, adjustment]);

  const fxPostBlockReason = useCallback(
    (row: FxInputRow) => {
      if (!row.inputRate) return "Эхлээд хаалтын ханш оруулна";
      const result = adjustment(row);
      if (Math.abs(result?.adjustmentAmount ?? 0) <= 0.01)
        return "Тэгшитгэлийн дүн 0 тул GL бичилт шаардлагагүй";
      return "";
    },
    [adjustment]
  );

  // Дүнгийн нүдийг ДАРДАГ болгоно — задаргааны dialog нээнэ. Нэгдсэн
  // clickableAmountCell renderer (ҮХ-ийн GL тулгалттай ижил).
  const clickableAmount = useCallback(
    (
      measure: "bank" | "cash" | "gl" | "bankToCash" | "cashToGl",
      format: (value: number) => string
    ) =>
      clickableAmountCell<CashReconciliationRow>(
        (row) => setDetail({ row, measure }),
        format
      ),
    []
  );

  const reconciliationColumns = useMemo<ColDef<CashReconciliationRow>[]>(
    () => [
      {
        headerName: "Данс",
        field: "accountName",
        minWidth: 210,
        flex: 1,
        pinned: "left",
      },
      { headerName: "Валют", field: "currency", width: 86 },
      {
        headerName: "Банкны хуулга",
        headerTooltip: "Импортолсон банкны хуулгын хаалтын үлдэгдэл (Дансны хуулга хэсгээс)",
        field: "bankBalance",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        cellRenderer: clickableAmount("bank", (v) => numberOrBlank(v)),
      },
      {
        headerName: "Хуулгын огноо",
        headerTooltip: "Хуулгын хамгийн сүүлийн нотлох огноо",
        field: "bankBalanceDate",
        width: 120,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Кассын бүртгэл",
        headerTooltip: "Нээлтийн үлдэгдэл + батлагдсан орлого − зарлага (дансны валютаар)",
        field: "cashBalance",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        cellRenderer: clickableAmount("cash", (v) => fmtMnt(v)),
      },
      {
        headerName: "Хаалтын ханш",
        headerTooltip: "Валютын дансыг MNT руу хөрвүүлэх сүүлд баталсан ханш",
        field: "closingRate",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.value == null
            ? ""
            : Number(params.value).toLocaleString("mn-MN", {
                maximumFractionDigits: 8,
              }),
      },
      {
        headerName: "Кассын бүртгэл (MNT)",
        headerTooltip: "Кассын бүртгэл × хаалтын ханш",
        field: "cashBalanceMnt",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        cellRenderer: clickableAmount("cash", (v) => numberOrBlank(v)),
      },
      {
        headerName: "GL журнал (MNT)",
        headerTooltip: "Батлагдсан журналын мөрүүдийн нийлбэр — энэ дансны GL дугаараар",
        field: "glBalance",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        cellRenderer: clickableAmount("gl", (v) => fmtMnt(v)),
      },
      {
        headerName: "Хуулга − Бүртгэл",
        headerTooltip:
          "0 биш бол: хуулга дутуу импортлогдсон эсвэл кассын баримт дутуу бүртгэгдсэн",
        field: "bankToCashDifference",
        width: 150,
        cellClass: (params) =>
          cn(
            "ag-right-aligned-cell font-mono",
            params.value != null &&
              Math.abs(Number(params.value)) > 0.01 &&
              "font-semibold text-[var(--ea-danger)]"
          ),
        headerClass: "ag-right-aligned-header",
        cellRenderer: clickableAmount("bankToCash", (v) => numberOrBlank(v)),
      },
      {
        headerName: "Бүртгэл − GL",
        headerTooltip: "0 биш бол дүн дээр дарж шалтгааны задаргааг харна",
        field: "cashToGlDifference",
        width: 150,
        cellClass: (params) =>
          cn(
            "ag-right-aligned-cell font-mono",
            params.value != null &&
              Math.abs(Number(params.value)) > 0.01 &&
              "font-semibold text-[var(--ea-danger)]"
          ),
        headerClass: "ag-right-aligned-header",
        cellRenderer: clickableAmount("cashToGl", (v) => numberOrBlank(v)),
      },
      {
        headerName: "Статус",
        field: "status",
        width: 132,
        pinned: "right",
        valueGetter: (params) =>
          STATUS_LABELS[params.data?.status ?? "exception"],
        cellRenderer: (params: ICellRendererParams<CashReconciliationRow>) => {
          const status = params.data?.status ?? "exception";
          return (
            <span
              className={cn(
                "text-xs font-medium",
                status === "balanced" && "text-[var(--ea-success)]",
                status === "exception" && "text-[var(--ea-danger)]",
                (status === "missing-rate" ||
                  status === "no-statement" ||
                  status === "stale-statement") &&
                  "text-[var(--ea-warning)]"
              )}
            >
              {STATUS_LABELS[status]}
            </span>
          );
        },
      },
    ],
    [clickableAmount]
  );

  const postFx = useCallback(
    (row: FxInputRow) => {
      if (!row.inputRate) {
        setError(`${row.accountName}: хаалтын ханш оруулна уу`);
        return;
      }
      setError("");
      setManualReason("");
      setPostingTarget(row);
    },
    []
  );

  function submitFxPosting() {
    if (!postingTarget?.inputRate) return;
    if (!gainAccountNumber || !lossAccountNumber) {
      setError("Ханшийн олз, гарзын дансыг сонгоно уу");
      return;
    }
    if (!postingTarget.rateEvidence && manualReason.trim().length < 5) {
      setError("Гараар оруулсан ханшийн шалтгааныг бичнэ үү");
      return;
    }
    const evidence = postingTarget.rateEvidence;
    const replacesExisting = history.some(
      (item) =>
        item.cashAccountId === postingTarget.id &&
        item.valuationDate === asOf &&
        item.status === "posted"
    );
    setError("");
    startTransition(async () => {
      try {
        const result = await postCashFxRevaluation({
          cashAccountId: postingTarget.id,
          valuationDate: asOf,
          closingRate: postingTarget.inputRate!,
          rateSource: evidence?.source ?? "manual",
          rateBasis: evidence?.basis ?? "official",
          sourceDate: evidence?.sourceDate ?? null,
          sourceUrl: evidence?.sourceUrl ?? null,
          fetchedAt: evidence?.fetchedAt ?? null,
          manualOverrideReason: evidence ? null : manualReason,
          gainAccountNumber,
          lossAccountNumber,
          replaceExisting: replacesExisting,
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        setPostingTarget(null);
        router.refresh();
        toast.success("Ханшийн тэгшитгэл GL-д бичигдлээ");
      } catch {
        setError("Ханшийн тэгшитгэл бичиж чадсангүй");
      }
    });
  }

  const reverseFx = useCallback(
    async (row: CashFxHistoryRow) => {
      const ok = await confirm({
        title: "Ханшийн тэгшитгэлийн буцаалт",
        description: `${row.accountName} дансны тэгшитгэлийг буцаалтын журналаар буцаах уу?`,
        confirmText: "Буцаалт хийх",
        danger: true,
      });
      if (!ok) return;
      setError("");
      startTransition(async () => {
        try {
          const result = await reverseCashFxRevaluation(row.id);
          if (result.error) {
            setError(result.error);
            toast.error(result.error);
            return;
          }
          router.refresh();
          toast.success("Тэгшитгэл буцаагдлаа");
        } catch {
          const message = "Тэгшитгэлийг буцаалт хийж чадсангүй";
          setError(message);
          toast.error(message);
        }
      });
    },
    [router, confirm]
  );

  const fxColumns = useMemo<ColDef<FxInputRow>[]>(
    () => [
      { headerName: "Валютын данс", field: "accountName", minWidth: 220, flex: 1 },
      { headerName: "Валют", field: "currency", width: 84 },
      {
        headerName: "Үлдэгдэл",
        field: "cashBalance",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Өмнөх ханш",
        field: "closingRate",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "Шинэ ханш",
        field: "inputRate",
        width: 140,
        editable: true,
        singleClickEdit: true,
        cellClass:
          "ag-right-aligned-cell font-mono bg-[var(--ea-primary-50)]",
        headerClass: "ag-right-aligned-header",
        valueParser: (params) => {
          const value = Number(params.newValue);
          return Number.isFinite(value) && value > 0 ? value : null;
        },
      },
      {
        headerName: "Шинэ MNT үнэлгээ",
        colId: "revaluedAmount",
        width: 170,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueGetter: (params) => adjustment(params.data)?.revaluedAmount ?? null,
        valueFormatter: (params) =>
          numberOrBlank(params.value == null ? null : Number(params.value)),
      },
      {
        headerName: "Олз / (гарз)",
        colId: "adjustment",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        valueGetter: (params) =>
          adjustment(params.data)?.adjustmentAmount ?? null,
        valueFormatter: (params) =>
          numberOrBlank(params.value == null ? null : Number(params.value)),
      },
      {
        headerName: "Үйлдэл",
        colId: "action",
        width: 170,
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<FxInputRow>) => {
          const row = params.data;
          if (!row) return null;
          const blockReason = fxPostBlockReason(row);
          return (
            <button
              type="button"
              className="ea-btn ea-btn--sm ea-btn--primary"
              disabled={isPending || !!blockReason}
              title={blockReason || "Тэгшитгэлийн GL бичилтийг хянах"}
              onClick={() => postFx(row)}
            >
              {blockReason ? "Хүлээгдэж байна" : "GL-д бичих"}
            </button>
          );
        },
      },
    ],
    [adjustment, fxPostBlockReason, isPending, postFx]
  );

  const historyColumns = useMemo<ColDef<CashFxHistoryRow>[]>(
    () => [
      { headerName: "Огноо", field: "valuationDate", width: 112 },
      { headerName: "Данс", field: "accountName", minWidth: 200, flex: 1 },
      { headerName: "Валют", field: "currency", width: 84 },
      {
        headerName: "Ханш",
        field: "closingRate",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "Эх сурвалж",
        field: "rateSource",
        width: 180,
        valueGetter: (params) =>
          `${RATE_SOURCE_LABELS[params.data?.rateSource ?? ""] ?? ""} · ${
            RATE_BASIS_LABELS[params.data?.rateBasis ?? ""] ?? ""
          }`,
      },
      {
        headerName: "Валютын үлдэгдэл",
        field: "foreignBalance",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Тэгшитгэлийн дүн",
        field: "adjustmentAmount",
        width: 170,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Олз/гарзын данс",
        field: "gainLossAccountNumber",
        width: 150,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 105,
        pinned: "right",
        valueFormatter: (params) =>
          params.value === "posted" ? "Идэвхтэй" : "Буцаагдсан",
      },
      {
        headerName: "",
        colId: "reverse",
        width: 56,
        pinned: "right",
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<CashFxHistoryRow>) =>
          params.data?.status === "posted" ? (
            <button
              type="button"
              className="ea-btn ea-btn--icon ea-btn--warning"
              title="Тэгшитгэлийг буцаалт хийх"
              aria-label="Тэгшитгэлийг буцаалт хийх"
              disabled={isPending}
              onClick={() => params.data && reverseFx(params.data)}
            >
              <Icon name="reset" />
            </button>
          ) : null,
      },
    ],
    [isPending, reverseFx]
  );

  const applyRate = useCallback(
    (quote: ExchangeRateQuote) => {
      const selectedRate = rateForBasis(quote, rateBasis);
      if (selectedRate == null) {
        setRateFetchError(
          `${quote.sourceName}: сонгосон төрлийн ${quote.currency} ханш алга`
        );
        return;
      }
      setFxRows((current) =>
        current.map((row) =>
          row.currency === quote.currency
            ? {
                ...row,
                inputRate: selectedRate,
                rateEvidence: {
                  source: quote.source,
                  basis: rateBasis,
                  sourceDate: quote.date,
                  sourceUrl: quote.sourceUrl,
                  fetchedAt: quote.fetchedAt ?? null,
                },
              }
            : row
        )
      );
      setError("");
      setRatesOpen(false);
    },
    [rateBasis]
  );

  const rateColumns = useMemo<ColDef<ExchangeRateQuote>[]>(
    () => [
      {
        headerName: "Эх сурвалж",
        field: "sourceName",
        minWidth: 190,
        flex: 1,
        cellRenderer: (params: ICellRendererParams<ExchangeRateQuote>) => (
          <a
            href={params.data?.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[var(--ea-primary)] hover:underline"
          >
            {params.value}
            <Icon name="openExternal" size="xs" />
          </a>
        ),
      },
      {
        headerName: "Төрөл",
        field: "sourceType",
        width: 112,
        valueFormatter: (params) =>
          params.value === "central" ? "Төв банк" : "Арилжааны",
      },
      { headerName: "Валют", field: "currency", width: 82 },
      {
        headerName: "Огноо",
        field: "date",
        width: 112,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Албан",
        field: "officialRate",
        width: 122,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          numberOrBlank(params.value == null ? null : Number(params.value)),
      },
      {
        headerName: "Бэлэн бус авах",
        field: "nonCashBuyRate",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          numberOrBlank(params.value == null ? null : Number(params.value)),
      },
      {
        headerName: "Бэлэн бус зарах",
        field: "nonCashSellRate",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          numberOrBlank(params.value == null ? null : Number(params.value)),
      },
      {
        headerName: "Сонгосон ханш",
        colId: "selectedRate",
        width: 142,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        valueGetter: (params) =>
          params.data ? rateForBasis(params.data, rateBasis) : null,
        valueFormatter: (params) =>
          numberOrBlank(params.value == null ? null : Number(params.value)),
      },
      {
        headerName: "",
        colId: "apply",
        width: 104,
        pinned: "right",
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<ExchangeRateQuote>) => (
          <button
            type="button"
            className="ea-btn ea-btn--sm ea-btn--primary"
            disabled={
              !params.data || rateForBasis(params.data, rateBasis) == null
            }
            onClick={() => params.data && applyRate(params.data)}
          >
            Ашиглах
          </button>
        ),
      },
    ],
    [applyRate, rateBasis]
  );

  async function openRateDialog() {
    setRatesOpen(true);
    setRatesLoading(true);
    setRateFetchError("");
    setRateErrors([]);
    setRateQuotes([]);
    try {
      const currencies = [...new Set(fxRows.map((row) => row.currency))];
      let loadedCount = 0;
      await Promise.all(
        (["mongolbank", "tdb", "golomt"] as const).map(async (source) => {
          const query = new URLSearchParams({
            date: asOf,
            currencies: currencies.join(","),
            source,
          });
          try {
            const response = await fetch(`/api/cash/exchange-rates?${query}`);
            const payload = (await response.json()) as {
              quotes?: ExchangeRateQuote[];
              errors?: string[];
              error?: string;
            };
            if (!response.ok)
              throw new Error(payload.error ?? "Ханш татаж чадсангүй");
            const quotes = payload.quotes ?? [];
            loadedCount += quotes.length;
            setRateQuotes((current) => [...current, ...quotes]);
            if (payload.errors?.length)
              setRateErrors((current) => [...current, ...payload.errors!]);
          } catch {
            const label = RATE_SOURCE_LABELS[source] ?? source;
            setRateErrors((current) => [
              ...current,
              `${label}: мэдээлэл татаж чадсангүй`,
            ]);
          }
        })
      );
      if (loadedCount === 0) setRateFetchError("Ханш татаж чадсангүй");
    } catch (caught) {
      setRateFetchError(
        caught instanceof Error ? caught.message : "Ханш татаж чадсангүй"
      );
    } finally {
      setRatesLoading(false);
    }
  }

  function applyDate() {
    router.push(`/cash/reconciliation?asOf=${encodeURIComponent(date)}`);
  }

  return (
    <div className="flex min-h-full w-full min-w-0 max-w-full flex-none flex-col gap-6">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Тулгалт ба ханшийн тэгшитгэл
          </h1>
          <div className="mt-1 text-xs text-[var(--ea-text-3)]">
            Гурван эх сурвалжийг тулгана: Банкны хуулга ↔ Кассын бүртгэл ↔ GL
            журнал. Зөрүү гарвал шалтгаан, засах алхам нь доор автоматаар гарна.
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="min-w-0 flex-1 sm:w-40 sm:flex-none"
            aria-label="Тулгалтын огноо"
          />
          <Button variant="outline" onClick={applyDate}>
            <Icon name="refresh" />
            Шинэчлэх
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 border-y border-[var(--ea-border)] lg:grid-cols-4">
        <Metric label="Тэнцсэн" value={summary.balanced} tone="success" />
        <Metric label="Зөрүүтэй" value={summary.exception} tone="danger" />
        <Metric label="Ханш дутуу" value={summary.missingRate} tone="warning" />
        <Metric
          label="Хуулга асуудалтай"
          value={summary.noStatement}
          tone="muted"
        />
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Icon name="reconciliation" className="text-[var(--ea-primary)]" />
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
            Дансны тулгалт
          </h2>
        </div>
        <div className="hidden xl:block">
          <DataGridDynamic<CashReconciliationRow>
            rowData={rows}
            columnDefs={reconciliationColumns}
            getRowId={(params) => params.data.id}
            height={Math.min(560, 48 + rows.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        </div>
        <div className="divide-y divide-[var(--ea-border)] rounded-md border border-[var(--ea-border)] xl:hidden">
          {rows.map((row) => (
            <div key={row.id} className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--ea-text-1)]">
                    {row.accountName}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--ea-text-3)]">
                    {row.currency} · {row.glAccountNumber}
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-xs font-medium",
                    row.status === "balanced" && "text-[var(--ea-success)]",
                    row.status === "exception" && "text-[var(--ea-danger)]",
                    row.status !== "balanced" &&
                      row.status !== "exception" &&
                      "text-[var(--ea-warning)]"
                  )}
                >
                  {STATUS_LABELS[row.status]}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <MobileAmount
                  label="Банк"
                  value={row.bankBalance}
                  suffix={row.currency}
                />
                <MobileAmount
                  label="Дотоод бүртгэл"
                  value={row.cashBalance}
                  suffix={row.currency}
                />
                <MobileAmount
                  label="Банк–Бүртгэл"
                  value={row.bankToCashDifference}
                />
                <MobileAmount
                  label="Бүртгэл–GL"
                  value={row.cashToGlDifference}
                />
              </div>
              {row.bankBalanceDate && (
                <div className="text-[11px] text-[var(--ea-text-4)]">
                  Хуулгын нотлох огноо: {row.bankBalanceDate}
                </div>
              )}
            </div>
          ))}
        </div>

      </section>

      <section>
        <div className="mb-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Icon name="arrowRight" className="text-[var(--ea-primary)]" />
              <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
                Валютын ханшийн тэгшитгэл
              </h2>
            </div>
            {fxRows.length > 0 && (
              <Button variant="outline" size="sm" onClick={openRateDialog}>
                <Icon name="bank" />
                Ханш татах
              </Button>
            )}
          </div>

          {fxRows.length > 0 && (
            <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)]">
              <div className="grid gap-0 md:grid-cols-[1.3fr_0.7fr_0.7fr_0.7fr]">
                <div className="flex items-center gap-2 border-b border-[var(--ea-border)] px-3 py-2 text-xs text-[var(--ea-text-3)] md:border-b-0 md:border-r">
                  <Icon name="checklist" size="sm" className="shrink-0 text-[var(--ea-primary)]" />
                  <span>
                    Томъёо: <span className="font-mono">валютын үлдэгдэл × шинэ ханш - GL үлдэгдэл = тэгшитгэл</span>
                  </span>
                </div>
                <FxMiniMetric label="Валютын данс" value={fxSummary.total} />
                <FxMiniMetric label="Ханш дутуу" value={fxSummary.missingRate} tone="warning" />
                <FxMiniMetric label="GL-д бичих" value={fxSummary.readyToPost} tone="primary" />
              </div>
            </div>
          )}
        </div>
        {fxRows.length > 0 ? (
          <>
            {fxRows.every((row) => Math.abs(row.cashBalance) < 0.005) && (
              <p className="mb-2 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2 text-xs text-[var(--ea-text-3)]">
                <Icon name="info" size="xs" className="mr-1 inline-block" />
                Бүх валютын дансны үлдэгдэл 0 байна — тэгшитгэх зүйл байхгүй
                тул одоогоор энд хийх үйлдэл алга. Валютын гүйлгээ орж
                үлдэгдэл үүссэн үед (ихэвчлэн сарын эцэст) &quot;Ханш татах&quot;-аар
                хаалтын ханш аваад тэгшитгэлээ GL-д бичнэ.
              </p>
            )}
            <div className="hidden xl:block">
              <DataGridDynamic<FxInputRow>
                rowData={fxRows}
                columnDefs={fxColumns}
                getRowId={(params) => params.data.id}
                height={Math.min(420, 48 + fxRows.length * 38)}
                onCellValueChanged={(
                  event: CellValueChangedEvent<FxInputRow>
                ) =>
                  setFxRows((current) =>
                    current.map((row) =>
                      row.id === event.data.id
                        ? {
                            ...row,
                            inputRate: event.data.inputRate,
                            rateEvidence: null,
                          }
                        : row
                    )
                  )
                }
                singleClickEdit
                stopEditingWhenCellsLoseFocus
                wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              />
            </div>
            <div className="divide-y divide-[var(--ea-border)] rounded-md border border-[var(--ea-border)] xl:hidden">
              {fxRows.map((row) => {
                const result = adjustment(row);
                const blockReason = fxPostBlockReason(row);
                return (
                  <div key={row.id} className="space-y-3 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">
                          {row.accountName}
                        </div>
                        <div className="text-xs text-[var(--ea-text-3)]">
                          {row.currency} · Үлдэгдэл {fmtMnt(row.cashBalance)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={isPending || !!blockReason}
                        title={blockReason || "Тэгшитгэлийн GL бичилтийг хянах"}
                        onClick={() => postFx(row)}
                      >
                        GL-д бичих
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs text-[var(--ea-text-3)]">
                        Шинэ ханш
                        <Input
                          type="number"
                          className="mt-1 h-10 font-mono"
                          value={row.inputRate ?? ""}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setFxRows((current) =>
                              current.map((item) =>
                                item.id === row.id
                                  ? {
                                      ...item,
                                      inputRate:
                                        Number.isFinite(value) && value > 0
                                          ? value
                                          : null,
                                      rateEvidence: null,
                                    }
                                  : item
                              )
                            );
                          }}
                          aria-label={`${row.accountName} шинэ ханш`}
                          placeholder="Ж: 3580.00"
                        />
                      </label>
                      <MobileAmount
                        label="Олз / (гарз)"
                        value={result?.adjustmentAmount ?? null}
                      />
                    </div>
                    <div className="rounded-md bg-[var(--ea-bg-2)] px-3 py-2 text-[11px] text-[var(--ea-text-3)]">
                      {blockReason ||
                        (row.rateEvidence
                          ? `Эх сурвалж: ${
                              RATE_SOURCE_LABELS[row.rateEvidence.source]
                            } · ${RATE_BASIS_LABELS[row.rateEvidence.basis]}`
                          : "Гараар оруулсан ханш бол GL-д бичих үед шалтгаан шаардана")}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex min-h-32 items-center justify-center border-y border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
            Идэвхтэй валютын банкны данс алга
          </div>
        )}
        {error && (
          <p className="mt-2 rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
            {error}
          </p>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Icon name="success" className="text-[var(--ea-success)]" />
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
              Тэгшитгэлийн түүх
            </h2>
          </div>
          <div className="hidden md:block">
            <DataGridDynamic<CashFxHistoryRow>
              rowData={history}
              columnDefs={historyColumns}
              getRowId={(params) => params.data.id}
              height={Math.min(420, 48 + history.length * 38)}
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
            />
          </div>
          <div className="divide-y divide-[var(--ea-border)] rounded-md border border-[var(--ea-border)] md:hidden">
            {history.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {item.accountName}
                  </div>
                  <div className="text-xs text-[var(--ea-text-3)]">
                    {item.valuationDate} · {RATE_SOURCE_LABELS[item.rateSource]}
                  </div>
                  <div className="mt-1 font-mono text-xs">
                    {fmtMnt(item.adjustmentAmount)} MNT
                  </div>
                </div>
                {item.status === "posted" ? (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    aria-label="Тэгшитгэлийг буцаалт хийх"
                    disabled={isPending}
                    onClick={() => reverseFx(item)}
                  >
                    <Icon name="reset" />
                  </Button>
                ) : (
                  <span className="text-xs text-[var(--ea-text-4)]">
                    Буцаалт хийх
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <Dialog open={ratesOpen} onOpenChange={setRatesOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[1100px]">
          <DialogHeader>
            <DialogTitle>Валютын ханшийн мэдээлэл</DialogTitle>
            <DialogDescription>
              {asOf} өдрийн төв банк болон арилжааны банкны ханш
            </DialogDescription>
          </DialogHeader>

          <div
            className="grid grid-cols-2 overflow-hidden rounded-md border border-[var(--ea-border)] md:grid-cols-4"
            role="group"
            aria-label="Тэгшитгэлд хэрэглэх ханш"
          >
            {RATE_BASIS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRateBasis(option.value)}
                className={cn(
                  "min-h-11 border-b border-r border-[var(--ea-border)] px-2 text-xs font-medium md:border-b-0 md:last:border-r-0",
                  rateBasis === option.value
                    ? "bg-[var(--ea-primary)] text-[var(--primary-foreground)]"
                    : "bg-[var(--ea-bg-2)] text-[var(--ea-text-2)] hover:bg-[var(--ea-bg-3)]"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {ratesLoading && rateQuotes.length === 0 ? (
            <div className="flex h-56 items-center justify-center gap-2 text-sm text-[var(--ea-text-3)]">
              <Icon name="loading" size="lg" className="animate-spin" />
              Банкнуудын ханш татаж байна...
            </div>
          ) : rateQuotes.length > 0 ? (
            <>
              {ratesLoading && (
                <div className="flex items-center gap-2 text-xs text-[var(--ea-text-3)]">
                  <Icon name="loading" size="sm" className="animate-spin" />
                  Үлдсэн эх сурвалжийг татаж байна...
                </div>
              )}
              <div className="hidden md:block">
                <DataGridDynamic<ExchangeRateQuote>
                  rowData={rateQuotes}
                  columnDefs={rateColumns}
                  getRowId={(params) => params.data.id}
                  height={Math.min(480, 48 + rateQuotes.length * 38)}
                  wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
                  suppressCellFocus
                />
              </div>
              <div className="divide-y divide-[var(--ea-border)] rounded-md border border-[var(--ea-border)] md:hidden">
                {rateQuotes.map((quote) => {
                  const selectedRate = rateForBasis(quote, rateBasis);
                  return (
                    <div key={quote.id} className="space-y-3 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <a
                            href={quote.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm font-medium text-[var(--ea-primary)]"
                          >
                            {quote.sourceName}
                            <Icon name="openExternal" size="xs" />
                          </a>
                          <div className="text-xs text-[var(--ea-text-3)]">
                            {quote.currency} · {quote.date}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-base font-semibold">
                            {selectedRate == null
                              ? "—"
                              : selectedRate.toLocaleString("mn-MN", {
                                  maximumFractionDigits: 8,
                                })}
                          </div>
                          <div className="text-[11px] text-[var(--ea-text-4)]">
                            {RATE_BASIS_LABELS[rateBasis]}
                          </div>
                        </div>
                      </div>
                      <Button
                        className="min-h-11 w-full"
                        disabled={selectedRate == null}
                        onClick={() => applyRate(quote)}
                      >
                        Энэ ханшийг ашиглах
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex h-40 items-center justify-center border-y border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
              Сонгосон өдрийн ханш олдсонгүй
            </div>
          )}

          {(rateFetchError || rateErrors.length > 0) && (
            <div className="rounded-md bg-[var(--ea-warning-bg)] px-3 py-2 text-xs text-[var(--ea-warning)]">
              {rateFetchError ||
                `Зарим эх сурвалж шинэчлэгдсэнгүй: ${rateErrors.join("; ")}`}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={postingTarget != null}
        onOpenChange={(open) => !open && setPostingTarget(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>GL бичилтийг хянах</DialogTitle>
            <DialogDescription>
              {postingTarget?.accountName} · {asOf}
            </DialogDescription>
          </DialogHeader>

          {postingTarget &&
            (() => {
              const result = adjustment(postingTarget);
              if (!result) return null;
              const isGain = result.adjustmentAmount > 0;
              const amount = Math.abs(result.adjustmentAmount);
              const replacesExisting = history.some(
                (item) =>
                  item.cashAccountId === postingTarget.id &&
                  item.valuationDate === asOf &&
                  item.status === "posted"
              );
              return (
                <div className="space-y-4">
                  {replacesExisting && (
                    <div className="rounded-md bg-[var(--ea-warning-bg)] px-3 py-2 text-xs text-[var(--ea-warning)]">
                      Энэ өдрийн өмнөх тэгшитгэлийг буцаалт хийж шинэ
                      хувилбараар солино.
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-[var(--ea-border)] p-3 text-xs">
                    <ReviewValue
                      label="Валютын үлдэгдэл"
                      value={`${fmtMnt(postingTarget.cashBalance)} ${postingTarget.currency}`}
                    />
                    <ReviewValue
                      label="Хаалтын ханш"
                      value={postingTarget.inputRate!.toLocaleString("mn-MN", {
                        maximumFractionDigits: 8,
                      })}
                    />
                    <ReviewValue
                      label="GL үлдэгдэл"
                      value={`${fmtMnt(postingTarget.glBalance)} MNT`}
                    />
                    <ReviewValue
                      label="Шинэ үнэлгээ"
                      value={`${fmtMnt(result.revaluedAmount)} MNT`}
                    />
                    <ReviewValue
                      label="Тэгшитгэлийн дүн"
                      value={`${fmtMnt(result.adjustmentAmount)} MNT`}
                    />
                    <ReviewValue
                      label="Эх сурвалж"
                      value={
                        postingTarget.rateEvidence
                          ? `${
                              RATE_SOURCE_LABELS[
                                postingTarget.rateEvidence.source
                              ]
                            } · ${
                              RATE_BASIS_LABELS[
                                postingTarget.rateEvidence.basis
                              ]
                            } · ${postingTarget.rateEvidence.sourceDate}`
                          : "Гараар оруулсан"
                      }
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-xs text-[var(--ea-text-3)]">
                      Ханшийн олзын данс
                      <select
                        className="ea-form-select mt-1"
                        value={gainAccountNumber}
                        onChange={(event) =>
                          setGainAccountNumber(event.target.value)
                        }
                      >
                        <option value="">Сонгох...</option>
                        {fxAccountOptions
                          .filter((account) => account.number.startsWith("5"))
                          .map((account) => (
                          <option key={account.number} value={account.number}>
                            {account.number} · {account.name}
                          </option>
                          ))}
                      </select>
                    </label>
                    <label className="text-xs text-[var(--ea-text-3)]">
                      Ханшийн гарзын данс
                      <select
                        className="ea-form-select mt-1"
                        value={lossAccountNumber}
                        onChange={(event) =>
                          setLossAccountNumber(event.target.value)
                        }
                      >
                        <option value="">Сонгох...</option>
                        {fxAccountOptions
                          .filter((account) => account.number.startsWith("8"))
                          .map((account) => (
                          <option key={account.number} value={account.number}>
                            {account.number} · {account.name}
                          </option>
                          ))}
                      </select>
                    </label>
                  </div>

                  {!postingTarget.rateEvidence && (
                    <label className="text-xs text-[var(--ea-text-3)]">
                      Гараар оруулсан ханшийн шалтгаан
                      <Input
                        className="mt-1"
                        value={manualReason}
                        onChange={(event) => setManualReason(event.target.value)}
                        placeholder="Баримт, эх сурвалжийн тайлбар"
                      />
                    </label>
                  )}

                  <div className="rounded-md border border-[var(--ea-border)]">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-[var(--ea-border)] px-3 py-2 text-[11px] text-[var(--ea-text-3)]">
                      <span>Данс</span>
                      <span>Дебет</span>
                      <span>Кредит</span>
                    </div>
                    <JournalPreviewLine
                      account={
                        isGain
                          ? postingTarget.glAccountNumber
                          : lossAccountNumber
                      }
                      debit={amount}
                      credit={0}
                    />
                    <JournalPreviewLine
                      account={
                        isGain
                          ? gainAccountNumber
                          : postingTarget.glAccountNumber
                      }
                      debit={0}
                      credit={amount}
                    />
                  </div>
                </div>
              );
            })()}

          {error && (
            <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPostingTarget(null)}
              disabled={isPending}
            >
              Болих
            </Button>
            <Button
              onClick={submitFxPosting}
              disabled={
                isPending ||
                Math.abs(adjustment(postingTarget ?? undefined)?.adjustmentAmount ?? 0) <=
                  0.01
              }
            >
              GL-д бичих
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Тоон дээр дарахад гарах задаргаа ─────────────────────────────── */}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          {detail && (() => {
            const { row, measure } = detail;
            const card = fixCards.find((c) => c.row.id === row.id) ?? null;
            const config = {
              bank: {
                title: "Банкны хуулга — задаргаа",
                note: `Импортолсон хуулга бүрийн ${asOf}-с өмнөх сүүлийн үлдэгдэл мөр · ${row.currency}`,
                lines: row.details.bank,
                total: row.bankBalance,
                onOpen: null as ((id: string, label: string) => void) | null,
              },
              cash: {
                title: "Кассын бүртгэл — задаргаа",
                note: `Нээлтийн үлдэгдэл + батлагдсан баримтууд · ${row.currency}`,
                lines: row.details.cash,
                total: row.cashBalance,
                onOpen: (id: string, label: string) =>
                  id.startsWith("opening-") ? undefined : openCashDocPanel(id, label),
              },
              gl: {
                title: "GL журнал — задаргаа",
                note: `${row.glAccountNumber} дансанд нөлөөлсөн батлагдсан журналууд · MNT`,
                lines: row.details.gl,
                total: row.glBalance,
                onOpen: (id: string, label: string) => openVoucherPanel(id, label),
              },
              bankToCash: {
                title: "Хуулга − Бүртгэл зөрүү",
                note: "Хоёр талын задаргааг тулгаж, аль баримт дутууг олно",
                lines: [
                  ...row.details.bank.map((l) => ({ ...l, label: `[Хуулга] ${l.label}` })),
                  ...row.details.cash.map((l) => ({ ...l, label: `[Бүртгэл] ${l.label}` })),
                ],
                total: row.bankToCashDifference,
                onOpen: (id: string, label: string) =>
                  id.startsWith("opening-") || row.details.bank.some((l) => l.id === id)
                    ? undefined
                    : openCashDocPanel(id, label),
              },
              cashToGl: {
                title: "Бүртгэл − GL зөрүү — оношилгоо",
                note: "Шалтгаан бүрийг дүнтэй нь задалж, зассан алхмыг санал болгоно",
                lines: [] as { id: string; date: string; label: string; amount: number }[],
                total: row.cashToGlDifference,
                onOpen: null,
              },
            }[measure];

            return (
              <>
                <DialogHeader>
                  <DialogTitle>{row.accountName}</DialogTitle>
                  <DialogDescription>
                    {config.title} · {config.note}
                  </DialogDescription>
                </DialogHeader>

                {measure === "cashToGl" ? (
                  /* Оношилгоо — өмнө нь «Зөрүүг арилгах» хэсэгт байсан агуулга */
                  <div className="space-y-2.5">
                    <div className="font-mono text-xs text-[var(--ea-text-3)]">
                      Кассын бүртгэл {fmtMnt(row.cashBalanceMnt ?? row.cashBalance)} · GL{" "}
                      {fmtMnt(row.glBalance)} · зөрүү{" "}
                      <span className="font-semibold text-[var(--ea-danger-fg)]">
                        {fmtMnt(row.cashToGlDifference ?? 0)}
                      </span>
                    </div>

                    {!card && (
                      <p className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs text-[var(--ea-text-2)]">
                        Зөрүү 0.01-с бага тул оношлох зүйл алга.
                      </p>
                    )}

                    {card?.openingMissing && (
                      <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2">
                        <span className="min-w-0 flex-1 text-xs text-[var(--ea-text-2)]">
                          <span className="font-medium text-[var(--ea-text-1)]">
                            Нээлтийн үлдэгдэл GL-д бичигдээгүй.
                          </span>{" "}
                          Данс үүсгэхэд нээлтийн {fmtMnt(row.openingBalance)} зөвхөн кассын
                          бүртгэлд орсон. Товч дармагц данс ↔ эздийн өмчийн НООРОГ журнал
                          үүснэ — баталмагц зөрүү арилна.
                        </span>
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleCreateOpeningVoucher(row)}
                        >
                          Нээлтийн журнал үүсгэх
                        </Button>
                      </div>
                    )}

                    {card && card.glDrafts.length > 0 && (
                      <div className="space-y-1.5 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2">
                        <p className="text-xs text-[var(--ea-text-2)]">
                          <span className="font-medium text-[var(--ea-text-1)]">
                            GL-ээс үүссэн ноорог баримт ({card.glDrafts.length}).
                          </span>{" "}
                          Журнал нь GL-д бичигдсэн ч кассын бүртгэлд ноорог хэвээр —
                          баталмагц зөрүү арилна (шинэ журнал үүсэхгүй).
                        </p>
                        {card.glDrafts.map((doc) => (
                          <div key={doc.id} className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openCashDocPanel(doc.id, doc.documentNo)}
                              className="font-mono text-xs text-[var(--ea-primary)] hover:underline"
                            >
                              {doc.documentNo}
                            </button>
                            <span className="font-mono text-xs text-[var(--ea-text-3)]">
                              {doc.date} · {fmtMnt(doc.effect)}
                            </span>
                            {doc.rateUnknown ? (
                              <span className="text-[11px] text-[var(--ea-warning-fg)]">
                                ханш оруулж батална — нээгээд засна уу
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isPending}
                                onClick={() => handlePostPendingDoc(doc)}
                              >
                                Батлах
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {card && Math.abs(card.residual) > 0.01 && (
                      <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2 text-xs text-[var(--ea-text-2)]">
                        <span className="font-medium text-[var(--ea-text-1)]">
                          Тайлбарлагдаагүй зөрүү {fmtMnt(card.residual)}.
                        </span>{" "}
                        GL-д гараар бичсэн журнал эсвэл кассын бүртгэлээс дутуу баримт байж
                        болзошгүй — доорх GL болон Кассын задаргааг тулгаж шалгана уу. AI
                        туслахаас &quot;{row.accountName} дансны зөрүүг оношлоод өг&quot; гэж
                        асууж болно.
                      </div>
                    )}

                    {card && card.plainDrafts.length > 0 && (
                      <p className="text-[11px] text-[var(--ea-text-4)]">
                        Мөн батлагдаагүй {card.plainDrafts.length} энгийн ноорог баримт бий —{" "}
                        {card.plainDrafts.map((doc) => doc.documentNo).join(", ")}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="max-h-[55vh] overflow-y-auto rounded-md border border-[var(--ea-border)]">
                    {config.lines.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-[var(--ea-text-4)]">
                        Мөр байхгүй.
                      </p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-[var(--ea-bg-2)]">
                          <tr className="text-[var(--ea-text-2)]">
                            <th className="px-3 py-2 text-left font-semibold">Огноо</th>
                            <th className="px-3 py-2 text-left font-semibold">Баримт</th>
                            <th className="px-3 py-2 text-right font-semibold">Дүн</th>
                          </tr>
                        </thead>
                        <tbody>
                          {config.lines.map((line) => {
                            const openable = config.onOpen && !line.id.startsWith("opening-");
                            return (
                              <tr
                                key={`${measure}-${line.id}`}
                                className="border-t border-[var(--ea-border)]"
                              >
                                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[var(--ea-text-3)]">
                                  {line.date || "—"}
                                </td>
                                <td className="max-w-0 px-3 py-1.5">
                                  {openable ? (
                                    <button
                                      type="button"
                                      onClick={() => config.onOpen!(line.id, line.label)}
                                      className="block w-full truncate text-left text-[var(--ea-primary)] hover:underline"
                                      title={line.label}
                                    >
                                      {line.label}
                                    </button>
                                  ) : (
                                    <span className="block truncate text-[var(--ea-text-1)]" title={line.label}>
                                      {line.label}
                                    </span>
                                  )}
                                </td>
                                <td
                                  className={cn(
                                    "whitespace-nowrap px-3 py-1.5 text-right font-mono",
                                    line.amount < 0
                                      ? "text-[var(--ea-danger-fg)]"
                                      : "text-[var(--ea-text-1)]"
                                  )}
                                >
                                  {fmtMnt(line.amount)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        {config.total != null && (
                          <tfoot>
                            <tr className="border-t border-[var(--ea-border)] bg-[var(--ea-bg-2)] font-semibold">
                              <td className="px-3 py-2" colSpan={2}>
                                Нийт
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
                                {fmtMnt(config.total)}
                              </td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "warning" | "muted";
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-r border-[var(--ea-border)] px-4 py-4 last:border-r-0 lg:border-b-0">
      <Icon
        name={tone === "success" ? "success" : "error"}
        size="lg"
        className={cn(
          tone === "success" && "text-[var(--ea-success)]",
          tone === "danger" && "text-[var(--ea-danger)]",
          tone === "warning" && "text-[var(--ea-warning)]",
          tone === "muted" && "text-[var(--ea-text-4)]"
        )}
      />
      <div>
        <div className="text-[11px] text-[var(--ea-text-3)]">{label}</div>
        <div className="font-mono text-lg font-semibold text-[var(--ea-text-1)]">
          {value}
        </div>
      </div>
    </div>
  );
}

function FxMiniMetric({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "muted" | "warning" | "primary";
}) {
  return (
    <div className="border-b border-r border-[var(--ea-border)] px-3 py-2 last:border-r-0 md:border-b-0">
      <div className="text-[11px] text-[var(--ea-text-3)]">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-mono text-base font-semibold",
          tone === "primary" && "text-[var(--ea-primary)]",
          tone === "warning" && "text-[var(--ea-warning-fg)]",
          tone === "muted" && "text-[var(--ea-text-1)]"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function MobileAmount({
  label,
  value,
  suffix = "MNT",
}: {
  label: string;
  value: number | null;
  suffix?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[var(--ea-text-4)]">{label}</div>
      <div className="truncate font-mono text-xs font-medium text-[var(--ea-text-1)]">
        {value == null ? "—" : `${fmtMnt(value)} ${suffix}`}
      </div>
    </div>
  );
}

function ReviewValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[var(--ea-text-4)]">{label}</div>
      <div className="mt-0.5 break-words font-medium text-[var(--ea-text-1)]">
        {value}
      </div>
    </div>
  );
}

function JournalPreviewLine({
  account,
  debit,
  credit,
}: {
  account: string;
  debit: number;
  credit: number;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 font-mono text-xs">
      <span>{account || "Данс сонгоогүй"}</span>
      <span className="min-w-24 text-right">
        {debit > 0 ? fmtMnt(debit) : ""}
      </span>
      <span className="min-w-24 text-right">
        {credit > 0 ? fmtMnt(credit) : ""}
      </span>
    </div>
  );
}

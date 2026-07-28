"use client";

// Бараа материалын ӨРТГИЙН ХЯНАЛТЫН ТАЙЛАН.
// docs/cost 03-report-specifications §2 — баганын шатлал нь ТОГТМОЛ бөгөөд
// дахин зохиогдохгүй:
//
//   # | Барааны код | Барааны нэр | C1[Тоо|Нэгж өртөг|Дүн]
//     | Орлого[…] | Зарлага[…] | C2[…]
//
// "Тоо / Нэгж өртөг / Дүн" нь ЖИНХЭНЭ хоёрдугаар түвшний толгойнууд
// (AG Grid colGroup children) — нэг нүдэнд шахагдсан текст БИШ (§2.2, AC-006).
//
// §2.8: тоо хэмжээ, дүнг нийтэлнэ; НЭГЖ ӨРТГИЙН баганыг нийтлэхгүй
// (утгагүй дүн болно).

import { useMemo, useState } from "react";
import type { ColDef, ColGroupDef } from "ag-grid-community";
import { AlertTriangle, Calculator, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import {
  computeMonthlyCosting,
  recalculatePeriodicCosting,
} from "@/lib/actions/costing-period";
import { fmtMnt } from "@/lib/reports/balances";
import { fmtPeriodCode } from "@/lib/periods/period";
import { cn } from "@/lib/utils";

export type CostControlRow = {
  id: string;
  rowNo: number;
  itemCode: string;
  itemName: string;
  warehouseLabel: string;
  openingQty: number;
  openingUnitCost: number | null;
  openingAmount: number;
  inboundQty: number;
  inboundUnitCost: number | null;
  inboundAmount: number;
  outboundQty: number;
  /** Outbound ба C2-ын ХУВААЛЦСАН дундаж (FR-COST-001). */
  averageUnitCost: number | null;
  outboundAmount: number | null;
  closingQty: number;
  closingAmount: number | null;
  qtyBalanced: boolean;
  amountBalanced: boolean;
  status: string;
  blockReason: string | null;
};

interface Props {
  periodCode: string;
  periodOptions: string[];
  rows: CostControlRow[];
  /** Тухайн период хаагдсан эсэх — дахин тооцоолол хийх боломжид нөлөөлнө. */
  periodClosed: boolean;
  calculatedAt: string | null;
}

const QTY = {
  width: 108,
  cellClass: "ag-right-aligned-cell font-mono text-xs",
  headerClass: "ag-right-aligned-header",
  valueFormatter: (params: { value: unknown }) =>
    params.value == null
      ? ""
      : Number(params.value).toLocaleString("en-US", {
          maximumFractionDigits: 4,
        }),
} satisfies Partial<ColDef<CostControlRow>>;

const UNIT = {
  width: 126,
  cellClass: "ag-right-aligned-cell font-mono text-xs",
  headerClass: "ag-right-aligned-header",
  // Нэгж өртгийг 4 орноор харуулна; хадгалалт нь бүтэн нарийвчлалтай.
  valueFormatter: (params: { value: unknown }) =>
    params.value == null
      ? "—"
      : Number(params.value).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        }),
} satisfies Partial<ColDef<CostControlRow>>;

const AMOUNT = {
  width: 140,
  cellClass: "ag-right-aligned-cell font-mono",
  headerClass: "ag-right-aligned-header",
  valueFormatter: (params: { value: unknown }) =>
    params.value == null ? "—" : fmtMnt(Number(params.value)),
} satisfies Partial<ColDef<CostControlRow>>;

export function CostControlReport({
  periodCode,
  periodOptions,
  rows,
  periodClosed,
  calculatedAt,
}: Props) {
  const router = useRouter();
  const [recalculating, setRecalculating] = useState(false);
  const [valuing, setValuing] = useState(false);
  const [blockers, setBlockers] = useState<
    { label: string; reason: string }[] | null
  >(null);

  const columnDefs = useMemo<(ColDef<CostControlRow> | ColGroupDef<CostControlRow>)[]>(
    () => [
      {
        headerName: "#",
        field: "rowNo",
        width: 62,
        pinned: "left",
        cellClass: "font-mono text-xs text-[var(--ea-text-4)]",
      },
      {
        headerName: "Барааны код",
        field: "itemCode",
        width: 140,
        pinned: "left",
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Барааны нэр",
        field: "itemName",
        minWidth: 200,
        flex: 1,
        pinned: "left",
      },
      {
        headerName: "Агуулах",
        field: "warehouseLabel",
        width: 150,
        cellClass: "text-xs",
      },
      {
        headerName: "C1 (эхний үлдэгдэл)",
        children: [
          { headerName: "Тоо", field: "openingQty", ...QTY },
          { headerName: "Нэгж өртөг", field: "openingUnitCost", ...UNIT },
          { headerName: "Дүн", field: "openingAmount", ...AMOUNT },
        ],
      },
      {
        headerName: "Орлого",
        children: [
          { headerName: "Тоо", field: "inboundQty", ...QTY },
          { headerName: "Нэгж өртөг", field: "inboundUnitCost", ...UNIT },
          { headerName: "Дүн", field: "inboundAmount", ...AMOUNT },
        ],
      },
      {
        headerName: "Зарлага",
        children: [
          { headerName: "Тоо", field: "outboundQty", ...QTY },
          // Зарлагын нэгж өртөг = периодын жигнэсэн дундаж (C2-тэй ижил).
          { headerName: "Нэгж өртөг", field: "averageUnitCost", ...UNIT },
          { headerName: "Дүн", field: "outboundAmount", ...AMOUNT },
        ],
      },
      {
        headerName: "C2 (эцсийн үлдэгдэл)",
        children: [
          { headerName: "Тоо", field: "closingQty", ...QTY },
          // FR-COST-001: Outbound-тай ЯГ ижил дундаж.
          {
            headerName: "Нэгж өртөг",
            field: "averageUnitCost",
            colId: "closingUnitCost",
            ...UNIT,
          },
          {
            headerName: "Дүн",
            field: "closingAmount",
            ...AMOUNT,
            cellClass: "ag-right-aligned-cell font-mono font-semibold",
          },
        ],
      },
      {
        headerName: "Хяналт",
        width: 130,
        colId: "control",
        valueGetter: (params) => {
          const row = params.data;
          if (!row) return "";
          if (row.status !== "calculated") return "Тооцоологдоогүй";
          if (!row.qtyBalanced) return "Тоо тэнцэхгүй";
          if (!row.amountBalanced) return "Дүн тэнцэхгүй";
          return "Тэнцсэн";
        },
        cellClass: (params) =>
          cn(
            "text-xs",
            params.data?.status === "calculated" &&
              params.data.qtyBalanced &&
              params.data.amountBalanced
              ? "text-[var(--ea-success)]"
              : "text-[var(--ea-danger)] font-medium"
          ),
        tooltipValueGetter: (params) => params.data?.blockReason ?? "",
      },
    ],
    []
  );

  // §2.8 — тоо хэмжээ, дүнг нийтэлнэ. Нэгж өртгийн багана НИЙЛБЭРГҮЙ.
  const totals = useMemo(() => {
    const sum = (pick: (row: CostControlRow) => number | null) =>
      rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
    return {
      openingQty: sum((row) => row.openingQty),
      openingAmount: sum((row) => row.openingAmount),
      inboundQty: sum((row) => row.inboundQty),
      inboundAmount: sum((row) => row.inboundAmount),
      outboundQty: sum((row) => row.outboundQty),
      outboundAmount: sum((row) => row.outboundAmount),
      closingQty: sum((row) => row.closingQty),
      closingAmount: sum((row) => row.closingAmount),
    };
  }, [rows]);

  const pinnedBottom = useMemo<CostControlRow[]>(
    () => [
      {
        id: "__total__",
        rowNo: 0,
        itemCode: "",
        itemName: "Нийт",
        warehouseLabel: "",
        openingQty: totals.openingQty,
        openingUnitCost: null,
        openingAmount: totals.openingAmount,
        inboundQty: totals.inboundQty,
        inboundUnitCost: null,
        inboundAmount: totals.inboundAmount,
        outboundQty: totals.outboundQty,
        averageUnitCost: null,
        outboundAmount: totals.outboundAmount,
        closingQty: totals.closingQty,
        closingAmount: totals.closingAmount,
        qtyBalanced: true,
        amountBalanced: true,
        status: "calculated",
        blockReason: null,
      },
    ],
    [totals]
  );

  const blockedCount = rows.filter((row) => row.status !== "calculated").length;
  const unbalancedCount = rows.filter(
    (row) => row.status === "calculated" && (!row.qtyBalanced || !row.amountBalanced)
  ).length;

  function changePeriod(next: string) {
    const params = new URLSearchParams(window.location.search);
    params.set("period", next);
    router.replace(`${window.location.pathname}?${params.toString()}`);
  }

  function recalculate() {
    setRecalculating(true);
    void recalculatePeriodicCosting().then((result) => {
      setRecalculating(false);
      if (!result.ok) {
        toast.error(result.message ?? "Тооцоолол амжилтгүй");
        return;
      }
      toast.success(
        `${result.calculated} мөр тооцоологдлоо` +
          (result.blocked > 0 ? `, ${result.blocked} мөр тооцоологдоогүй` : "")
      );
      router.refresh();
    });
  }

  function valueMonth() {
    setValuing(true);
    setBlockers(null);
    void computeMonthlyCosting(periodCode).then((result) => {
      setValuing(false);
      if (!result.ok) {
        toast.error(result.message ?? "Тооцоолол амжилтгүй");
        return;
      }
      if (result.blockers.length > 0) {
        setBlockers(result.blockers);
        toast.error(
          `${result.blockers.length} бараа-агуулах тооцоологдохгүй байна — бичилт үүсгэсэнгүй`
        );
        return;
      }
      const parts = [`${result.valued} бичилт үнэлэгдлээ`];
      if (result.alreadyValued > 0)
        parts.push(`${result.alreadyValued} нь GL-д бичигдсэн тул хөндөгдсөнгүй`);
      if (result.zeroValued > 0) parts.push(`${result.zeroValued} нь 0 дүнтэй`);
      toast.success(parts.join(" · "));
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Өртгийн хяналтын тайлан
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Хугацааны жигнэсэн дундаж · бараа × агуулах · Зарлага нь сарын
            өртөг тооцоход л үнэлэгдэнэ (зөрүү үүсэхгүй)
            {calculatedAt ? ` · тооцоолсон: ${calculatedAt}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-xs text-[var(--ea-text-1)]"
            value={periodCode}
            onChange={(event) => changePeriod(event.target.value)}
          >
            {periodOptions.length === 0 && (
              <option value={periodCode}>{fmtPeriodCode(periodCode)}</option>
            )}
            {periodOptions.map((code) => (
              <option key={code} value={code}>
                {fmtPeriodCode(code)}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={recalculate}
            disabled={recalculating || valuing}
          >
            <RefreshCw size={13} className={cn(recalculating && "animate-spin")} />
            Дахин тооцоолох
          </Button>
          <Button
            size="sm"
            onClick={valueMonth}
            disabled={valuing || recalculating || periodClosed}
            title={
              periodClosed
                ? "Хаагдсан сарын өртгийг дахин тооцохгүй"
                : "Зарлага, тохируулга, буцаалтыг сарын дундажаар үнэлж ноорог бичилт үүсгэнэ"
            }
          >
            <Calculator size={13} />
            Сарын өртөг тооцох
          </Button>
        </div>
      </div>

      {periodClosed && (
        <p className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs text-[var(--ea-text-3)]">
          Энэ период ХААГДСАН — үр дүн нь хаалтын үеийн байдлаар харагдана.
        </p>
      )}

      {(blockedCount > 0 || unbalancedCount > 0) && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--ea-danger)]/40 bg-[var(--ea-danger)]/8 px-3 py-2 text-xs text-[var(--ea-danger)]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            {blockedCount > 0 && (
              <p>
                {blockedCount} мөр тооцоологдоогүй — нэгж өртөг зохиогдохгүй тул
                дүн хоосон харагдана. Шалтгааныг &quot;Хяналт&quot; багана дээр
                хулганаа аваачиж харна уу.
              </p>
            )}
            {unbalancedCount > 0 && (
              <p>{unbalancedCount} мөрд тоо/дүнгийн тэнцэл алдагдсан байна.</p>
            )}
          </div>
        </div>
      )}

      {blockers && blockers.length > 0 && (
        <div className="rounded-md border border-[var(--ea-danger)]/40 bg-[var(--ea-danger)]/8 px-3 py-2 text-xs text-[var(--ea-danger)]">
          <p className="mb-1 font-medium">
            Дараах бараа-агуулахын өртөг тодорхойлогдохгүй тул НЭГ Ч бичилт
            үүсгэсэнгүй:
          </p>
          <ul className="space-y-0.5">
            {blockers.slice(0, 12).map((entry) => (
              <li key={entry.label}>
                • {entry.label} — {entry.reason}
              </li>
            ))}
            {blockers.length > 12 && <li>… бусад {blockers.length - 12}</li>}
          </ul>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          {periodCode} периодод өртгийн үр дүн алга — &quot;Дахин
          тооцоолох&quot; товчийг дарна уу
        </div>
      ) : (
        <DataGridDynamic<CostControlRow>
          rowData={rows}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          pinnedBottomRowData={pinnedBottom}
          suppressCellFocus
        />
      )}
    </div>
  );
}

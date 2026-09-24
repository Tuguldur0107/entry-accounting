"use client";

import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { ColDef } from "ag-grid-community";

import {
  DataGridDynamic,
  type DataGridHandle,
} from "@/components/datagrid/DataGridDynamic";
import {
  ReportEmpty,
  ReportHeader,
  ReportPage,
  ReportToolbar,
  reportRangeLabel,
} from "@/components/reports/report-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageTabs } from "@/components/ui/tabs";
import { fmtMnt } from "@/lib/reports/balances";
import type {
  CashDetailRow,
  CashFlowCodeRow,
  CashMovementRow,
} from "@/lib/cash/balances";

type CashReportView = "accounts" | "flow" | "detail";

const VIEW_TABS: { value: CashReportView; label: string }[] = [
  { value: "accounts", label: "Дансаар" },
  { value: "flow", label: "Мөнгөн урсгалын ангилал (S8)" },
  { value: "detail", label: "Дэлгэрэнгүй" },
];

const VIEW_HINTS: Record<CashReportView, string> = {
  accounts: "данс тус бүрийн орлого, зарлага, үлдэгдэл",
  flow: "орлого, зарлага мөнгөн урсгалын кодоор · MNT дүнгээр · дотоод шилжүүлэг ороогүй",
  detail:
    "эхний үлдэгдэл, баримтын мөр бүрийн орлого/зарлага, ханш, MNT дүн, гүйлгээний дараах үлдэгдэл",
};

interface Props {
  rows: CashMovementRow[];
  detailRows: CashDetailRow[];
  /** S8 мөнгөн урсгалын кодоор нэгтгэсэн мөрүүд (сервер талд бодогдсон). */
  flowRows: CashFlowCodeRow[];
  /** S8 код → нэр (дэлгэрэнгүй тайлангийн баганад). */
  cashFlowNames: Record<string, string>;
  periodStart: string;
  periodEnd: string;
}

function moneyCol<T>(): Partial<ColDef<T>> {
  return {
    cellClass: "ag-right-aligned-cell font-mono tabular-nums",
    headerClass: "ag-right-aligned-header",
    width: 150,
    valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
  };
}

const TYPE_LABELS: Record<string, string> = {
  opening: "Эхний үлдэгдэл",
  receipt: "Орлого",
  payment: "Зарлага",
  transfer: "Шилжүүлэг",
};

// Per-account cash movement statement for the selected period:
//   Эхний үлдэгдэл + Орлого − Зарлага = Эцсийн үлдэгдэл
// Multi-currency accounts are shown with their currency so totals aren't
// blindly summed across currencies — the footer totals MNT rows only.
export function CashReportView({
  rows,
  detailRows,
  flowRows,
  cashFlowNames,
  periodStart,
  periodEnd,
}: Props) {
  const detailGridRef = useRef<DataGridHandle>(null);
  const [quickFilter, setQuickFilter] = useState("");
  // Нэг тайлангийн 3 зүсэлт — огноо нь ЗӨВХӨН топбарын периодоос.
  const [view, setView] = useState<CashReportView>("accounts");

  const movementColumnDefs = useMemo<ColDef<CashMovementRow>[]>(
    () => [
      { headerName: "Данс", field: "accountName", flex: 1, minWidth: 200 },
      { headerName: "Валют", field: "currency", width: 90 },
      { headerName: "Эхний үлдэгдэл", field: "opening", ...moneyCol<CashMovementRow>() },
      {
        headerName: "Орлого",
        field: "receipts",
        ...moneyCol<CashMovementRow>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums text-[var(--ea-success-fg)]",
      },
      {
        headerName: "Зарлага",
        field: "payments",
        ...moneyCol<CashMovementRow>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums text-[var(--ea-danger-fg)]",
      },
      {
        headerName: "Эцсийн үлдэгдэл",
        field: "closing",
        ...moneyCol<CashMovementRow>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums font-semibold",
      },
    ],
    []
  );

  const detailColumnDefs = useMemo<ColDef<CashDetailRow>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "date",
        width: 112,
        pinned: "left",
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Данс",
        field: "accountName",
        minWidth: 190,
        pinned: "left",
      },
      {
        headerName: "Төрөл",
        field: "documentType",
        width: 130,
        valueGetter: (params) =>
          TYPE_LABELS[params.data?.documentType ?? ""] ??
          params.data?.documentType ??
          "",
      },
      {
        headerName: "Баримтын №",
        field: "documentNo",
        minWidth: 170,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Журналын нэр", field: "description", minWidth: 220, flex: 1 },
      {
        headerName: "Харилцагч",
        field: "counterparty",
        minWidth: 160,
      },
      {
        headerName: "Харьцсан GL",
        field: "counterAccountNumber",
        minWidth: 150,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "CF ангилал",
        field: "cashFlowCode",
        width: 170,
        cellClass: "font-mono text-xs",
        valueFormatter: (params) => {
          const code = params.value as string | null;
          if (!code) return "";
          const name = cashFlowNames[code];
          return name ? `${code} · ${name}` : code;
        },
      },
      { headerName: "Валют", field: "currency", width: 92 },
      {
        headerName: "Ханш",
        field: "exchangeRate",
        width: 120,
        cellClass: "ag-right-aligned-cell font-mono tabular-nums",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => {
          const value = Number(params.value ?? 0);
          return value > 0 ? fmtMnt(value) : "";
        },
      },
      {
        headerName: "Орлого",
        field: "receipt",
        ...moneyCol<CashDetailRow>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums text-[var(--ea-success-fg)]",
      },
      {
        headerName: "Зарлага",
        field: "payment",
        ...moneyCol<CashDetailRow>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums text-[var(--ea-danger-fg)]",
      },
      {
        headerName: "Үлдэгдэл",
        field: "runningBalance",
        ...moneyCol<CashDetailRow>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums font-semibold",
      },
      {
        headerName: "Орлого MNT",
        field: "baseReceipt",
        ...moneyCol<CashDetailRow>(),
      },
      {
        headerName: "Зарлага MNT",
        field: "basePayment",
        ...moneyCol<CashDetailRow>(),
      },
      {
        headerName: "Журналын баримт",
        field: "voucherId",
        minWidth: 220,
        cellClass: "font-mono text-xs",
      },
    ],
    [cashFlowNames]
  );

  // S8 нэгтгэлийн баганууд — бүлэглэлийн түлхүүр нь данс биш S8 код.
  const flowColumnDefs = useMemo<ColDef<CashFlowCodeRow>[]>(
    () => [
      {
        headerName: "Код",
        field: "code",
        width: 100,
        cellClass: "font-mono text-xs",
        valueFormatter: (params) => {
          const code = params.value as string | null;
          // Pinned нийт мөрийн дотоод sentinel-ийг хэрэглэгчид үзүүлэхгүй.
          if (code === "__total__") return "";
          return code ?? "—";
        },
      },
      { headerName: "Ангилал", field: "name", flex: 1, minWidth: 220 },
      { headerName: "Баримт", field: "documentCount", width: 100 },
      {
        headerName: "Орлого (MNT)",
        field: "receipts",
        ...moneyCol<CashFlowCodeRow>(),
        cellClass:
          "ag-right-aligned-cell font-mono tabular-nums text-[var(--ea-success-fg)]",
      },
      {
        headerName: "Зарлага (MNT)",
        field: "payments",
        ...moneyCol<CashFlowCodeRow>(),
        cellClass:
          "ag-right-aligned-cell font-mono tabular-nums text-[var(--ea-danger-fg)]",
      },
      {
        headerName: "Цэвэр урсгал",
        field: "net",
        ...moneyCol<CashFlowCodeRow>(),
        cellClass:
          "ag-right-aligned-cell font-mono tabular-nums font-semibold",
      },
    ],
    []
  );

  const flowPinnedBottom = useMemo<CashFlowCodeRow[]>(() => {
    const totals = flowRows.reduce(
      (acc, row) => ({
        receipts: acc.receipts + row.receipts,
        payments: acc.payments + row.payments,
        documentCount: acc.documentCount + row.documentCount,
      }),
      { receipts: 0, payments: 0, documentCount: 0 }
    );
    return [
      {
        code: "__total__",
        name: "Нийт",
        receipts: totals.receipts,
        payments: totals.payments,
        net: totals.receipts - totals.payments,
        documentCount: totals.documentCount,
      },
    ];
  }, [flowRows]);

  // Нийт мөр ВАЛЮТ бүрээр (ENT-050: зөвхөн MNT-ийг нийлүүлж USD данс «Нийт»-д
  // огт харагдахгүй байв). Валютыг ₮ болгож нэмэхгүй — ханш зохиохгүй; ₮
  // эквивалентыг «Дэлгэрэнгүй» табын ₮ баганууд харуулна.
  const pinnedBottom = useMemo<CashMovementRow[]>(() => {
    const byCurrency = new Map<string, CashMovementRow>();
    for (const row of rows) {
      const currency = row.currency || "MNT";
      const current = byCurrency.get(currency) ?? {
        accountId: `__total__${currency}`,
        accountName: `Нийт (${currency})`,
        currency: "",
        opening: 0,
        receipts: 0,
        payments: 0,
        closing: 0,
      };
      current.opening += row.opening;
      current.receipts += row.receipts;
      current.payments += row.payments;
      current.closing += row.closing;
      byCurrency.set(currency, current);
    }
    const ordered = [...byCurrency.entries()].sort(([a], [b]) =>
      a === "MNT" ? -1 : b === "MNT" ? 1 : a.localeCompare(b)
    );
    return ordered.length > 0
      ? ordered.map(([, row]) => row)
      : [
          {
            accountId: "__total__MNT",
            accountName: "Нийт (MNT)",
            currency: "",
            opening: 0,
            receipts: 0,
            payments: 0,
            closing: 0,
          },
        ];
  }, [rows]);

  const detailTotals = useMemo(
    () => {
      const nativeMntRows = detailRows.filter((row) => row.currency === "MNT");
      const nativeMnt = nativeMntRows.reduce(
        (acc, row) => ({
          receipt: acc.receipt + row.receipt,
          payment: acc.payment + row.payment,
        }),
        { receipt: 0, payment: 0 }
      );
      const baseMnt = detailRows.reduce(
        (acc, row) => ({
          baseReceipt: acc.baseReceipt + row.baseReceipt,
          basePayment: acc.basePayment + row.basePayment,
        }),
        { baseReceipt: 0, basePayment: 0 }
      );
      return { ...nativeMnt, ...baseMnt };
    },
    [detailRows]
  );

  const detailPinnedBottom = useMemo<CashDetailRow[]>(
    () => [
      {
        id: "__detail_total__",
        accountId: "__total__",
        accountName: "Нийт (MNT)",
        accountType: "",
        bankName: null,
        accountNumber: null,
        currency: "",
        date: "",
        documentNo: "",
        documentType: "",
        counterparty: null,
        counterAccountNumber: null,
        cashFlowCode: null,
        description: "",
        receipt: detailTotals.receipt,
        payment: detailTotals.payment,
        baseReceipt: detailTotals.baseReceipt,
        basePayment: detailTotals.basePayment,
        exchangeRate: 0,
        runningBalance: 0,
        status: "",
        voucherId: null,
      },
    ],
    [detailTotals]
  );

  function exportDetails() {
    detailGridRef.current?.api?.exportDataAsCsv({
      fileName: `cash-detail-${periodStart}-${periodEnd}.csv`,
    });
  }

  return (
    <ReportPage>
      <ReportHeader
        title="Мөнгөн хөдөлгөөний тайлан"
        meta={`${reportRangeLabel(periodStart, periodEnd)} · ${VIEW_HINTS[view]}`}
        actions={
          view === "detail" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={exportDetails}
              disabled={detailRows.length === 0}
            >
              <Icon name="download" size="sm" />
              CSV татах
            </Button>
          ) : null
        }
      />
      <ReportToolbar
        views={
          <PageTabs
            size="sm"
            ariaLabel="Мөнгөн хөдөлгөөний тайлангийн зүсэлт"
            value={view}
            onChange={setView}
            tabs={VIEW_TABS}
          />
        }
        filters={
          view === "detail" ? (
            <label className="relative w-full sm:w-72">
              <Icon
                name="search"
                className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-[var(--ea-text-4)]"
              />
              <span className="sr-only">Дэлгэрэнгүй тайлангаас хайх</span>
              <Input
                value={quickFilter}
                onChange={(event) => setQuickFilter(event.target.value)}
                placeholder="Хайх..."
                className="h-8 pl-8 text-xs"
              />
            </label>
          ) : null
        }
      />

      {rows.length === 0 ? (
        <ReportEmpty
          icon="cash"
          title="Касс, банкны данс үүсгээгүй байна"
          actions={[{ label: "Данс нэмэх", href: "/cash/accounts" }]}
        />
      ) : view === "accounts" ? (
        <DataGridDynamic<CashMovementRow>
          rowData={rows}
          columnDefs={movementColumnDefs}
          getRowId={(p) => p.data.accountId}
          pinnedBottomRowData={pinnedBottom}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      ) : view === "flow" ? (
        flowRows.length === 0 ? (
          <ReportEmpty
            icon="cash"
            title="Тайлант үед орлого, зарлагын гүйлгээ байхгүй"
          />
        ) : (
          /* S8 нэгтгэл — мөнгөн урсгалыг ДАНСААР биш мөнгөн урсгалын кодоор
             бүлэглэнэ (шууд аргын CF-ийн суурь; код нь Тохиргоо → GL-ийн
             S8 сегментийн утга тул хэрэглэгч өөрөө засварладаг "mapping"). */
          <DataGridDynamic<CashFlowCodeRow>
            rowData={flowRows}
            columnDefs={flowColumnDefs}
            getRowId={(p) => p.data.code ?? "__none__"}
            pinnedBottomRowData={flowPinnedBottom}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )
      ) : detailRows.length === 0 ? (
        <ReportEmpty icon="cash" title="Тайлангийн мөр байхгүй" />
      ) : (
        <DataGridDynamic<CashDetailRow>
          ref={detailGridRef}
          rowData={detailRows}
          columnDefs={detailColumnDefs}
          getRowId={(p) => p.data.id}
          pinnedBottomRowData={detailPinnedBottom}
          quickFilterText={quickFilter}
          height="flex"
          pagination={detailRows.length > 50}
          paginationPageSize={50}
          paginationPageSizeSelector={false}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}
    </ReportPage>
  );
}

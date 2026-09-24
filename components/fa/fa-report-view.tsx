"use client";

// ҮХ-ийн тайлан — НЭГ тайлангийн хоёр зүсэлт (PageTabs):
//   1. Хөрөнгийн бүртгэл: карт бүрийн өртөг / хуримтлагдсан элэгдэл / NBV,
//      төлөвөөр шүүх FilterChips, идэвхтэй хөрөнгийн pinned нийлбэр
//   2. Элэгдлийн сарын нэгтгэл: батлагдсан бичилтүүд сараар
// Дансны mapping энд хамааралгүй — хөрөнгө бүр данс(ууд)аа картдаа өөрөө
// заадаг (assetAccountNumber г.м. тохиргооны түвшний mapping).

import { useMemo, useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  ReportEmpty,
  ReportHeader,
  ReportPage,
  ReportToolbar,
} from "@/components/reports/report-layout";
import { FilterChips, PageTabs } from "@/components/ui/tabs";
import type { FixedAssetView } from "@/lib/fa/asset-views";
import { fmtPeriodCode } from "@/lib/periods/period";
import { fmtMnt } from "@/lib/reports/balances";
import { openFaAssetPanel } from "@/lib/store/panel-store";

interface Props {
  assets: FixedAssetView[];
}

const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: "Идэвхтэй", tone: "success" },
  draft: { label: "Ноорог", tone: "warning" },
  disposed: { label: "Данснаас хассан", tone: "muted" },
};

type StatusFilter = "all" | "active" | "draft" | "disposed";

interface MonthRow {
  month: string;
  entryCount: number;
  amount: number;
}

function moneyCol<T>(): Partial<ColDef<T>> {
  return {
    cellClass: "ag-right-aligned-cell font-mono tabular-nums",
    headerClass: "ag-right-aligned-header",
    width: 150,
    valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
  };
}

export function FaReportView({ assets }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<"register" | "months">("register");

  const counts = useMemo(
    () => ({
      active: assets.filter((a) => a.status === "active").length,
      draft: assets.filter((a) => a.status === "draft").length,
      disposed: assets.filter((a) => a.status === "disposed").length,
    }),
    [assets]
  );

  const displayed = useMemo(
    () =>
      statusFilter === "all"
        ? assets
        : assets.filter((a) => a.status === statusFilter),
    [assets, statusFilter]
  );

  const columnDefs = useMemo<ColDef<FixedAssetView>[]>(
    () => [
      { headerName: "Код", field: "code", width: 110, cellClass: "font-mono text-xs" },
      { headerName: "Нэр", field: "name", minWidth: 200, flex: 1 },
      {
        headerName: "Ашиглалтад орсон",
        field: "acquisitionDate",
        width: 140,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Хөрөнгийн данс",
        field: "assetAccountNumber",
        width: 130,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Өртөг", field: "cost", ...moneyCol<FixedAssetView>() },
      {
        headerName: "Нээлтийн хуримт. элэгдэл",
        field: "openingAccumulated",
        ...moneyCol<FixedAssetView>(),
      },
      {
        headerName: "Хуримт. элэгдэл",
        field: "accumulated",
        ...moneyCol<FixedAssetView>(),
      },
      {
        headerName: "Үлдэгдэл өртөг",
        field: "netBookValue",
        ...moneyCol<FixedAssetView>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums font-semibold",
      },
      {
        headerName: "Ашиглалт (сар)",
        field: "usefulLifeMonths",
        width: 120,
        cellClass: "ag-right-aligned-cell font-mono tabular-nums",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 150,
        cellRenderer: (params: ICellRendererParams<FixedAssetView>) => {
          const status = params.data?.status;
          if (!status || params.data?.id === "__total__") return null;
          const meta = STATUS_META[status] ?? {
            label: status,
            tone: "muted" as StatusTone,
          };
          return (
            <span className="flex h-full items-center">
              <StatusBadge tone={meta.tone} size="sm">
                {meta.label}
              </StatusBadge>
            </span>
          );
        },
      },
    ],
    []
  );

  // Нийлбэр — зөвхөн идэвхтэй хөрөнгө (самбарын NBV-тэй ижил хамрах хүрээ).
  const pinnedBottom = useMemo<FixedAssetView[]>(() => {
    const active = assets.filter((a) => a.status === "active");
    const sum = (pick: (a: FixedAssetView) => number) =>
      Math.round(active.reduce((s, a) => s + pick(a), 0) * 100) / 100;
    return [
      {
        id: "__total__",
        code: "",
        name: `Нийт (идэвхтэй ${active.length})`,
        acquisitionDate: "",
        location: null,
        subLocation: null,
        depreciationStartDate: null,
        taxUsefulLifeMonths: 0,
        taxDepreciationMethod: "straight_line",
        cost: sum((a) => a.cost),
        salvageValue: 0,
        usefulLifeMonths: 0,
        depreciationMethod: "",
        custodian: null,
        depreciationStartMonth: null,
        assetAccountNumber: "",
        accumDepAccountNumber: "",
        depExpenseAccountNumber: "",
        status: "",
        disposalType: null,
        disposalDate: null,
        disposalProceeds: null,
        disposalVoucherId: null,
        openingAccumulated: sum((a) => a.openingAccumulated),
        openingTaxAccumulated: sum((a) => a.openingTaxAccumulated),
        openingAsOf: null,
        accumulated: sum((a) => a.accumulated),
        netBookValue: sum((a) => a.netBookValue),
        entries: [],
      },
    ];
  }, [assets]);

  // Элэгдлийн сарын нэгтгэл — зөвхөн батлагдсан бичилт.
  const monthRows = useMemo<MonthRow[]>(() => {
    const byMonth = new Map<string, MonthRow>();
    for (const asset of assets) {
      for (const entry of asset.entries) {
        if (entry.status !== "posted") continue;
        const row = byMonth.get(entry.periodMonth) ?? {
          month: entry.periodMonth,
          entryCount: 0,
          amount: 0,
        };
        row.entryCount += 1;
        row.amount += entry.amount;
        byMonth.set(entry.periodMonth, row);
      }
    }
    return [...byMonth.values()]
      .map((row) => ({ ...row, amount: Math.round(row.amount * 100) / 100 }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [assets]);

  const monthColumnDefs = useMemo<ColDef<MonthRow>[]>(
    () => [
      {
        headerName: "Сар",
        field: "month",
        width: 120,
        cellClass: "font-mono text-xs",
        valueFormatter: (p) =>
          p.value === "__total__" ? "Нийт" : fmtPeriodCode(String(p.value ?? "")),
      },
      { headerName: "Бичилт", field: "entryCount", width: 110 },
      {
        headerName: "Элэгдлийн дүн",
        field: "amount",
        ...moneyCol<MonthRow>(),
      },
    ],
    []
  );

  const monthPinnedBottom = useMemo<MonthRow[]>(
    () => [
      {
        month: "__total__",
        entryCount: monthRows.reduce((s, r) => s + r.entryCount, 0),
        amount:
          Math.round(monthRows.reduce((s, r) => s + r.amount, 0) * 100) / 100,
      },
    ],
    [monthRows]
  );

  return (
    <ReportPage>
      <ReportHeader
        title="Хөрөнгийн бүртгэл, элэгдэл"
        meta={
          view === "register"
            ? "Карт бүрийн өртөг, хуримтлагдсан элэгдэл, үлдэгдэл өртөг (одоогийн байдлаар) · мөр дээр давхар даралтаар карт нээгдэнэ"
            : "Батлагдсан элэгдлийн бичилтүүд сараар"
        }
      />
      <ReportToolbar
        views={
          <PageTabs
            size="sm"
            ariaLabel="Үндсэн хөрөнгийн тайлангийн зүсэлт"
            value={view}
            onChange={setView}
            tabs={[
              { value: "register", label: "Хөрөнгийн бүртгэл" },
              { value: "months", label: "Элэгдлийн сарын нэгтгэл" },
            ]}
          />
        }
        filters={
          view === "register" ? (
            <FilterChips
              options={[
                { value: "all", label: "Бүгд", count: assets.length },
                { value: "active", label: "Идэвхтэй", count: counts.active },
                {
                  value: "draft",
                  label: "Ноорог",
                  count: counts.draft,
                  tone: counts.draft > 0 ? ("warning" as const) : undefined,
                },
                { value: "disposed", label: "Данснаас хассан", count: counts.disposed },
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
            />
          ) : null
        }
      />

      {view === "register" ? (
        displayed.length === 0 ? (
          <ReportEmpty
            icon="fixedAsset"
            title="Хөрөнгийн карт байхгүй"
            actions={[{ label: "Хөрөнгө нэмэх", href: "/fa" }]}
          />
        ) : (
          <DataGridDynamic<FixedAssetView>
            rowData={displayed}
            columnDefs={columnDefs}
            getRowId={(p) => p.data.id}
            pinnedBottomRowData={pinnedBottom}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
            onRowDoubleClicked={(event) => {
              if (event.data && event.data.id !== "__total__")
                openFaAssetPanel(event.data.id, event.data.name);
            }}
          />
        )
      ) : monthRows.length === 0 ? (
        <ReportEmpty icon="depreciation" title="Батлагдсан элэгдлийн бичилт байхгүй" />
      ) : (
        <DataGridDynamic<MonthRow>
          rowData={monthRows}
          columnDefs={monthColumnDefs}
          getRowId={(p) => p.data.month}
          pinnedBottomRowData={monthPinnedBottom}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}
    </ReportPage>
  );
}

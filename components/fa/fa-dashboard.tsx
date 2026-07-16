"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColDef } from "ag-grid-community";
import { Building, FileClock, Scale, TrendingDown } from "lucide-react";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

export type NbvRow = {
  assetId: string;
  code: string;
  name: string;
  cost: number;
  accumulated: number;
  nbv: number;
};

export type FaTieOutRow = {
  accountNumber: string;
  accountName: string;
  subledgerValue: number;
  glBalance: number;
  difference: number;
};

interface Props {
  rows: NbvRow[];
  tieOut: FaTieOutRow[];
  draftAssetCount: number;
  draftEntryCount: number;
}

export function FaDashboard({ rows, tieOut, draftAssetCount, draftEntryCount }: Props) {
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  const totalAccum = rows.reduce((sum, row) => sum + row.accumulated, 0);
  const totalNbv = rows.reduce((sum, row) => sum + row.nbv, 0);

  const columns = useMemo<ColDef<NbvRow>[]>(
    () => [
      { headerName: "Код", field: "code", width: 180, cellClass: "font-mono text-xs" },
      { headerName: "Хөрөнгө", field: "name", minWidth: 200, flex: 1 },
      {
        headerName: "Өртөг",
        field: "cost",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Хуримт. элэгдэл",
        field: "accumulated",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Үлдэгдэл өртөг (NBV)",
        field: "nbv",
        width: 180,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
    ],
    []
  );

  const tieOutColumns = useMemo<ColDef<FaTieOutRow>[]>(
    () => [
      {
        headerName: "GL данс",
        colId: "account",
        minWidth: 220,
        flex: 1,
        valueGetter: (params) =>
          params.data ? `${params.data.accountNumber} ${params.data.accountName}` : "",
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Subledger",
        field: "subledgerValue",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "GL үлдэгдэл",
        field: "glBalance",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Зөрүү",
        field: "difference",
        width: 140,
        headerClass: "ag-right-aligned-header",
        cellClass: (params) =>
          cn(
            "ag-right-aligned-cell font-mono font-semibold",
            Math.abs(Number(params.value ?? 0)) > 0.01 && "text-[var(--ea-danger)]"
          ),
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
    ],
    []
  );

  const metrics = [
    {
      label: "Нийт өртөг (идэвхтэй)",
      value: fmtMnt(totalCost),
      icon: Building,
      color: "var(--ea-primary)",
      href: "/fa/assets",
    },
    {
      label: "Хуримтлагдсан элэгдэл",
      value: fmtMnt(totalAccum),
      icon: TrendingDown,
      color: "var(--ea-text-3)",
      href: "/fa/depreciation",
    },
    {
      label: "Үлдэгдэл өртөг (NBV)",
      value: fmtMnt(totalNbv),
      icon: Scale,
      color: "var(--ea-success)",
      href: "/fa/assets",
    },
    {
      label: "Ноорог (карт + элэгдэл)",
      value: `${draftAssetCount} + ${draftEntryCount}`,
      icon: FileClock,
      color:
        draftAssetCount + draftEntryCount > 0
          ? "var(--ea-warning)"
          : "var(--ea-success)",
      href: draftAssetCount > 0 ? "/fa/assets" : "/fa/depreciation",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Үндсэн хөрөнгийн хяналт
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Идэвхтэй картын өртөг, элэгдэл, NBV — GL-тэй тулгалтын хамт
        </p>
      </div>

      <section className="grid grid-cols-2 border-y border-[var(--ea-border)] lg:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Link
              key={metric.label}
              href={metric.href}
              className="flex min-w-0 items-center gap-3 border-b border-r border-[var(--ea-border)] px-4 py-4 transition-colors last:border-r-0 hover:bg-[var(--ea-bg-2)] lg:border-b-0"
              style={{ textDecoration: "none" }}
            >
              <div
                className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--ea-bg-2)]"
                style={{ color: metric.color }}
              >
                <Icon size={16} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[11px] text-[var(--ea-text-3)]">
                  {metric.label}
                </div>
                <div className="mt-0.5 truncate font-mono text-base font-semibold text-[var(--ea-text-1)]">
                  {metric.value}
                </div>
              </div>
            </Link>
          );
        })}
      </section>

      <section className="min-w-0">
        <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
          NBV бүртгэл (идэвхтэй хөрөнгө)
        </h2>
        {rows.length === 0 ? (
          <EmptyBox text="Идэвхтэй хөрөнгө алга — карт бүртгэж идэвхжүүлнэ" />
        ) : (
          <DataGridDynamic<NbvRow>
            rowData={rows}
            columnDefs={columns}
            getRowId={(params) => params.data.assetId}
            height={Math.min(480, 86 + rows.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )}
      </section>

      <section className="min-w-0">
        <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
          GL тулгалт
        </h2>
        <p className="mb-2 text-[11px] text-[var(--ea-text-4)]">
          Өртгийн данс vs идэвхтэй картын Σ өртөг · хуримт. элэгдлийн данс vs
          Σ батлагдсан элэгдэл. Зөрүү нь картгүй худалдан авалт эсвэл гараар
          бичсэн журналыг илтгэнэ.
        </p>
        {tieOut.length === 0 ? (
          <EmptyBox text="FA данс ашиглагдаагүй байна" />
        ) : (
          <DataGridDynamic<FaTieOutRow>
            rowData={tieOut}
            columnDefs={tieOutColumns}
            getRowId={(params) => params.data.accountNumber}
            height={Math.min(320, 86 + tieOut.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )}
      </section>
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
      {text}
    </div>
  );
}

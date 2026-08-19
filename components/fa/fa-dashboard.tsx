"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import Link from "next/link";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { clickableAmountCell } from "@/components/datagrid/clickable-amount";
import { FilterChips } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LoadingInline } from "@/components/ui/loading";
import { getFaTieOutDetail, type FaTieOutDetail } from "@/lib/actions/fa";
import {
  PERIOD_SCOPES,
  PERIOD_SCOPE_LABELS,
  scopeRange,
  type PeriodScope,
} from "@/lib/periods/scope";
import { fmtMnt } from "@/lib/reports/balances";
import { openVoucherPanel } from "@/lib/store/panel-store";
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

type TieOutMeasure = "subledger" | "gl" | "difference";

const MEASURE_LABELS: Record<TieOutMeasure, string> = {
  subledger: "Subledger задаргаа",
  gl: "GL үлдэгдлийн задаргаа",
  difference: "Зөрүүний задаргаа",
};

export function FaDashboard({ rows, tieOut, draftAssetCount, draftEntryCount }: Props) {
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  const totalAccum = rows.reduce((sum, row) => sum + row.accumulated, 0);
  const totalNbv = rows.reduce((sum, row) => sum + row.nbv, 0);

  const [detail, setDetail] = useState<{
    row: FaTieOutRow;
    measure: TieOutMeasure;
  } | null>(null);

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

  const tieOutColumns = useMemo<ColDef<FaTieOutRow>[]>(() => {
    // Дүн дархад задаргаа нээнэ — нэгдсэн clickableAmountCell renderer.
    const clickableAmount = (measure: TieOutMeasure) =>
      clickableAmountCell<FaTieOutRow>(
        (row) => setDetail({ row, measure }),
        fmtMnt
      );
    return [
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
        cellRenderer: clickableAmount("subledger"),
      },
      {
        headerName: "GL үлдэгдэл",
        field: "glBalance",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        cellRenderer: clickableAmount("gl"),
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
        cellRenderer: clickableAmount("difference"),
      },
    ];
  }, [setDetail]);

  const metrics = [
    {
      label: "Нийт өртөг (идэвхтэй)",
      value: fmtMnt(totalCost),
      icon: "fixedAsset" as IconName,
      color: "var(--ea-primary)",
      href: "/fa/assets",
    },
    {
      label: "Хуримтлагдсан элэгдэл",
      value: fmtMnt(totalAccum),
      icon: "depreciation" as IconName,
      color: "var(--ea-text-3)",
      href: "/fa/depreciation",
    },
    {
      label: "Үлдэгдэл өртөг (NBV)",
      value: fmtMnt(totalNbv),
      icon: "reconciliation" as IconName,
      color: "var(--ea-success)",
      href: "/fa/assets",
    },
    {
      label: "Ноорог (карт + элэгдэл)",
      value: `${draftAssetCount} + ${draftEntryCount}`,
      icon: "pending" as IconName,
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
                <Icon name={metric.icon} />
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

      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          {detail && (
            <TieOutDetailBody
              row={detail.row}
              measure={detail.measure}
              onNavigate={() => setDetail(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Задаргааны dialog — PTD default, QTD/YTD/гар мужаар солино ──────────────

function TieOutDetailBody({
  row,
  measure,
  onNavigate,
}: {
  row: FaTieOutRow;
  measure: TieOutMeasure;
  /** Журнал руу үсрэхэд dialog-оо хаана — панель нь ил гарна. */
  onNavigate: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  // Default PTD — их түүхтэй данс дээр ч хурдан нээгдэнэ.
  const [scope, setScope] = useState<PeriodScope | "custom">("PTD");
  const [range, setRange] = useState(() => scopeRange(currentMonth, "PTD", today));
  // Sync setState-гүй ачаалалт: үр дүнг МУЖИЙН ТҮЛХҮҮРТЭЙ нь хадгалж,
  // одоогийн түлхүүртэй таарахгүй бол "ачаалж байна" гэж үзнэ.
  const key = `${row.accountNumber}|${range.from}|${range.to}`;
  const [loaded, setLoaded] = useState<
    | { key: string; ok: true; data: FaTieOutDetail }
    | { key: string; ok: false; message: string }
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    getFaTieOutDetail({
      accountNumber: row.accountNumber,
      from: range.from,
      to: range.to,
    })
      .then((result) => {
        if (!cancelled) setLoaded({ key, ok: true, data: result });
      })
      .catch((caught) => {
        if (!cancelled)
          setLoaded({
            key,
            ok: false,
            message:
              caught instanceof Error ? caught.message : "Ачаалж чадсангүй",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [key, row.accountNumber, range.from, range.to]);

  const data = loaded?.key === key && loaded.ok ? loaded.data : null;
  const error = loaded?.key === key && !loaded.ok ? loaded.message : "";

  const showGl = measure === "gl" || measure === "difference";
  const showSub = measure === "subledger" || measure === "difference";

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {row.accountNumber} {row.accountName} — {MEASURE_LABELS[measure]}
        </DialogTitle>
        <DialogDescription>
          Баганын дүн нь бүх цагийн үлдэгдэл; доорх задаргаа нь СОНГОСОН
          МУЖИЙН гүйлгээг харуулна (их дата дээр хурдан байлгахын тулд).
        </DialogDescription>
      </DialogHeader>

      {/* Мужийн сонголт — нэгдсэн FilterChips + гар муж */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          options={PERIOD_SCOPES.map((option) => ({
            value: option,
            label: PERIOD_SCOPE_LABELS[option],
          }))}
          value={scope === "custom" ? ("" as PeriodScope) : scope}
          onChange={(option) => {
            setScope(option);
            setRange(scopeRange(currentMonth, option, today));
          }}
        />
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={range.from}
            onChange={(event) => {
              setScope("custom");
              setRange((current) => ({ ...current, from: event.target.value }));
            }}
            className="h-7 w-36 text-xs"
          />
          <span className="text-xs text-[var(--ea-text-4)]">—</span>
          <Input
            type="date"
            value={range.to}
            onChange={(event) => {
              setScope("custom");
              setRange((current) => ({ ...current, to: event.target.value }));
            }}
            className="h-7 w-36 text-xs"
          />
        </div>
      </div>

      {error ? (
        <p className="text-sm" style={{ color: "var(--ea-danger-fg)" }}>
          {error}
        </p>
      ) : data === null ? (
        <LoadingInline />
      ) : (
        <div className="grid gap-4">
          {measure === "difference" && (
            <div
              className="rounded-md border px-3 py-2 font-mono text-sm"
              style={{ borderColor: "var(--ea-border)", background: "var(--ea-bg-2)" }}
            >
              Мужид: GL {fmtMnt(data.glTotal)} − Subledger{" "}
              {fmtMnt(data.subledgerTotal)} ={" "}
              <span
                className="font-semibold"
                style={{
                  color:
                    Math.abs(data.glTotal - data.subledgerTotal) > 0.01
                      ? "var(--ea-danger-fg)"
                      : "var(--ea-success-fg)",
                }}
              >
                {fmtMnt(Math.round((data.glTotal - data.subledgerTotal) * 100) / 100)}
              </span>
            </div>
          )}

          {showGl && (
            <DetailList
              title={`GL гүйлгээ (${data.gl.length}) · Σ ${fmtMnt(data.glTotal)}`}
              empty="Энэ мужид GL гүйлгээ алга."
              rows={data.gl.map((entry) => ({
                id: entry.voucherId,
                date: entry.date,
                label: entry.description,
                amount: entry.amount,
                onOpen: () => {
                  onNavigate();
                  openVoucherPanel(entry.voucherId);
                },
              }))}
            />
          )}
          {showSub && (
            <DetailList
              title={`Subledger гүйлгээ (${data.subledger.length}) · Σ ${fmtMnt(data.subledgerTotal)}`}
              empty="Энэ мужид subledger гүйлгээ алга."
              rows={data.subledger}
            />
          )}
        </div>
      )}
    </>
  );
}

function DetailList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: {
    id: string;
    date: string;
    label: string;
    amount: number;
    onOpen?: () => void;
  }[];
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-[var(--ea-text-2)]">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--ea-text-4)]">{empty}</p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {rows.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-2 rounded border px-2 py-1 text-xs"
              style={{ borderColor: "var(--ea-border)", background: "var(--ea-bg-2)" }}
            >
              <span className="font-mono text-[var(--ea-text-4)]">{entry.date}</span>
              {entry.onOpen ? (
                <button
                  type="button"
                  onClick={entry.onOpen}
                  className="min-w-0 flex-1 truncate text-left text-[var(--ea-primary)] hover:underline"
                  title="Журналыг нээх"
                >
                  {entry.label}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate text-[var(--ea-text-1)]">
                  {entry.label}
                </span>
              )}
              <span className="font-mono text-[var(--ea-text-1)]">
                {fmtMnt(entry.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
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

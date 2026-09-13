"use client";

// «Ханшийн түүх» — Монголбанкны (болон арилжааны банкны) ХАДГАЛАГДСАН ханшийн
// лавлах. Эхний үлдэгдэл, өмнөх хугацааны бичилт, хойшлуулсан тэгшитгэлд
// ӨМНӨХ ҮЕИЙН ханш хэрэгтэй тул түүхийг нэг удаа татаж хадгална.
//
// Огнооны муж / валют / эх сурвалж нь URL параметраар илэрхийлэгдэнэ
// (`from` / `to` / `currency` / `source`) — CLAUDE.md §4 deep link дүрэм:
// параметр нь ЦОРЫН ГАНЦ эх сурвалж, cookie-гийн периодын сонголт зөвхөн
// default өгнө. Тиймээс энд шүүлтүүрийн дотоод "хуулбар" state байхгүй —
// огнооны талбар л түр input state барина (Шүүх дарж URL руу очно).
//
// ХАНШ ХЭЗЭЭ Ч ЗОХИОГДОХГҮЙ: энэ дэлгэц зөвхөн хадгалагдсаныг харуулна,
// байхгүй огноог нөхөж бөглөхгүй — татах эсвэл гараар оруулах нь
// хэрэглэгчийн шийдэл.

import { useCallback, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { FilterChips, type ChipOption } from "@/components/ui/tabs";
import { syncMongolbankRates } from "@/lib/actions/exchange-rates";

/**
 * Хадгалагдсан ханшийн нэг мөр — `lib/cash/rate-store.ts`-ийн `StoredRateRow`-той
 * ижил хэлбэр. Тэр модуль postgres драйвер татдаг тул client component-д
 * import хийхгүй (browser bundle-д орох болно) — хэлбэрийг энд зарлана.
 */
export type ExchangeRateHistoryRow = {
  id: string;
  source: string;
  date: string;
  currency: string;
  officialRate: number | null;
  nonCashBuyRate: number | null;
  nonCashSellRate: number | null;
  cashBuyRate: number | null;
  cashSellRate: number | null;
  sourceUrl: string | null;
  fetchedAt: string;
};

/** Хадгалагдсан түүхийн хамрах хүрээ — «юу татагдсан бэ» гэдгийг ил харуулна. */
export type ExchangeRateCoverage = {
  rows: number;
  minDate: string | null;
  maxDate: string | null;
  currencies: number;
};

type SourceFilter = "all" | "mongolbank" | "tdb" | "golomt";

const SOURCE_LABELS: Record<string, string> = {
  mongolbank: "Монголбанк",
  tdb: "Худалдаа, хөгжлийн банк",
  golomt: "Голомт банк",
};

const SOURCE_ORDER: readonly Exclude<SourceFilter, "all">[] = [
  "mongolbank",
  "tdb",
  "golomt",
];

/**
 * Ханш нь МӨНГӨ БИШ (нэгж валютын үнэ) тул `fmtMnt`-ээр бөөрөнхийлөхгүй —
 * 4 орны нарийвчлалтай харуулна (Монголбанк 2 орон, зарим кросс ханш 4).
 */
function fmtRate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function rateFormatter(params: { value: unknown }) {
  return fmtRate(params.value == null ? null : Number(params.value));
}

export function ExchangeRateHistoryView({
  from,
  to,
  currency,
  source,
  rows,
  coverage,
  currencies,
  truncated,
}: {
  /** Идэвхтэй муж — URL параметр эсвэл периодын сонголтын default. */
  from: string;
  to: string;
  /** "" бол бүх валют. */
  currency: string;
  /** "" бол бүх эх сурвалж. */
  source: string;
  /** Мужид хадгалагдсан мөрүүд (бүх эх сурвалж — chip тоолуур эндээс). */
  rows: ExchangeRateHistoryRow[];
  coverage: ExchangeRateCoverage;
  /** Санд байгаа бүх валют (шүүлтүүрийн сонголт). */
  currencies: string[];
  /** Мөрийн хязгаарт хүрсэн — муж/валютаа нарийсгах шаардлагатай. */
  truncated: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [fromInput, setFromInput] = useState(from);
  const [toInput, setToInput] = useState(to);
  const [isSyncing, startSync] = useTransition();

  const activeSource: SourceFilter = SOURCE_ORDER.some(
    (value) => value === source
  )
    ? (source as SourceFilter)
    : "all";

  const setParams = useCallback(
    (next: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (!value || value === "all") params.delete(key);
        else params.set(key, value);
      }
      router.push(
        `${pathname}${params.toString() ? `?${params.toString()}` : ""}`
      );
    },
    [pathname, router, searchParams]
  );

  const visibleRows = useMemo(
    () =>
      activeSource === "all"
        ? rows
        : rows.filter((row) => row.source === activeSource),
    [rows, activeSource]
  );

  const sourceChips = useMemo<ChipOption<SourceFilter>[]>(() => {
    const counts = new Map<string, number>();
    for (const row of rows)
      counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
    return [
      { value: "all", label: "Бүх эх сурвалж", count: rows.length },
      ...SOURCE_ORDER.map((value) => ({
        value,
        label: SOURCE_LABELS[value] ?? value,
        count: counts.get(value) ?? 0,
      })),
    ];
  }, [rows]);

  // Арилжааны банкны багана нь ЗӨВХӨН утга байвал гарна — Монголбанкны
  // албан ханш дангаараа татагдсан үед хоосон багана нүд эзлэхгүй.
  const hasNonCash = useMemo(
    () =>
      visibleRows.some(
        (row) => row.nonCashBuyRate != null || row.nonCashSellRate != null
      ),
    [visibleRows]
  );
  const hasCash = useMemo(
    () =>
      visibleRows.some(
        (row) => row.cashBuyRate != null || row.cashSellRate != null
      ),
    [visibleRows]
  );

  const runSync = useCallback(() => {
    startSync(async () => {
      try {
        const { saved, error } = await syncMongolbankRates({ from, to });
        if (error || saved == null) {
          toast.error(error ?? "Монголбанкны ханш татагдсангүй");
          return;
        }
        toast.success(`${saved.toLocaleString("en-US")} мөр хадгалагдлаа`);
        router.refresh();
      } catch {
        // Server action-ы сүлжээний доголдол — action өөрөө { error }
        // буцаадаг тул энд зөвхөн дуудлага өөрөө тасарсан тохиолдол.
        toast.error("Монголбанкны ханш татагдсангүй");
      }
    });
  }, [from, to, router]);

  const columnDefs = useMemo<ColDef<ExchangeRateHistoryRow>[]>(() => {
    const columns: ColDef<ExchangeRateHistoryRow>[] = [
      {
        headerName: "Огноо",
        field: "date",
        width: 118,
        cellClass: "font-mono text-xs",
        sort: "desc",
      },
      { headerName: "Валют", field: "currency", width: 92 },
      {
        headerName: "Албан ханш",
        field: "officialRate",
        width: 138,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: rateFormatter,
      },
    ];

    if (hasNonCash)
      columns.push(
        {
          headerName: "Бэлэн бус авах",
          field: "nonCashBuyRate",
          width: 146,
          cellClass: "ag-right-aligned-cell font-mono",
          headerClass: "ag-right-aligned-header",
          valueFormatter: rateFormatter,
        },
        {
          headerName: "Бэлэн бус зарах",
          field: "nonCashSellRate",
          width: 150,
          cellClass: "ag-right-aligned-cell font-mono",
          headerClass: "ag-right-aligned-header",
          valueFormatter: rateFormatter,
        }
      );

    if (hasCash)
      columns.push(
        {
          headerName: "Бэлэн авах",
          field: "cashBuyRate",
          width: 132,
          cellClass: "ag-right-aligned-cell font-mono",
          headerClass: "ag-right-aligned-header",
          valueFormatter: rateFormatter,
        },
        {
          headerName: "Бэлэн зарах",
          field: "cashSellRate",
          width: 136,
          cellClass: "ag-right-aligned-cell font-mono",
          headerClass: "ag-right-aligned-header",
          valueFormatter: rateFormatter,
        }
      );

    columns.push(
      {
        headerName: "Эх сурвалж",
        field: "source",
        minWidth: 190,
        flex: 1,
        valueGetter: (params) =>
          params.data ? (SOURCE_LABELS[params.data.source] ?? params.data.source) : "",
        cellRenderer: (params: ICellRendererParams<ExchangeRateHistoryRow>) => {
          const url = params.data?.sourceUrl;
          if (!url) return params.value;
          return (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[var(--ea-primary)] hover:underline"
            >
              {params.value}
              <Icon name="openExternal" size="xs" />
            </a>
          );
        },
      },
      {
        headerName: "Татсан огноо",
        field: "fetchedAt",
        width: 134,
        cellClass: "font-mono text-xs text-[var(--ea-text-3)]",
        valueFormatter: (params) =>
          typeof params.value === "string" ? params.value.slice(0, 10) : "",
      }
    );

    return columns;
  }, [hasCash, hasNonCash]);

  const currencyOptions = useMemo(
    () => [
      { value: "", label: "Бүх валют" },
      ...currencies.map((code) => ({ value: code, label: code })),
    ],
    [currencies]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Ханшийн түүх
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Монголбанкны өдөр тутмын албан ханшийг татаж хадгална. Эхний
            үлдэгдэл, өмнөх хугацааны бичилт, хойшлуулсан тэгшитгэлийг тухайн
            ӨДРИЙН ханшаар хийхэд ашиглагдана.
          </p>
        </div>
        <Button onClick={runSync} disabled={isSyncing}>
          <Icon
            name={isSyncing ? "loading" : "download"}
            className={isSyncing ? "animate-spin" : undefined}
          />
          {isSyncing ? "Татаж байна..." : "Монголбанкнаас татах"}
        </Button>
      </div>

      <section className="grid grid-cols-2 border-y border-[var(--ea-border)] lg:grid-cols-4">
        <CoverageMetric label="Хадгалсан мөр" value={coverage.rows.toLocaleString("en-US")} />
        <CoverageMetric label="Эхний огноо" value={coverage.minDate ?? "—"} mono />
        <CoverageMetric label="Сүүлийн огноо" value={coverage.maxDate ?? "—"} mono />
        <CoverageMetric label="Валют" value={String(coverage.currencies)} />
      </section>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-[var(--ea-text-3)]">
            Эхлэх огноо
            <Input
              type="date"
              value={fromInput}
              onChange={(event) => setFromInput(event.target.value)}
              className="w-40"
              aria-label="Ханшийн мужийн эхлэх огноо"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[var(--ea-text-3)]">
            Дуусах огноо
            <Input
              type="date"
              value={toInput}
              onChange={(event) => setToInput(event.target.value)}
              className="w-40"
              aria-label="Ханшийн мужийн дуусах огноо"
            />
          </label>
          <Button
            variant="outline"
            onClick={() => setParams({ from: fromInput, to: toInput })}
          >
            <Icon name="refresh" />
            Шүүх
          </Button>
          {/* Сонгогч нь товч тул <label for> биш — гарчгийг зэрэгцээ бичнэ. */}
          <div className="flex w-44 flex-col gap-1 text-[11px] text-[var(--ea-text-3)]">
            <span>Валют</span>
            <SearchableSelect
              value={currency}
              onChange={(next) => setParams({ currency: next })}
              options={currencyOptions}
              placeholder="Бүх валют"
              hideValue
            />
          </div>
        </div>
        <FilterChips<SourceFilter>
          options={sourceChips}
          value={activeSource}
          onChange={(next) => setParams({ source: next })}
          className="flex-wrap"
        />
      </div>

      {truncated && (
        <p className="rounded-md bg-[var(--ea-warning-bg)] px-3 py-2 text-xs text-[var(--ea-warning-fg)]">
          Мужид хэт олон мөр байна — эхний {rows.length.toLocaleString("en-US")}{" "}
          мөр л харагдаж байна. Огнооны муж эсвэл валютаа нарийсгана уу.
        </p>
      )}

      {coverage.rows === 0 ? (
        <EmptyState
          icon="bank"
          title="Ханш татаагүй байна"
          description="Монголбанкны өдөр тутмын албан ханшийг сонгосон мужаар татаж хадгалснаар өмнөх үеийн бичилтэд тухайн өдрийн ханш ашиглах боломжтой болно."
          actions={[
            {
              label: isSyncing ? "Татаж байна..." : "Монголбанкнаас татах",
              onClick: runSync,
              icon: "download",
              primary: true,
            },
          ]}
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState
          icon="bank"
          title="Сонгосон мужид ханш алга"
          description={`${from} — ${to} хооронд${
            currency ? ` ${currency} валютын` : ""
          } хадгалагдсан ханш байхгүй байна. Энэ мужийг татах эсвэл шүүлтүүрээ өөрчилнө үү.`}
          actions={[
            {
              label: isSyncing ? "Татаж байна..." : "Энэ мужийг татах",
              onClick: runSync,
              icon: "download",
              primary: true,
            },
          ]}
        />
      ) : (
        <DataGridDynamic<ExchangeRateHistoryRow>
          rowData={visibleRows}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          height="flex"
          pagination={visibleRows.length > 50}
          paginationPageSize={50}
          paginationPageSizeSelector={false}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}
    </section>
  );
}

function CoverageMetric({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="border-r border-[var(--ea-border)] px-3 py-2.5 last:border-r-0">
      <div className="text-[11px] text-[var(--ea-text-3)]">{label}</div>
      <div
        className={`mt-0.5 text-sm font-semibold text-[var(--ea-text-1)] ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

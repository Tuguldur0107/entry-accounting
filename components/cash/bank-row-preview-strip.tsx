"use client";

// Хуулгын хянах хүснэгтийн ДООРХ хэсэг — курсортой (дарсан / гараар шилжсэн)
// мөрийн хадгалахад үүсэх журнал (docs/dev/arap.md §5l). Өгөгдөл нь
// /api/cash/statements/preview-ийн ЗӨВХӨН энэ мөрийг агуулсан хүсэлт —
// saveBankStatement-ийн ЯГ ТЭР кодыг транзакц дотор ажиллуулж ROLLBACK хийдэг
// тул энд харсан = батлахад бичигдэх (клиент талд бичилт бодохгүй).

import { useEffect, useMemo, useState } from "react";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ParsedBankStatement, ParsedBankStatementRow } from "@/lib/cash/bank-statement-types";
import { PREVIEW_VOUCHER_LABELS, type BankStatementPreview } from "@/lib/cash/statement-preview";
import { col } from "@/lib/grid/columnTypes";

type GridRow = {
  id: string;
  voucher: string;
  accountNumber: string;
  mainAccount: string;
  accountName: string;
  debit: number;
  credit: number;
};

/** Мөр засагдах бүрд дахин асуухгүй — бичиж дуусахыг хүлээнэ. */
const DEBOUNCE_MS = 350;

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; preview: BankStatementPreview }
  | { status: "error"; message: string };

export function BankRowPreviewStrip({
  row,
  statement,
  cashAccountId,
  missing,
  onClose,
}: {
  row: ParsedBankStatementRow;
  statement: Omit<ParsedBankStatement, "rows">;
  cashAccountId: string;
  /** Мөр бэлэн биш бол шалтгаан (данс / харилцагч дутуу) — серверт асуухгүй. */
  missing: string | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<FetchState>({ status: "idle" });
  const requestBody = useMemo(
    () =>
      missing
        ? null
        : JSON.stringify({ ...statement, cashAccountId, rows: [{ ...row, rowNumber: row.rowNumber }] }),
    [missing, statement, cashAccountId, row]
  );

  useEffect(() => {
    if (!requestBody) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ status: "loading" });
      fetch("/api/cash/statements/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = (await response.json()) as BankStatementPreview & { error?: string };
          if (!response.ok || result.error)
            setState({ status: "error", message: result.error || "Бичилтийг урьдчилж бодож чадсангүй" });
          else setState({ status: "ready", preview: result });
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setState({ status: "error", message: "Бичилтийг урьдчилж бодож чадсангүй" });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestBody]);

  const preview = !missing && state.status === "ready" ? state.preview : null;
  const gridRows = useMemo<GridRow[]>(
    () =>
      (preview?.vouchers ?? []).flatMap((voucher, voucherIndex) =>
        voucher.lines.map((line, lineIndex) => ({
          id: `${voucherIndex}-${lineIndex}`,
          voucher:
            lineIndex === 0
              ? `${PREVIEW_VOUCHER_LABELS[voucher.kind]}${voucher.reference ? ` · ${voucher.reference}` : ""}`
              : "",
          accountNumber: line.accountNumber,
          mainAccount: line.mainAccount,
          accountName: line.accountName,
          debit: line.debit,
          credit: line.credit,
        }))
      ),
    [preview]
  );
  const pinnedBottom = useMemo<GridRow[]>(
    () => [
      {
        id: "total",
        voucher: "Нийт",
        accountNumber: "",
        mainAccount: "",
        accountName: "",
        debit: preview?.debitTotal ?? 0,
        credit: preview?.creditTotal ?? 0,
      },
    ],
    [preview]
  );
  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      { headerName: "Журнал", field: "voucher", width: 260 },
      {
        headerName: "Данс",
        field: "mainAccount",
        width: 110,
        cellClass: "font-mono",
        tooltipField: "accountNumber",
      },
      { headerName: "Дансны нэр", field: "accountName", flex: 1, minWidth: 160 },
      col<GridRow>({ eaType: "readonly-money", headerName: "Дебит", field: "debit", width: 140 }),
      col<GridRow>({ eaType: "readonly-money", headerName: "Кредит", field: "credit", width: 140 }),
    ],
    []
  );

  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface-raised)] p-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Icon name="journal" size="sm" className="text-[var(--ea-primary)]" />
        <span className="font-semibold text-[var(--ea-text-1)]">{row.rowNumber}-р мөрийн бичилт</span>
        <span className="min-w-0 max-w-80 truncate text-[var(--ea-text-3)]" title={row.description}>
          {row.description}
        </span>
        <span className="text-[var(--ea-text-4)]">· батлахад ингэж бичигдэнэ, одоогоор бичигдээгүй</span>
        {missing ? (
          <StatusBadge tone="warning" size="sm" icon="warning">
            {missing}
          </StatusBadge>
        ) : state.status === "error" ? (
          <StatusBadge tone="danger" size="sm" icon="error">
            {state.message}
          </StatusBadge>
        ) : preview ? (
          <StatusBadge tone={preview.balanced ? "success" : "danger"} size="sm" icon={preview.balanced ? "success" : "error"}>
            {preview.balanced ? "Дебит = Кредит" : "Тэнцээгүй"}
          </StatusBadge>
        ) : (
          <span className="text-[var(--ea-text-4)]">Бодож байна…</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6"
          title="Бичилтийг нуух — дээрх «Бичилт» товчоор буцааж асаана"
          aria-label="Бичилтийг нуух"
          onClick={onClose}
        >
          <Icon name="close" size="sm" />
        </Button>
      </div>
      {preview && (
        <DataGridDynamic<GridRow>
          rowData={gridRows}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          pinnedBottomRowData={pinnedBottom}
          height={Math.min(280, 96 + gridRows.length * 34)}
          suppressCellFocus
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        />
      )}
    </div>
  );
}

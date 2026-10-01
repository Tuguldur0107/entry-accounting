"use client";

// Хуулгын мөрөөр хаах нэхэмжлэх сонгох цонх (docs/dev/arap.md §5l) — «Бүртгэл»
// нүдний жижиг сонгогчийн оронд: дугаар, огноо, төлөх огноо, харилцагч, дүн,
// үлдэгдлийг бүтнээр нь харж, мөрийн дүнтэй тохирлоор эрэмбэлнэ. Бичилт
// өөрөө хийхгүй — сонголтыг onSelect-ээр буцааж, дуудагч applyBookingEdit-ээр
// мөрөнд холбоно. Хадгалах үед сервер үлдэгдлийг ДАХИН шалгана
// (lib/cash/import-statement.ts) — энд «Үлдэгдлээс их» нь урьдчилсан хориг.

import { useMemo, useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
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
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { FilterChips } from "@/components/ui/tabs";
import type { ParsedBankStatementRow } from "@/lib/cash/bank-statement-types";
import type { OpenInvoiceRef } from "@/lib/cash/statement-matching";
import { col } from "@/lib/grid/columnTypes";
import { fmtMnt } from "@/lib/reports/balances";

type Fit = "exact" | "partial" | "over";

const FIT_META: Record<Fit, { label: string; tone: StatusTone }> = {
  exact: { label: "Дүн таарсан", tone: "success" },
  partial: { label: "Хэсэгчлэн", tone: "muted" },
  over: { label: "Үлдэгдлээс их", tone: "warning" },
};
const FIT_RANK: Record<Fit, number> = { exact: 0, partial: 1, over: 2 };

type PickerRow = {
  id: string;
  documentNo: string;
  date: string;
  dueDate: string;
  counterpartyName: string;
  totalAmount: number;
  /** Энэ хуулгын БУСАД мөрөөр холбосон дүнг хассан үлдэгдэл. */
  available: number;
  fit: Fit;
  sameCounterparty: boolean;
};

function FitCell(params: ICellRendererParams<PickerRow>) {
  const fit = params.data?.fit;
  if (!fit) return null;
  return (
    <StatusBadge tone={FIT_META[fit].tone} size="sm">
      {FIT_META[fit].label}
    </StatusBadge>
  );
}

export function InvoicePickerDialog({
  row,
  invoices,
  linkedElsewhere,
  onSelect,
  onClose,
}: {
  row: ParsedBankStatementRow;
  /** Мөрийн чиглэл (АР/АП) ба валютаар аль хэдийн шүүсэн нээлттэй нэхэмжлэхүүд. */
  invoices: OpenInvoiceRef[];
  /** Нэхэмжлэх → энэ хуулгын бусад мөрөөр холбосон дүн. */
  linkedElsewhere: Map<string, number>;
  onSelect: (invoiceId: string | null) => void;
  onClose: () => void;
}) {
  const amount = row.income || row.expense;
  const isIncome = row.income > 0;
  const hasCounterparty = Boolean(row.counterpartyId);
  const [scope, setScope] = useState<"counterparty" | "all">(() =>
    hasCounterparty && invoices.some((item) => item.counterpartyId === row.counterpartyId)
      ? "counterparty"
      : "all"
  );
  const [query, setQuery] = useState("");

  const allRows = useMemo<PickerRow[]>(
    () =>
      invoices
        .map((item) => {
          const available =
            Math.round(
              (item.totalAmount - item.paidAmount - (linkedElsewhere.get(item.id) ?? 0)) * 100
            ) / 100;
          const fit: Fit =
            Math.abs(available - amount) <= 0.005
              ? "exact"
              : amount < available
                ? "partial"
                : "over";
          return {
            id: item.id,
            documentNo: item.documentNo,
            date: item.date ?? "",
            dueDate: item.dueDate ?? "",
            counterpartyName: item.counterpartyName,
            totalAmount: item.totalAmount,
            available,
            fit,
            sameCounterparty:
              hasCounterparty && item.counterpartyId === row.counterpartyId,
          };
        })
        .sort(
          (left, right) =>
            FIT_RANK[left.fit] - FIT_RANK[right.fit] ||
            Number(right.sameCounterparty) - Number(left.sameCounterparty) ||
            (left.dueDate || "9999").localeCompare(right.dueDate || "9999") ||
            left.documentNo.localeCompare(right.documentNo)
        ),
    [invoices, linkedElsewhere, amount, hasCounterparty, row.counterpartyId]
  );

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allRows.filter(
      (item) =>
        (scope === "all" || item.sameCounterparty) &&
        (!needle ||
          item.documentNo.toLowerCase().includes(needle) ||
          item.counterpartyName.toLowerCase().includes(needle) ||
          String(item.available).includes(needle.replace(/[,\s]/g, "")))
    );
  }, [allRows, scope, query]);

  const [selectedId, setSelectedId] = useState<string | null>(
    () =>
      row.settleInvoiceId ??
      allRows.find((item) => item.fit === "exact" && (!hasCounterparty || item.sameCounterparty))
        ?.id ??
      null
  );
  const selected = allRows.find((item) => item.id === selectedId) ?? null;
  const canApply = Boolean(selected && selected.fit !== "over");

  const columns = useMemo<ColDef<PickerRow>[]>(
    () => [
      col<PickerRow>({ eaType: "readonly-text", headerName: "Дугаар", field: "documentNo", width: 190, cellClass: "font-mono" }),
      col<PickerRow>({ eaType: "readonly-text", headerName: "Огноо", field: "date", width: 105, cellClass: "font-mono" }),
      col<PickerRow>({ eaType: "readonly-text", headerName: "Төлөх огноо", field: "dueDate", width: 125, cellClass: "font-mono" }),
      col<PickerRow>({ eaType: "readonly-text", headerName: "Харилцагч", field: "counterpartyName", flex: 1, minWidth: 160 }),
      col<PickerRow>({ eaType: "readonly-money", headerName: "Дүн", field: "totalAmount", width: 130 }),
      col<PickerRow>({ eaType: "readonly-money", headerName: "Үлдэгдэл", field: "available", width: 130 }),
      {
        headerName: "Тохирол",
        field: "fit",
        width: 120,
        sortable: false,
        cellRenderer: FitCell,
      },
    ],
    []
  );

  function apply(id: string | null) {
    onSelect(id);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{isIncome ? "Авлага хаах" : "Өглөг хаах"} — нэхэмжлэх сонгох</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{row.transactionDate}</span> ·{" "}
            <span className="font-mono font-medium text-[var(--ea-text-1)]">{fmtMnt(amount)}</span>
            {row.counterparty ? ` · ${row.counterparty}` : ""}
            {row.description ? ` · ${row.description}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Дугаар, харилцагч, үлдэгдлээр хайх"
            className="w-full sm:w-72"
          />
          {hasCounterparty && (
            <FilterChips
              value={scope}
              onChange={setScope}
              options={[
                {
                  value: "counterparty",
                  label: "Энэ харилцагч",
                  count: allRows.filter((item) => item.sameCounterparty).length,
                },
                { value: "all", label: "Бүгд", count: allRows.length },
              ]}
            />
          )}
        </div>

        {visibleRows.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--ea-border)] px-3 py-8 text-center text-sm text-[var(--ea-text-3)]">
            {allRows.length === 0
              ? `Хаах боломжтой нээлттэй ${isIncome ? "авлагын" : "өглөгийн"} нэхэмжлэх алга`
              : "Хайлтад таарах нэхэмжлэх алга"}
          </p>
        ) : (
          <DataGridDynamic<PickerRow>
            rowData={visibleRows}
            columnDefs={columns}
            getRowId={(params) => params.data.id}
            height={Math.min(440, 56 + visibleRows.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
            rowSelection={{
              mode: "singleRow",
              checkboxes: false,
              enableClickSelection: true,
              isRowSelectable: (node) => node.data?.fit !== "over",
            }}
            onFirstDataRendered={(event) => {
              if (selectedId) event.api.getRowNode(selectedId)?.setSelected(true);
            }}
            onRowDataUpdated={(event) => {
              if (selectedId) event.api.getRowNode(selectedId)?.setSelected(true);
            }}
            onSelectionChanged={(event) => {
              const picked = event.api.getSelectedRows()[0];
              if (picked) setSelectedId(picked.id);
            }}
            onRowDoubleClicked={(event) => {
              if (event.data && event.data.fit !== "over") apply(event.data.id);
            }}
          />
        )}

        <p className="text-xs text-[var(--ea-text-3)]">
          Үлдэгдэл нь энэ хуулгын бусад мөрөөр холбосон дүнг хассан. Мөрийн дүн үлдэгдлээс их бол
          хаахгүй — хэсэгчлэн хаах эсвэл урьдчилгаагаар бүртгэнэ. Давхар дарвал шууд холбоно.
        </p>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <div className="text-sm text-[var(--ea-text-2)]">
            {selected ? (
              <>
                <span className="font-mono font-medium text-[var(--ea-text-1)]">{selected.documentNo}</span>
                {" · үлдэгдэл "}
                <span className="font-mono">{fmtMnt(selected.available)}</span>
                {selected.fit !== "over" && (
                  <>
                    {" → хаасны дараа "}
                    <span className="font-mono">
                      {fmtMnt(Math.round((selected.available - amount) * 100) / 100)}
                    </span>
                  </>
                )}
              </>
            ) : (
              "Нэхэмжлэх сонгоогүй"
            )}
          </div>
          <div className="flex gap-2">
            {row.settleInvoiceId && (
              <Button variant="outline" onClick={() => apply(null)}>
                Холбоос цуцлах
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Болих
            </Button>
            <Button disabled={!canApply} onClick={() => selected && apply(selected.id)}>
              Хаах
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

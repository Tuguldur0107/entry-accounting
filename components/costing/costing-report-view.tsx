"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { TrendingDown } from "lucide-react";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
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
import { createNrvEntry } from "@/lib/actions/costing";
import type { TieOutRow, ValuationRow } from "@/lib/inventory/types";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

interface Props {
  valuation: ValuationRow[];
  tieOut: TieOutRow[];
}

// Үнэлгээний тайлан (батлагдсан бичилтээр qty × дундаж өртөг) + NRV нөөц +
// GL тулгалт. Мөр бүрийн NRV товч: цэвэр боломжит үнэ өгөхөд зорилтот
// нөөцийн зөрүүгээр бууруулалт/сэргээлтийн ноорог бичилт үүснэ.
export function CostingReportView({ valuation, tieOut }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [nrvRow, setNrvRow] = useState<ValuationRow | null>(null);
  const [nrvInput, setNrvInput] = useState("");
  const [nrvDate, setNrvDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );

  function submitNrv() {
    if (!nrvRow) return;
    const nrvPerUnit = Number(nrvInput.replaceAll(",", ""));
    if (!Number.isFinite(nrvPerUnit) || nrvPerUnit < 0) {
      toast.error("NRV 0 буюу түүнээс их тоо байна");
      return;
    }
    const target = nrvRow;
    startTransition(async () => {
      try {
        const result = await createNrvEntry({
          itemId: target.itemId,
          date: nrvDate,
          nrvPerUnit,
        });
        setNrvRow(null);
        router.refresh();
        toast.success(
          result.entryType === "nrv_writedown"
            ? `NRV бууруулалтын ноорог үүслээ — ${fmtMnt(result.amount)}`
            : `NRV сэргээлтийн ноорог үүслээ — ${fmtMnt(result.amount)}`
        );
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "NRV бичилт үүссэнгүй"
        );
      }
    });
  }

  const valuationColumns = useMemo<ColDef<ValuationRow>[]>(
    () => [
      { headerName: "Бараа", field: "itemLabel", minWidth: 220, flex: 1 },
      {
        headerName: "Үлдэгдэл",
        field: "quantity",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.data ? `${fmtQty(params.data.quantity)} ${params.data.unit}` : "",
      },
      {
        headerName: "Дундаж өртөг",
        field: "avgCost",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Үнэлгээ (өртөг)",
        field: "value",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "NRV нөөц",
        field: "nrvReserve",
        width: 130,
        headerClass: "ag-right-aligned-header",
        cellClass: (params) =>
          cn(
            "ag-right-aligned-cell font-mono",
            Number(params.value ?? 0) > 0 && "text-[var(--ea-warning-fg)]"
          ),
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Цэвэр дүн",
        field: "netValue",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "",
        colId: "nrv-action",
        width: 64,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-end",
        cellRenderer: (params: ICellRendererParams<ValuationRow>) => (
          <button
            type="button"
            className="ea-btn ea-btn--icon ea-btn--warning"
            title="NRV бууруулалт / сэргээлт"
            aria-label="NRV бууруулалт / сэргээлт"
            onClick={() => {
              const row = params.data;
              if (!row) return;
              setNrvInput("");
              setNrvRow(row);
            }}
          >
            <TrendingDown />
          </button>
        ),
      },
    ],
    []
  );

  const tieOutColumns = useMemo<ColDef<TieOutRow>[]>(
    () => [
      {
        headerName: "GL данс",
        colId: "account",
        minWidth: 220,
        flex: 1,
        valueGetter: (params) =>
          params.data
            ? `${params.data.accountNumber} ${params.data.accountName}`
            : "",
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Subledger (өртгийн бичилт)",
        field: "subledgerValue",
        width: 190,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "GL үлдэгдэл",
        field: "glBalance",
        width: 170,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Зөрүү",
        field: "difference",
        width: 150,
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

  const totalValue = valuation.reduce((sum, row) => sum + row.value, 0);
  const totalNet = valuation.reduce((sum, row) => sum + row.netValue, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Өртгийн тайлан
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Батлагдсан өртгийн бичилтээр — өртөг{" "}
          <span className="font-mono font-semibold">{fmtMnt(totalValue)}</span>
          {" · "}цэвэр (NRV нөөц хассан){" "}
          <span className="font-mono font-semibold">{fmtMnt(totalNet)}</span>
        </p>
      </div>

      <section className="min-w-0">
        <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
          Нөөцийн үнэлгээ (qty × дундаж өртөг)
        </h2>
        {valuation.length === 0 ? (
          <EmptyBox text="Батлагдсан өртгийн бичилт байхгүй" />
        ) : (
          <DataGridDynamic<ValuationRow>
            rowData={valuation}
            columnDefs={valuationColumns}
            getRowId={(params) => params.data.itemId}
            height={Math.min(480, 86 + valuation.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )}
      </section>

      <section className="min-w-0">
        <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
          GL тулгалт (14-бүлгийн данс)
        </h2>
        <p className="mb-2 text-[11px] text-[var(--ea-text-4)]">
          Subledger = батлагдсан өртгийн бичилтийн цэвэр дүн; GL = журналын
          үлдэгдэл. Зөрүү нь гараар бичсэн журнал эсвэл үнэлэгдээгүй хөдөлгөөнийг
          илтгэнэ.
        </p>
        {tieOut.length === 0 ? (
          <EmptyBox text="14-бүлгийн данс ашиглагдаагүй байна" />
        ) : (
          <DataGridDynamic<TieOutRow>
            rowData={tieOut}
            columnDefs={tieOutColumns}
            getRowId={(params) => params.data.accountNumber}
            height={Math.min(360, 86 + tieOut.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )}
      </section>

      {/* NRV dialog: IAS 2 — дундаж өртөг хэвээр, нөөцөөр бууруулна */}
      <Dialog open={!!nrvRow} onOpenChange={(o) => !o && setNrvRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>NRV — цэвэр боломжит үнэ</DialogTitle>
          </DialogHeader>
          {nrvRow && (
            <div className="grid gap-4">
              <p className="text-xs text-[var(--ea-text-3)]">
                <b>{nrvRow.itemLabel}</b> — үлдэгдэл{" "}
                <span className="font-mono">{nrvRow.quantity}</span> {nrvRow.unit},
                дундаж өртөг{" "}
                <span className="font-mono">{fmtMnt(nrvRow.avgCost)}</span>,
                одоогийн нөөц{" "}
                <span className="font-mono">{fmtMnt(nrvRow.nrvReserve)}</span>.
                NRV &lt; дундаж бол зөрүүгээр бууруулалт, өссөн бол өмнөх
                бууруулалтын хэмжээнд сэргээлт үүснэ.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Огноо">
                  <Input
                    type="date"
                    value={nrvDate}
                    onChange={(event) => setNrvDate(event.target.value)}
                  />
                </Field>
                <Field label="NRV / нэгж (MNT)">
                  <Input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={nrvInput}
                    placeholder="0.00"
                    autoFocus
                    onChange={(event) => setNrvInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitNrv();
                    }}
                  />
                </Field>
              </div>
              {Number(nrvInput) >= 0 && nrvInput.trim() !== "" && (
                <p className="rounded-md bg-[var(--ea-bg-2)] px-3 py-2 text-xs text-[var(--ea-text-2)]">
                  Зорилтот нөөц:{" "}
                  <span className="font-mono font-semibold">
                    {fmtMnt(
                      Math.round(
                        Math.max(0, nrvRow.avgCost - Number(nrvInput)) *
                          nrvRow.quantity *
                          100
                      ) / 100
                    )}
                  </span>{" "}
                  → зөрүү:{" "}
                  <span className="font-mono font-semibold">
                    {fmtMnt(
                      Math.round(
                        (Math.max(0, nrvRow.avgCost - Number(nrvInput)) *
                          nrvRow.quantity -
                          nrvRow.nrvReserve) *
                          100
                      ) / 100
                    )}
                  </span>
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNrvRow(null)}
              disabled={isPending}
            >
              Болих
            </Button>
            <Button
              onClick={submitNrv}
              disabled={isPending || nrvInput.trim() === ""}
            >
              Ноорог үүсгэх
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
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

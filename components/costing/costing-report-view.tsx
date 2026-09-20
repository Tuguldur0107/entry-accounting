"use client";

import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
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
import { FormField } from "@/components/ui/form-field";
import { EmptyState } from "@/components/ui/empty-state";
import { createNrvEntry } from "@/lib/actions/costing";
import type { ValuationRow } from "@/lib/inventory/types";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

interface Props {
  valuation: ValuationRow[];
}

// Нөөцийн үнэлгээ + NRV нөөц — сүүлийн тооцоологдсон сарын C2-оос
// (бараагаар нэгтгэсэн). Мөр бүрийн NRV товч: цэвэр боломжит үнэ өгөхөд
// зорилтот нөөцийн зөрүүгээр бууруулалт/сэргээлтийн ноорог бичилт үүснэ.
//
// GL тулгалт ЭНД БАЙХГҮЙ — тэр нь "Гүйлгээний дэлгэрэнгүй" табын
// loadInventoryGlReconciliation-д (огнооны мужаар) байдаг; хоёр газар
// хоёр өөр аргаар тулгах нь давхардал байсан.
export function CostingReportView({ valuation }: Props) {
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
        if (result.error !== undefined) {
          toast.error(result.error);
          return;
        }
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
            <Icon name="depreciation" />
          </button>
        ),
      },
    ],
    []
  );

  const totalValue = valuation.reduce((sum, row) => sum + row.value, 0);
  const totalNet = valuation.reduce((sum, row) => sum + row.netValue, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div>
        <p className="text-xs text-[var(--ea-text-3)]">
          Батлагдсан өртгийн бичилтээр — өртөг{" "}
          <span className="font-mono font-semibold">{fmtMnt(totalValue)}</span>
          {" · "}цэвэр (NRV нөөц хассан){" "}
          <span className="font-mono font-semibold">{fmtMnt(totalNet)}</span>
        </p>
      </div>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {valuation.length === 0 ? (
          <EmptyState icon="costing" title="Батлагдсан өртгийн бичилт байхгүй" />
        ) : (
          <DataGridDynamic<ValuationRow>
            rowData={valuation}
            columnDefs={valuationColumns}
            getRowId={(params) => params.data.itemId}
            height="flex"
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
                <FormField label="Огноо">
                  <Input
                    type="date"
                    value={nrvDate}
                    onChange={(event) => setNrvDate(event.target.value)}
                  />
                </FormField>
                <FormField label="NRV / нэгж (MNT)">
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
                </FormField>
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


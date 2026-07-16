"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { Pencil } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { AccountInput } from "@/components/account/account-input";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { buildSegCode } from "@/lib/grid/segments";
import { extractMainAccount } from "@/lib/reports/balances";
import { upsertCostingItemSetting } from "@/lib/actions/costing";
import {
  ADJUSTMENT_GAIN_ACCOUNT,
  ADJUSTMENT_LOSS_ACCOUNT,
  CLEARING_ACCOUNT,
} from "@/lib/costing/costing";

export type CostingSettingRow = {
  itemId: string;
  itemLabel: string;
  inventoryAccountNumber: string;
  cogsAccountNumber: string;
};

interface Props {
  rows: CostingSettingRow[];
  glAccounts: { number: string; name: string }[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
}

export function CostingSettingsView({
  rows,
  glAccounts,
  activeSegIds,
  segmentOptions,
  defaultSegments,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editRow, setEditRow] = useState<CostingSettingRow | null>(null);
  const [form, setForm] = useState({ inventory: "", cogs: "" });
  const [error, setError] = useState("");

  const glNameMap = useMemo(
    () => new Map(glAccounts.map((account) => [account.number, account.name])),
    [glAccounts]
  );
  const accountLabel = (number: string) =>
    `${number} ${glNameMap.get(number) ?? ""}`.trim();

  const columns = useMemo<ColDef<CostingSettingRow>[]>(
    () => [
      { headerName: "Бараа", field: "itemLabel", minWidth: 220, flex: 1 },
      {
        headerName: "Бараа материалын данс",
        field: "inventoryAccountNumber",
        minWidth: 220,
        flex: 1,
        valueGetter: (params) =>
          params.data ? accountLabel(params.data.inventoryAccountNumber) : "",
      },
      {
        headerName: "Өртгийн (COGS) данс",
        field: "cogsAccountNumber",
        minWidth: 220,
        flex: 1,
        valueGetter: (params) =>
          params.data ? accountLabel(params.data.cogsAccountNumber) : "",
      },
      {
        headerName: "",
        colId: "actions",
        width: 64,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-end",
        cellRenderer: (params: ICellRendererParams<CostingSettingRow>) => (
          <button
            type="button"
            className="ea-btn ea-btn--icon"
            title="Данс өөрчлөх"
            aria-label="Данс өөрчлөх"
            onClick={() => {
              const row = params.data;
              if (!row) return;
              setForm({
                inventory: buildSegCode(
                  { 3: row.inventoryAccountNumber },
                  activeSegIds,
                  defaultSegments
                ),
                cogs: buildSegCode(
                  { 3: row.cogsAccountNumber },
                  activeSegIds,
                  defaultSegments
                ),
              });
              setError("");
              setEditRow(row);
            }}
          >
            <Pencil />
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [glNameMap]
  );

  function save() {
    if (!editRow) return;
    setError("");
    startTransition(async () => {
      try {
        await upsertCostingItemSetting({
          itemId: editRow.itemId,
          // AccountInput бүтэн 10 хэсэгт код буцаадаг — үндсэн дансыг нь
          // хадгална (mapping нь main-түвшний).
          inventoryAccountNumber: extractMainAccount(form.inventory),
          cogsAccountNumber: extractMainAccount(form.cogs),
        });
        setEditRow(null);
        router.refresh();
        toast.success("Дансны тохиргоо хадгалагдлаа");
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Хадгалж чадсангүй"
        );
      }
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Өртгийн тохиргоо
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Бараа бүрийн GL дансны mapping — өртгийн журнал эдгээр дансаар бичигдэнэ.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-[11px] text-[var(--ea-text-3)]">
        <span className="rounded border border-[var(--ea-border)] px-2 py-1">
          Клиринг: <span className="font-mono">{CLEARING_ACCOUNT}</span>{" "}
          {glNameMap.get(CLEARING_ACCOUNT) ?? ""}
        </span>
        <span className="rounded border border-[var(--ea-border)] px-2 py-1">
          Тооллогын илүүдэл: <span className="font-mono">{ADJUSTMENT_GAIN_ACCOUNT}</span>
        </span>
        <span className="rounded border border-[var(--ea-border)] px-2 py-1">
          Тооллогын дутагдал: <span className="font-mono">{ADJUSTMENT_LOSS_ACCOUNT}</span>
        </span>
        <span className="rounded border border-[var(--ea-border)] px-2 py-1">
          Өртгийн арга: жигнэсэн дундаж
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-56 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Бараа бүртгээгүй байна — эхлээд Бараа материал модульд бараа нэмнэ
        </div>
      ) : (
        <DataGridDynamic<CostingSettingRow>
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.itemId}
          height={Math.min(640, 86 + rows.length * 38)}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editRow?.itemLabel} — дансны mapping</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Бараа материалын данс (14-бүлэг)</Label>
              <AccountInput
                value={form.inventory}
                onChange={(value) => setForm((c) => ({ ...c, inventory: value }))}
                activeSegIds={activeSegIds}
                segmentOptions={segmentOptions}
                defaultSegments={defaultSegments}
                placeholder="Бараа материалын данс..."
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Өртгийн (COGS) данс (6-бүлэг)</Label>
              <AccountInput
                value={form.cogs}
                onChange={(value) => setForm((c) => ({ ...c, cogs: value }))}
                activeSegIds={activeSegIds}
                segmentOptions={segmentOptions}
                defaultSegments={defaultSegments}
                placeholder="COGS данс..."
              />
            </div>
            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditRow(null)}
              disabled={isPending}
            >
              Болих
            </Button>
            <Button onClick={save} disabled={isPending}>
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

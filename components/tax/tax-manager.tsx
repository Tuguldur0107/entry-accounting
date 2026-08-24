"use client";

// Татвар бүрийн УДИРДЛАГЫН хэсэг: өглөгийн үлдэгдэл, дансны хуулга,
// төлөлт хийх (кассын панель — GL журнал автоматаар), тооцооны ноорог
// бичилт үүсгэх. Бичилт бүр одоо байгаа урсгалаараа явна: төлөлт →
// Мөнгөн хөрөнгө, тооцоо → GL ноорог журнал (human-in-the-loop §9).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CellDoubleClickedEvent, ColDef } from "ag-grid-community";
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
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTaxAccrualVoucher } from "@/lib/actions/tax";
import { fmtMnt, parseMntInput } from "@/lib/grid/formatters";
import {
  TaxOffsetButton,
  type TaxOffsetDefaults,
} from "@/components/tax/tax-offset-button";
import { openCashNewPanel, openVoucherPanel } from "@/lib/store/panel-store";
import type { TaxAccountBalance, TaxLedgerEntry } from "@/lib/tax/ledger";

const STATUS_LABELS: Record<string, string> = {
  posted: "Бичигдсэн",
  reversed: "Буцаагдсан",
};

export interface TaxManagerAccount extends TaxAccountBalance {
  /** credit — өглөгийн данс (Кт үлдэгдэл эерэг), debit — хөрөнгийн данс. */
  direction: "credit" | "debit";
  /** Картын гарчиг (default: "{main} {name}"). */
  label?: string;
}

export function TaxManager({
  accounts,
  entries,
  payment,
  accrual,
  offset,
}: {
  accounts: TaxManagerAccount[];
  entries: TaxLedgerEntry[];
  /** "Төлөлт хийх" — кассын зарлага, харилцах данс нь татварын өглөг. */
  payment: { counterMain: string; description: string; title?: string };
  /** "Тооцооны бичилт" товч — байвал Dr/Cr default данстай диалог гарна. */
  accrual?: {
    debitMain: string;
    creditMain: string;
    description: string;
  };
  /** "Тооцоо хаах" (суутган тооцоо) товч — байвал өглөг↔авлага хаалтын диалог. */
  offset?: TaxOffsetDefaults;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [accrualOpen, setAccrualOpen] = useState(false);
  const [accrualForm, setAccrualForm] = useState(() => ({
    // Локал огноо — UTC-ийн toISOString УБ-ын 00:00–08:00 цагт өчигдрийг өгдөг.
    date: new Date().toLocaleDateString("sv-SE"),
    amount: "",
    description: accrual?.description ?? "",
    debitMain: accrual?.debitMain ?? "",
    creditMain: accrual?.creditMain ?? "",
  }));
  const [accrualError, setAccrualError] = useState("");

  const columnDefs = useMemo<ColDef<TaxLedgerEntry>[]>(
    () => [
      { headerName: "Огноо", field: "date", width: 110 },
      { headerName: "Утга", field: "description", flex: 1, minWidth: 220 },
      { headerName: "Данс", field: "accountMain", width: 110 },
      {
        headerName: "Дебет",
        field: "debit",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => (params.value ? fmtMnt(params.value) : "–"),
      },
      {
        headerName: "Кредит",
        field: "credit",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => (params.value ? fmtMnt(params.value) : "–"),
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 110,
        valueFormatter: (params) => STATUS_LABELS[params.value] ?? params.value,
      },
    ],
    []
  );

  // Мөр дээр ДАВХАР дарахад журналын панель нээгдэнэ (grid-ийн гэрээ —
  // нэг даралт нь нүдний мужийн сонголтод үлдэнэ).
  function handleRowDoubleClick(event: CellDoubleClickedEvent<TaxLedgerEntry>) {
    if (event.data) openVoucherPanel(event.data.voucherId);
  }

  function submitAccrual() {
    setAccrualError("");
    startTransition(async () => {
      const result = await createTaxAccrualVoucher({
        date: accrualForm.date,
        amount: parseMntInput(accrualForm.amount),
        description: accrualForm.description,
        debitMain: accrualForm.debitMain,
        creditMain: accrualForm.creditMain,
      });
      if (result.error) {
        setAccrualError(result.error);
        return;
      }
      setAccrualOpen(false);
      toast.success(
        "Тооцооны ноорог журнал үүслээ — журналаас шалгаад батална уу"
      );
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
          Өр, төлөлтийн удирдлага
        </h2>
        <div className="flex gap-2">
          {offset ? <TaxOffsetButton offset={offset} /> : null}
          {accrual ? (
            <Button variant="outline" onClick={() => setAccrualOpen(true)}>
              <Icon name="addDocument" />
              Тооцооны бичилт
            </Button>
          ) : null}
          <Button
            onClick={() =>
              openCashNewPanel({
                taxPayment: {
                  counterAccountNumber: payment.counterMain,
                  description: payment.description,
                  title: payment.title,
                },
              })
            }
          >
            <Icon name="cash" />
            Төлөлт хийх
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((account) => {
          const shown =
            account.direction === "credit" ? -account.balance : account.balance;
          return (
            <div
              key={account.main}
              className="rounded-lg border p-4"
              style={{
                borderColor: "var(--ea-border)",
                background: "var(--ea-surface)",
              }}
            >
              <div className="text-xs" style={{ color: "var(--ea-text-3)" }}>
                {account.label ??
                  `${account.main}${account.name ? ` · ${account.name}` : ""}`}
              </div>
              <div className="mt-1 font-mono text-xl font-semibold text-[var(--ea-text-1)]">
                {fmtMnt(shown)}₮
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--ea-text-3)" }}>
                {account.direction === "credit"
                  ? shown >= 0
                    ? "Төлөх үлдэгдэл"
                    : "Илүү төлөлт / урьдчилгаа"
                  : "Авлагын үлдэгдэл"}
              </div>
            </div>
          );
        })}
      </div>

      {entries.length === 0 ? (
        <p className="rounded-md border border-[var(--ea-border)] px-3 py-8 text-center text-xs text-[var(--ea-text-3)]">
          Энэ дансаар бичилт алга — тооцооны бичилт эсвэл төлөлт хийхэд энд
          харагдана.
        </p>
      ) : (
        <DataGridDynamic<TaxLedgerEntry>
          rowData={entries}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.lineId}
          onCellDoubleClicked={handleRowDoubleClick}
          height={320}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}

      <Dialog open={accrualOpen} onOpenChange={setAccrualOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Татварын тооцооны бичилт (ноорог)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tax-accrual-date">Огноо</Label>
                <Input
                  id="tax-accrual-date"
                  type="date"
                  value={accrualForm.date}
                  onChange={(event) =>
                    setAccrualForm((f) => ({ ...f, date: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tax-accrual-amount">Дүн (₮)</Label>
                <Input
                  id="tax-accrual-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={accrualForm.amount}
                  onChange={(event) =>
                    setAccrualForm((f) => ({ ...f, amount: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tax-accrual-debit">Дебет данс (зардал)</Label>
                <Input
                  id="tax-accrual-debit"
                  placeholder="7XXXXXXX"
                  value={accrualForm.debitMain}
                  onChange={(event) =>
                    setAccrualForm((f) => ({
                      ...f,
                      debitMain: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tax-accrual-credit">Кредит данс (өглөг)</Label>
                <Input
                  id="tax-accrual-credit"
                  placeholder="3XXXXXXX"
                  value={accrualForm.creditMain}
                  onChange={(event) =>
                    setAccrualForm((f) => ({
                      ...f,
                      creditMain: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tax-accrual-description">Гүйлгээний утга</Label>
              <Input
                id="tax-accrual-description"
                value={accrualForm.description}
                onChange={(event) =>
                  setAccrualForm((f) => ({
                    ...f,
                    description: event.target.value,
                  }))
                }
              />
            </div>
            <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
              НООРОГ журнал үүснэ — журналын жагсаалтаас шалгаад батална.
            </p>
            {accrualError ? (
              <p className="text-xs" style={{ color: "var(--ea-danger-fg)" }}>
                {accrualError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccrualOpen(false)}>
              Болих
            </Button>
            <Button onClick={submitAccrual} disabled={isPending}>
              {isPending ? "Үүсгэж байна…" : "Ноорог үүсгэх"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

"use client";

// Бэлгийн карт · дэлгүүрийн кредит (таб) — docs/pos §3.4 gift_card /
// store_credit. Карт ЗАРАХ = орлого биш (Dr касс / Cr бэлгийн картын өглөг) —
// `issueGiftCard`; кредит буцаалтаас үүсдэг тул энд зөвхөн харагдана.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { toast } from "sonner";

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
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { issueGiftCard } from "@/lib/actions/pos";
import type { CheckoutCustomer } from "@/lib/pos/load-data";
import { PAYMENT_KINDS_WITH_CASH_ACCOUNT } from "@/lib/pos/constants";
import type { PaymentMethodView } from "@/lib/pos/types";
import { fmtMnt } from "@/lib/reports/balances";

export interface GiftCardRow {
  id: string;
  code: string;
  initialAmount: number;
  balance: number;
  status: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface StoreCreditRow {
  id: string;
  counterpartyName: string;
  amount: number;
  balance: number;
  status: string;
  createdAt: string;
}

const CARD_STATUS_LABELS: Record<string, string> = {
  active: "Идэвхтэй",
  used: "Ашигласан",
  expired: "Хугацаа дууссан",
  cancelled: "Цуцалсан",
};
const CARD_STATUS_TONES: Record<string, StatusTone> = {
  active: "success",
  used: "muted",
  expired: "warning",
  cancelled: "danger",
};

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function statusCell<T extends { status: string }>(p: ICellRendererParams<T>) {
  if (!p.data) return null;
  return (
    <span className="flex h-full items-center">
      <StatusBadge tone={CARD_STATUS_TONES[p.data.status] ?? "muted"} size="sm">
        {CARD_STATUS_LABELS[p.data.status] ?? p.data.status}
      </StatusBadge>
    </span>
  );
}

export function GiftCardsView({
  giftCards,
  storeCredits,
  methods,
  customers,
}: {
  giftCards: GiftCardRow[];
  storeCredits: StoreCreditRow[];
  methods: PaymentMethodView[];
  customers: CheckoutCustomer[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  const cardColumns = useMemo<ColDef<GiftCardRow>[]>(
    () => [
      { headerName: "Код", field: "code", width: 160, cellClass: "font-mono text-xs" },
      {
        headerName: "Анхны дүн",
        field: "initialAmount",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
      },
      {
        headerName: "Үлдэгдэл",
        field: "balance",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
      },
      {
        headerName: "Хүчинтэй хугацаа",
        field: "expiresAt",
        width: 140,
        cellClass: "font-mono text-xs",
        valueFormatter: (p) => fmtDate(p.value as string | null) || "—",
      },
      {
        headerName: "Зарсан",
        field: "createdAt",
        width: 120,
        cellClass: "font-mono text-xs",
        valueFormatter: (p) => fmtDate(String(p.value ?? "")),
      },
      {
        headerName: "Статус",
        field: "status",
        width: 130,
        flex: 1,
        valueGetter: (p) => (p.data ? CARD_STATUS_LABELS[p.data.status] ?? p.data.status : ""),
        cellRenderer: statusCell<GiftCardRow>,
      },
    ],
    []
  );

  const creditColumns = useMemo<ColDef<StoreCreditRow>[]>(
    () => [
      { headerName: "Харилцагч", field: "counterpartyName", minWidth: 180, flex: 1 },
      {
        headerName: "Дүн",
        field: "amount",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
      },
      {
        headerName: "Үлдэгдэл",
        field: "balance",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
      },
      {
        headerName: "Үүссэн",
        field: "createdAt",
        width: 120,
        cellClass: "font-mono text-xs",
        valueFormatter: (p) => fmtDate(String(p.value ?? "")),
      },
      {
        headerName: "Статус",
        field: "status",
        width: 130,
        valueGetter: (p) => (p.data ? CARD_STATUS_LABELS[p.data.status] ?? p.data.status : ""),
        cellRenderer: statusCell<StoreCreditRow>,
      },
    ],
    []
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--ea-text-1)]">Бэлгийн карт</div>
          <Button onClick={() => setDialogOpen(true)}>
            <Icon name="add" size="sm" />
            Бэлгийн карт зарах
          </Button>
        </div>
        {giftCards.length === 0 ? (
          <EmptyState
            icon="key"
            title="Бэлгийн карт зараагүй"
            description="Карт зарахад орлого биш, бэлгийн картын өглөг бүртгэгдэнэ; ашиглахад борлуулалтын төлбөр болно."
          />
        ) : (
          <DataGridDynamic<GiftCardRow>
            rowData={giftCards}
            columnDefs={cardColumns}
            getRowId={(params) => params.data.id}
            height={Math.min(420, 120 + giftCards.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )}
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">Дэлгүүрийн кредит</div>
        {storeCredits.length === 0 ? (
          <EmptyState
            icon="reconciliation"
            title="Дэлгүүрийн кредит алга"
            description="Буцаалтад «Дэлгүүрийн кредит» сонгоход харилцагчийн кредит үүснэ."
          />
        ) : (
          <DataGridDynamic<StoreCreditRow>
            rowData={storeCredits}
            columnDefs={creditColumns}
            getRowId={(params) => params.data.id}
            height={Math.min(420, 120 + storeCredits.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )}
      </div>

      <IssueGiftCardDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        methods={methods}
        customers={customers}
        onDone={() => router.refresh()}
      />
    </div>
  );
}

function IssueGiftCardDialog({
  open,
  onOpenChange,
  methods,
  customers,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  methods: PaymentMethodView[];
  customers: CheckoutCustomer[];
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const receivingMethods = useMemo(
    () =>
      methods
        .filter((method) => method.isActive && PAYMENT_KINDS_WITH_CASH_ACCOUNT.includes(method.kind))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [methods]
  );
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState("");
  const [reference, setReference] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const customerOptions = useMemo(
    () =>
      customers
        .filter((customer) => !customer.isWalkIn)
        .map((customer) => ({ value: customer.id, label: customer.name })),
    [customers]
  );

  function submit() {
    if (!code.trim()) return toast.error("Картын код оруулна уу");
    if (!(Number(amount) > 0)) return toast.error("Дүн 0-ээс их");
    if (!methodId) return toast.error("Төлбөрийн хэлбэр сонгоно уу");
    startTransition(async () => {
      const result = await issueGiftCard({
        code: code.trim(),
        amount: Number(amount),
        paymentMethodId: methodId,
        reference: reference.trim() || null,
        counterpartyId: counterpartyId || null,
        expiresAt: expiresAt || null,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${code.trim().toUpperCase()} бэлгийн карт зарагдлаа`);
      setCode("");
      setAmount("");
      setReference("");
      setCounterpartyId("");
      setExpiresAt("");
      onOpenChange(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Бэлгийн карт зарах</DialogTitle>
          <DialogDescription>
            Dr касс/банк · Cr бэлгийн картын өглөг — орлого биш, НӨАТ ашиглах үед.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Картын код</Label>
            <Input value={code} autoFocus className="font-mono uppercase" onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Дүн (₮)</Label>
            <Input type="number" min="0" value={amount} className="font-mono text-right" onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Төлбөрийн хэлбэр</Label>
            <select className="ea-form-select" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              <option value="">— Сонгох —</option>
              {receivingMethods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Лавлах</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Харилцагч (сонголтоор)</Label>
            <SearchableSelect
              value={counterpartyId}
              onChange={setCounterpartyId}
              options={customerOptions}
              hideValue
              placeholder="— Хамааралгүй —"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Хүчинтэй хугацаа</Label>
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Болих
          </Button>
          <Button onClick={submit} disabled={isPending}>
            <Icon name="approve" size="sm" />
            Зарах
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

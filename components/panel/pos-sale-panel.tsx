"use client";

// POS борлуулалтын ПАНЕЛЬ — docs/pos §4.3: мөр, хөнгөлөлтийн задаргаа, төлбөр,
// холбоос (АР / журнал / буцаалт), [Буцаалт] [Дахин хэвлэх] [Хавсралт],
// eBarimt талбар inline засах (v1 гараар — §3.11).
// Payload: { saleId: string }. Хэв маяг goods-receipt-panel.tsx-тэй ИЖИЛ.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef } from "ag-grid-community";
import { toast } from "sonner";

import { AttachmentSection } from "@/components/attachments/attachment-section";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { PanelError, PanelLoading } from "@/components/panel/panel-states";
import { ReceiptPreview } from "@/components/pos/receipt-preview";
import { EBARIMT_STATUS_TONES, SALE_STATUS_TONES } from "@/components/pos/sales-list-view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { getEbarimtSubmissions, resendEbarimt } from "@/lib/actions/ebarimt";
import {
  getPaymentMethods,
  getPosReceipt,
  getPosSaleDetail,
  returnPosSale,
  updateSaleEbarimt,
  type PosReceipt,
} from "@/lib/actions/pos";
import { GENERIC_ATTACHMENT_KINDS } from "@/lib/attachments/constants";
import { EBARIMT_STATUS_LABELS, type EbarimtStatus } from "@/lib/ebarimt/constants";
import type { EbarimtSubmissionView } from "@/lib/ebarimt/types";
import { PAYMENT_KIND_LABELS, POS_BUSINESS_OBJECT, SALE_STATUS_LABELS } from "@/lib/pos/constants";
import type { PaymentInput, PaymentMethodView, PosSaleDetail, SaleLineView } from "@/lib/pos/types";
import { fmtMnt } from "@/lib/reports/balances";
import {
  openArapDocPanel,
  openPosSalePanel,
  openVoucherPanel,
  refreshOpenPanels,
  usePanelStore,
  type PanelInstance,
} from "@/lib/store/panel-store";
import { feedback } from "@/lib/ui/feedback";

const round2 = (value: number) => Math.round(value * 100) / 100;
const fmtQty = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 4 });
const fmtTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" }).slice(0, 16);
};

export function PosSalePanel({
  panel,
  requestClose,
}: {
  panel: PanelInstance;
  requestClose: () => void;
}) {
  const setTitle = usePanelStore((state) => state.setTitle);
  const saleId = panel.payload.saleId as string;
  const refreshToken = panel.refreshToken;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; sale: PosSaleDetail; loadedToken: number }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getPosSaleDetail(saleId)
      .then((result) => {
        if (cancelled) return;
        if (result.error || !result.sale) {
          setState({ status: "error", message: result.error ?? "Борлуулалт олдсонгүй" });
          return;
        }
        setState({ status: "ready", sale: result.sale, loadedToken: refreshToken });
        setTitle(panel.id, `${result.sale.documentNo} · ${result.sale.counterpartyName}`);
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Ачаалж чадсангүй. Дахин оролдоно уу." });
      });
    return () => {
      cancelled = true;
    };
  }, [saleId, refreshToken, panel.id, setTitle]);

  if (state.status === "loading") return <PanelLoading />;
  if (state.status === "error") return <PanelError message={state.message} />;
  return <PosSaleBody key={state.loadedToken} panel={panel} sale={state.sale} requestClose={requestClose} />;
}

function PosSaleBody({
  panel,
  sale,
  requestClose,
}: {
  panel: PanelInstance;
  sale: PosSaleDetail;
  requestClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<PosReceipt | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  /** Буцаалтын диалогийг нээх бүрд remount (форм цэвэр эхэлнэ). */
  const [returnSession, setReturnSession] = useState(0);

  const returnableQty = sale.lines.reduce((sum, line) => sum + Math.max(0, line.quantity - line.returnedQty), 0);
  const canReturn = !sale.isReturn && sale.status !== "voided" && returnableQty > 0;

  const columns = useMemo<ColDef<SaleLineView>[]>(
    () => [
      {
        headerName: "Бараа",
        colId: "item",
        minWidth: 180,
        flex: 1,
        valueGetter: (p) => (p.data ? `${p.data.itemCode} · ${p.data.itemName}` : ""),
      },
      {
        headerName: "Тоо",
        field: "quantity",
        width: 84,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => `${fmtQty(Number(p.value ?? 0))}${p.data?.unit ? ` ${p.data.unit}` : ""}`,
      },
      {
        headerName: "Үнэ",
        field: "unitPrice",
        width: 110,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
      },
      {
        headerName: "Хөнгөлөлт",
        field: "discountAmount",
        width: 110,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => (Number(p.value) > 0 ? `−${fmtMnt(Number(p.value))}` : ""),
        tooltipValueGetter: (p) =>
          p.data?.discountDetail.length
            ? p.data.discountDetail.map((d) => `${d.ruleCode ?? d.kind}: ${fmtMnt(d.amount)}`).join(" · ")
            : null,
      },
      {
        headerName: "Цэвэр",
        field: "netAmount",
        width: 110,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
      },
      {
        headerName: "НӨАТ",
        field: "vatAmount",
        width: 96,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => (Number(p.value) > 0 ? fmtMnt(Number(p.value)) : ""),
      },
      {
        headerName: "Нийт",
        field: "lineTotal",
        width: 120,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
      },
      {
        headerName: "Буцаасан",
        field: "returnedQty",
        width: 96,
        cellClass: (p) => `ag-right-aligned-cell font-mono text-xs${Number(p.value) > 0 ? " text-[var(--ea-warning-fg)]" : ""}`,
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => (Number(p.value) > 0 ? fmtQty(Number(p.value)) : ""),
      },
      {
        headerName: "Урьдчилсан COGS",
        field: "provisionalCost",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono text-xs text-[var(--ea-text-3)]",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => (p.value == null ? "өртөг хүлээж байна" : fmtMnt(Number(p.value))),
      },
    ],
    []
  );

  function reprint() {
    startTransition(async () => {
      const result = await getPosReceipt(sale.id);
      if (result.error || !result.receipt) {
        toast.error(result.error ?? "Баримт уншигдсангүй");
        return;
      }
      setReceipt(result.receipt);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={SALE_STATUS_TONES[sale.status] ?? "muted"}>
          {SALE_STATUS_LABELS[sale.status] ?? sale.status}
        </StatusBadge>
        {sale.isReturn && <StatusBadge tone="warning">Буцаалт</StatusBadge>}
        <span className="font-mono text-xs font-semibold text-[var(--ea-text-1)]">{sale.documentNo}</span>
        <span className="text-xs text-[var(--ea-text-3)]">{fmtTime(sale.soldAt)}</span>
        {sale.originalSaleId && (
          <Button variant="outline" size="sm" onClick={() => openPosSalePanel(sale.originalSaleId!, sale.originalSaleNo ?? undefined)}>
            <Icon name="openDetail" size="sm" />
            Эх борлуулалт {sale.originalSaleNo}
          </Button>
        )}
      </div>

      <div className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Ээлж" value={sale.shiftNo ?? "—"} mono />
        <Fact label="Кассчин" value={sale.cashierName || "—"} />
        <Fact label="Харилцагч" value={sale.counterpartyName} />
        <Fact label="Агуулах" value={sale.warehouseName} />
        <Fact label="АР баримт" value={sale.arApDocumentNo ?? "—"} mono />
        {sale.returnReason && <Fact label="Буцаалтын шалтгаан" value={sale.returnReason} />}
        {sale.note && <Fact label="Тэмдэглэл" value={sale.note} />}
      </div>

      <EbarimtSection sale={sale} />

      <div>
        <div className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">Мөрүүд</div>
        <DataGridDynamic<SaleLineView>
          rowData={sale.lines}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height={Math.min(360, 100 + sale.lines.length * 38)}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
        <div className="mt-2 grid gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
          <TotalRow label="Нийт (хөнг. өмнө)" value={fmtMnt(sale.grossAmount)} />
          <TotalRow label="Хөнгөлөлт" value={sale.discountTotal > 0 ? `−${fmtMnt(sale.discountTotal)}` : "0"} />
          <TotalRow label="Цэвэр дүн" value={fmtMnt(sale.netAmount)} />
          <TotalRow label="НӨАТ" value={fmtMnt(sale.vatAmount)} />
          {sale.roundingAmount !== 0 && <TotalRow label="Бөөрөнхийлөл" value={fmtMnt(sale.roundingAmount)} />}
          <TotalRow label="Төлөх" value={fmtMnt(sale.total)} strong />
        </div>
      </div>

      {sale.discounts.length > 0 && (
        <div>
          <div className="mb-1 text-sm font-semibold text-[var(--ea-text-1)]">Баримтын хөнгөлөлт</div>
          <ul className="text-xs">
            {sale.discounts.map((discount) => (
              <li key={discount.id} className="flex justify-between border-b border-[var(--ea-border)] py-0.5">
                <span>
                  {discount.ruleCode ?? discount.kind}
                  {discount.note && <span className="ml-1 text-[var(--ea-text-3)]">— {discount.note}</span>}
                </span>
                <span className="font-mono">−{fmtMnt(discount.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-1 text-sm font-semibold text-[var(--ea-text-1)]">Төлбөр</div>
        {sale.payments.length === 0 ? (
          <p className="text-xs text-[var(--ea-text-3)]">Төлбөргүй (зээлээр — АР нээлттэй)</p>
        ) : (
          <ul className="text-xs">
            {sale.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ea-border)] py-1">
                <span>
                  {payment.methodName}
                  <span className="ml-1 text-[var(--ea-text-3)]">{PAYMENT_KIND_LABELS[payment.kind]}</span>
                  {payment.reference && <span className="ml-1 font-mono text-[var(--ea-text-3)]">#{payment.reference}</span>}
                </span>
                <span className="flex items-center gap-2 font-mono">
                  {payment.currency !== "MNT" && (
                    <span className="text-[var(--ea-text-3)]">
                      {payment.amount.toLocaleString("en-US")} {payment.currency} × {payment.exchangeRate}
                    </span>
                  )}
                  <span>{fmtMnt(payment.baseAmount - payment.changeGiven)}</span>
                  {payment.changeGiven > 0 && <span className="text-[var(--ea-text-3)]">(хариулт {fmtMnt(payment.changeGiven)})</span>}
                  {payment.voucherId && (
                    <IconAction name="journal" label="Журнал" size="xs" onClick={() => openVoucherPanel(payment.voucherId!)} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {sale.returns.length > 0 && (
        <div>
          <div className="mb-1 text-sm font-semibold text-[var(--ea-text-1)]">Буцаалтууд</div>
          <ul className="text-xs">
            {sale.returns.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between border-b border-[var(--ea-border)] py-1">
                <button type="button" className="ea-btn" onClick={() => openPosSalePanel(entry.id, entry.documentNo)}>
                  <Icon name="openDetail" size="xs" />
                  {entry.documentNo} · {entry.date}
                </button>
                <span className="font-mono">{fmtMnt(entry.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {sale.arApDocumentId && (
          <Button variant="outline" size="sm" onClick={() => openArapDocPanel({ documentId: sale.arApDocumentId!, mode: "receivable" })}>
            <Icon name="document" size="sm" />
            АР баримт {sale.arApDocumentNo}
          </Button>
        )}
        {sale.voucherIds.map((voucherId, index) => (
          <Button key={voucherId} variant="outline" size="sm" onClick={() => openVoucherPanel(voucherId)}>
            <Icon name="journal" size="sm" />
            Журнал {index + 1}
          </Button>
        ))}
      </div>

      <AttachmentSection
        entityType={POS_BUSINESS_OBJECT}
        entityId={sale.id}
        kinds={GENERIC_ATTACHMENT_KINDS}
        refreshToken={panel.refreshToken}
        onChanged={() => {
          refreshOpenPanels();
          router.refresh();
        }}
      />

      <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-[var(--ea-border)] pt-3">
        <Button variant="outline" onClick={requestClose} disabled={isPending}>
          Хаах
        </Button>
        <Button variant="outline" onClick={reprint} disabled={isPending}>
          <Icon name="print" size="sm" />
          Дахин хэвлэх
        </Button>
        {canReturn && (
          <Button
            onClick={() => {
              setReturnSession((value) => value + 1);
              setReturnOpen(true);
            }}
            disabled={isPending}
          >
            <Icon name="reset" size="sm" />
            Буцаалт
          </Button>
        )}
      </div>

      <ReceiptPreview receipt={receipt} onClose={() => setReceipt(null)} />
      <ReturnDialog
        key={returnSession}
        sale={sale}
        open={returnOpen}
        onOpenChange={setReturnOpen}
        onDone={() => {
          refreshOpenPanels();
          router.refresh();
        }}
      />
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2 border-b border-[var(--ea-border)] py-0.5">
      <span className="text-[var(--ea-text-3)]">{label}</span>
      <span className={`truncate text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

// ── eBarimt (docs/pos/03-ebarimt-integration-plan.md §4.5) ───────────────────
//
// Статус, ТЕГ-ийн хариу (ДДТД / сугалаа / огноо / төрөл), худалдан авагч,
// [Дахин илгээх] (failed/pending), илгээлтийн түүх. Гараар ДДТД засах нь
// ЗӨВХӨН илгээгдээгүй (sent биш) баримтад — server ч мөн хориглодог.

function EbarimtSection({ sale }: { sale: PosSaleDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [ebarimtId, setEbarimtId] = useState(sale.ebarimtId ?? "");
  const [submissions, setSubmissions] = useState<EbarimtSubmissionView[]>([]);

  const status = sale.ebarimtStatus;
  const isSent = status === "sent";
  const isSkipped = status === "skipped";
  const canResend = status === "failed" || status === "pending" || isSkipped;

  useEffect(() => {
    if (!status) return;
    let cancelled = false;
    getEbarimtSubmissions(sale.id).then((result) => {
      if (cancelled || result.error || !result.submissions) return;
      setSubmissions(result.submissions.slice(0, 5));
    });
    return () => {
      cancelled = true;
    };
  }, [sale.id, status]);

  function saveEbarimt() {
    startTransition(async () => {
      const result = await updateSaleEbarimt(sale.id, { ebarimtId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("eBarimt мэдээлэл хадгалагдлаа");
      setEditing(false);
      refreshOpenPanels();
      router.refresh();
    });
  }

  function resend() {
    startTransition(async () => {
      const result = await resendEbarimt(sale.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.status === "sent" ? "ТЕГ-д илгээгдлээ" : "Илгээх дараалалд орлоо"
      );
      refreshOpenPanels();
      router.refresh();
    });
  }

  const buyer = sale.ebarimtCustomerTin
    ? `Байгууллага · ТТД ${sale.ebarimtCustomerTin}`
    : sale.ebarimtConsumerNo
      ? `Иргэн · ${sale.ebarimtConsumerNo}`
      : "Иргэн (дугааргүй)";

  return (
    <div className="rounded-md border border-[var(--ea-border)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[var(--ea-text-1)]">eBarimt</span>
          {status && (
            <StatusBadge tone={EBARIMT_STATUS_TONES[status] ?? "muted"} size="sm">
              {EBARIMT_STATUS_LABELS[status as EbarimtStatus] ?? status}
            </StatusBadge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {canResend && (
            <Button size="sm" variant="outline" onClick={resend} disabled={isPending}>
              <Icon name="send" size="sm" />
              {isSkipped ? "eBarimt илгээх" : "Дахин илгээх"}
            </Button>
          )}
          {!editing && !isSent && !sale.isReturn && (
            <IconAction name="edit" label="eBarimt засах" size="sm" onClick={() => setEditing(true)} />
          )}
        </div>
      </div>

      {editing ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input value={ebarimtId} placeholder="ДДТД" className="font-mono" onChange={(e) => setEbarimtId(e.target.value)} />
          <div className="flex gap-1">
            <Button size="sm" onClick={saveEbarimt} disabled={isPending}>
              Хадгалах
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={isPending}>
              Болих
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <Fact label="ДДТД" value={sale.ebarimtId ?? "—"} mono />
          <Fact label="Баримтын огноо" value={sale.ebarimtDate ?? "—"} mono />
          <Fact label="Төрөл" value={sale.ebarimtType ?? "—"} mono />
          <Fact label="Худалдан авагч" value={buyer} />
        </div>
      )}

      {!editing && !sale.ebarimtId && !sale.isReturn && !status && (
        <p className="mt-1 text-xs text-[var(--ea-warning-fg)]">
          ТЕГ-ийн апп-аар олгоод ДДТД-г бичнэ үү (eBarimt автомат илгээлт унтраалттай)
        </p>
      )}

      {submissions.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-[var(--ea-text-1)]">Илгээлтийн түүх</div>
          <ul className="space-y-0.5 text-[11px] text-[var(--ea-text-3)]">
            {submissions.map((submission) => (
              <li key={submission.id} className="flex flex-wrap items-center gap-x-2">
                <span className="font-mono">
                  {submission.kind === "cancel" ? "цуцлах" : "баримт"}
                </span>
                <StatusBadge tone={EBARIMT_STATUS_TONES[submission.status] ?? "muted"} size="sm">
                  {EBARIMT_STATUS_LABELS[submission.status as EbarimtStatus] ?? submission.status}
                </StatusBadge>
                <span>оролдлого {submission.attempts}</span>
                {submission.sentAt && <span className="font-mono">{fmtTime(submission.sentAt)}</span>}
                {submission.lastError && (
                  <span className="text-[var(--ea-danger-fg)]">{submission.lastError}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-[var(--ea-text-1)]" : ""}`}>
      <span className="text-[var(--ea-text-3)]">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

// ── Буцаалтын диалог (§3.6) ──────────────────────────────────────────────────

interface RefundRow {
  key: number;
  paymentMethodId: string;
  amount: string;
  reference: string;
}

function ReturnDialog({
  sale,
  open,
  onOpenChange,
  onDone,
}: {
  sale: PosSaleDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [storeCredit, setStoreCredit] = useState(false);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [seq, setSeq] = useState(1);
  const [methods, setMethods] = useState<PaymentMethodView[] | null>(null);

  const isWalkIn = sale.isWalkIn;

  // Нээх бүрд эцэг `key`-ээр remount хийдэг тул форм цэвэр; хэлбэрүүдийг л татна.
  useEffect(() => {
    if (!open || methods !== null) return;
    let cancelled = false;
    getPaymentMethods().then((result) => {
      if (cancelled) return;
      if (result.error) {
        toast.error(result.error);
        setMethods([]);
      } else setMethods(result.methods ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, methods]);

  const refundMethods = useMemo(
    () => (methods ?? []).filter((method) => method.isActive && method.allowsRefund).sort((a, b) => a.sortOrder - b.sortOrder),
    [methods]
  );
  const methodById = useMemo(() => new Map((methods ?? []).map((m) => [m.id, m])), [methods]);

  const refundTotal = useMemo(
    () =>
      round2(
        sale.lines.reduce((sum, line) => {
          const qty = Number(quantities[line.id] ?? 0);
          if (!(qty > 0) || !(line.quantity > 0)) return sum;
          return sum + (line.lineTotal * qty) / line.quantity;
        }, 0)
      ),
    [sale.lines, quantities]
  );

  const refundSum = round2(
    refunds.reduce((sum, row) => {
      const method = methodById.get(row.paymentMethodId);
      const rate = method && method.currency !== "MNT" ? 0 : 1;
      return sum + (Number(row.amount) || 0) * rate;
    }, 0)
  );
  const hasFxRefund = refunds.some((row) => (methodById.get(row.paymentMethodId)?.currency ?? "MNT") !== "MNT");
  const sumMatches = storeCredit || hasFxRefund || Math.abs(refundSum - refundTotal) < 0.005;

  function submit() {
    const lines = sale.lines
      .map((line) => ({ lineId: line.id, quantity: Number(quantities[line.id] ?? 0) }))
      .filter((line) => line.quantity > 0);
    if (lines.length === 0) return toast.error("Буцаах тоо оруулна уу");
    if (!reason.trim()) return toast.error("Буцаалтын шалтгаан заавал");
    if (!storeCredit && refunds.length === 0) return toast.error("Буцаан олгох хэлбэр сонгоно уу");
    const refundInputs: PaymentInput[] = storeCredit
      ? []
      : refunds.map((row) => ({
          paymentMethodId: row.paymentMethodId,
          amount: Number(row.amount),
          reference: row.reference.trim() || null,
        }));
    startTransition(async () => {
      const result = await returnPosSale({ saleId: sale.id, lines, reason: reason.trim(), refunds: refundInputs, storeCredit });
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      feedback.posted(`${result.documentNo} буцаалт бүртгэгдлээ — ${fmtMnt(result.refundTotal ?? 0)}₮`);
      onOpenChange(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Буцаалт — {sale.documentNo}</DialogTitle>
          <DialogDescription>
            Эх мөрүүдээс тоо (Σ ≤ борлуулсан − буцаасан). Хаагдсан сарын борлуулалт өнөөдрийн огноогоор буцна.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <div className="grid grid-cols-[minmax(0,1fr)_90px_100px_110px] gap-2 px-1 text-[11px] text-[var(--ea-text-3)]">
            <span>Бараа</span>
            <span className="text-right">Боломжит</span>
            <span className="text-right">Буцаах</span>
            <span className="text-right">Дүн</span>
          </div>
          {sale.lines.map((line) => {
            const max = Math.max(0, line.quantity - line.returnedQty);
            const qty = Number(quantities[line.id] ?? 0);
            return (
              <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_90px_100px_110px] items-center gap-2 rounded-md border border-[var(--ea-border)] px-2 py-1 text-sm">
                <span className="truncate">
                  <span className="font-mono text-xs text-[var(--ea-text-3)]">{line.itemCode}</span> {line.itemName}
                </span>
                <span className="text-right font-mono text-xs">{fmtQty(max)}</span>
                <Input
                  type="number"
                  min="0"
                  max={max}
                  step="any"
                  disabled={max <= 0}
                  value={quantities[line.id] ?? ""}
                  className="font-mono text-right"
                  onChange={(e) => {
                    const value = Math.min(max, Math.max(0, Number(e.target.value) || 0));
                    setQuantities((current) => ({ ...current, [line.id]: e.target.value === "" ? "" : String(value) }));
                  }}
                />
                <span className="text-right font-mono text-xs">
                  {qty > 0 && line.quantity > 0 ? fmtMnt(round2((line.lineTotal * qty) / line.quantity)) : ""}
                </span>
              </div>
            );
          })}
          <div className="flex justify-end px-1 text-sm font-semibold">
            Буцаах дүн: <span className="ml-2 font-mono">{fmtMnt(refundTotal)}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Шалтгаан</Label>
          <textarea
            className="min-h-16 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            value={reason}
            rows={2}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {!isWalkIn && (
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={storeCredit} onCheckedChange={(value) => setStoreCredit(!!value)} />
            Дэлгүүрийн кредит болгох (бэлэн олгохгүй — харилцагчийн кредит үүснэ)
          </label>
        )}

        {!storeCredit && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Label className="mr-1">Буцаан олгох:</Label>
              {methods === null ? (
                <span className="text-xs text-[var(--ea-text-3)]">Ачаалж байна…</span>
              ) : (
                refundMethods.map((method) => (
                  <Button
                    key={method.id}
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => {
                      const remaining = round2(refundTotal - refundSum);
                      setRefunds((current) => [
                        ...current,
                        { key: seq, paymentMethodId: method.id, amount: remaining > 0 ? String(remaining) : "", reference: "" },
                      ]);
                      setSeq((value) => value + 1);
                    }}
                  >
                    {method.name}
                  </Button>
                ))
              )}
            </div>
            {refunds.map((row) => {
              const method = methodById.get(row.paymentMethodId);
              return (
                <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)_auto] items-center gap-2">
                  <span className="truncate text-sm">
                    {method?.name}
                    {method && method.currency !== "MNT" && (
                      <span className="ml-1 font-mono text-[10px] text-[var(--ea-text-3)]">{method.currency}</span>
                    )}
                  </span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.amount}
                    className="font-mono text-right"
                    onChange={(e) => setRefunds((current) => current.map((r) => (r.key === row.key ? { ...r, amount: e.target.value } : r)))}
                  />
                  <Input
                    value={row.reference}
                    placeholder="Лавлах"
                    onChange={(e) => setRefunds((current) => current.map((r) => (r.key === row.key ? { ...r, reference: e.target.value } : r)))}
                  />
                  <IconAction name="close" label="Мөр хасах" size="sm" onClick={() => setRefunds((current) => current.filter((r) => r.key !== row.key))} />
                </div>
              );
            })}
            {refunds.length > 0 && !hasFxRefund && (
              <p className={`text-xs ${sumMatches ? "text-[var(--ea-success-fg)]" : "text-[var(--ea-danger-fg)]"}`}>
                Σ буцаан олгох {fmtMnt(refundSum)} / {fmtMnt(refundTotal)}
                {!sumMatches && " — дүн таарахгүй"}
              </p>
            )}
            {hasFxRefund && (
              <p className="text-xs text-[var(--ea-text-3)]">Валютын хэлбэр — Σ-г сервер ээлжийн ханшаар шалгана.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Болих
          </Button>
          <Button onClick={submit} disabled={isPending || refundTotal <= 0 || !sumMatches}>
            <Icon name="approve" size="sm" />
            Буцаалт бүртгэх
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

// Мөнгөн гүйлгээний баримтын дэлгэрэнгүй панель. Payload: { documentId } —
// өгөгдлөө server action-аар өөрөө татна, panel.refreshToken өөрчлөгдөх
// бүрд дахин татна.
//
// GL журналын мөрүүд нь журнал бичихтэй ИЖИЛ хүснэгтээр (JournalLinesGrid
// readOnly) харагдана: Данс (дарахад сегментийн panel) · Дансны нэр · Дебет
// · Кредит · Тайлбар + pinned нийт дүн. Холбогдсон АР/АП нэхэмжлэхийг
// зэрэгцээ панелиар нээнэ; ноорог батлах/устгах, батлагдсаныг буцаах
// үйлдлүүд GL журналын харах дэлгэцтэй ижил footer-т байна.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { feedback } from "@/lib/ui/feedback";
import { Icon } from "@/components/ui/icon";

import {
  JournalLinesGrid,
  type JournalLineRow,
} from "@/components/journal/journal-lines-grid";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  deleteCashDocument,
  getCashDocPanelData,
  postCashDocument,
  reverseCashDocument,
  type CashDocPanelData,
} from "@/lib/actions/cash";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { fmtAccountDisplay } from "@/lib/grid/segments";
import { fmtMnt } from "@/lib/reports/balances";
import { usePanelPrint } from "@/lib/ui/use-panel-print";
import {
  openArapDocPanel,
  openVoucherPanel,
  refreshOpenPanels,
  usePanelStore,
  type PanelInstance,
} from "@/lib/store/panel-store";
import { PanelError, PanelLoading } from "@/components/panel/panel-states";

const TYPE_LABELS: Record<string, string> = {
  receipt: "Орлого",
  payment: "Зарлага",
  transfer: "Шилжүүлэг",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  reversed: "Буцаагдсан",
};
const STATUS_TONES: Record<string, StatusTone> = {
  draft: "warning",
  posted: "success",
  reversed: "muted",
};

const ERROR_MESSAGES = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "not-found": "Баримт олдсонгүй. Устгагдсан байж болзошгүй.",
  failed: "Ачаалж чадсангүй. Дахин оролдоно уу.",
} as const;

export function CashDocPanel({
  panel,
  requestClose,
}: {
  panel: PanelInstance;
  requestClose: () => void;
}) {
  const setTitle = usePanelStore((state) => state.setTitle);
  const closePanel = usePanelStore((state) => state.closePanel);
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [isPending, startTransition] = useTransition();

  const documentId = panel.payload.documentId as string | undefined;
  const refreshToken = panel.refreshToken;
  const { print, renderSheet } = usePanelPrint();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: CashDocPanelData }
  >({ status: "loading" });

  // Эхний ачаалалт + СЭРГЭЭХ/ДАХИН НЭЭХ бүрд дахин татна (store refreshToken-ийг
  // өсгөдөг) — панель хураастай байх зуур баримт батлагдсан/буцаагдсан байж
  // болно. Read-only панель тул dirty ерөөсөө үүсэхгүй ч хамгаалалтыг
  // voucher-panel-тай ижил байлгана.
  useEffect(() => {
    if (!documentId) return;
    const current = usePanelStore
      .getState()
      .panels.find((entry) => entry.id === panel.id);
    if (current?.dirty) return;

    let cancelled = false;
    getCashDocPanelData(documentId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState({ status: "error", message: ERROR_MESSAGES[result.code] });
          return;
        }
        setState({ status: "ready", data: result.data });
        const { document } = result.data;
        setTitle(
          panel.id,
          `${document.documentNo} · ${
            TYPE_LABELS[document.documentType] ?? document.documentType
          }`
        );
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", message: ERROR_MESSAGES.failed });
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, refreshToken, panel.id, setTitle]);

  if (state.status === "loading")
    return (
      <PanelLoading />
    );

  if (state.status === "error")
    return (
      <PanelError message={state.message} />
    );

  const { document, detail, activeSegIds, glNames, segmentValues, linkedInvoice } =
    state.data;
  const glName = (code: string | null) => (code ? glNames[code] ?? "" : "");

  // Журнал бичихтэй ИЖИЛ сегмент сонголтууд — S3 нь дансны мод, бусад нь
  // сегментийн лавлах утгууд (хуучин бичилтэд идэвхгүй данс ч харагдана).
  const segOptions: Record<number, SegOption[]> = {};
  for (const segId of activeSegIds) {
    segOptions[segId] =
      segId === 3
        ? Object.entries(glNames).map(([code, name]) => ({ code, name }))
        : segmentValues
            .filter((value) => value.segmentId === segId)
            .map((value) => ({ code: value.code, name: value.name }));
  }
  const toRows = (
    lines: { accountNumber: string; debit: number; credit: number; description: string | null }[]
  ): JournalLineRow[] =>
    lines.map((line, index) => ({
      id: `${index}`,
      account: line.accountNumber,
      debit: Number(line.debit),
      credit: Number(line.credit),
      description: line.description ?? "",
    }));
  const noop = () => {};

  function handlePost() {
    void confirm({
      title: "Баримт батлах",
      description: `${document.documentNo} ноорог баримтыг баталж GL журнал үүсгэх үү?`,
      confirmText: "Батлах",
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          const result = await postCashDocument(document.id);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          feedback.posted("Баримт батлагдаж GL-д бичигдлээ");
          refreshOpenPanels();
          router.refresh();
        } catch {
          toast.error("Батлах амжилтгүй");
        }
      });
    });
  }

  function handleDelete() {
    void confirm({
      title: document.status === "draft" ? "Ноорог устгах" : "Баримт устгах",
      description:
        document.status === "draft"
          ? `${document.documentNo} ноорог баримтыг устгах уу?`
          : `${document.documentNo} баримтыг GL журналтай нь ХАМТ бүрмөсөн устгана (буцаалт биш). Нэхэмжлэхийн төлөлт байсан бол үлдэгдэл нь сэргэнэ. Устгах уу?`,
      confirmText: "Устгах",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          const result = await deleteCashDocument(document.id);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Ноорог баримт устгагдлаа");
          closePanel(panel.id);
          refreshOpenPanels();
          router.refresh();
        } catch {
          toast.error("Устгах амжилтгүй");
        }
      });
    });
  }

  function handleReverse() {
    void confirm({
      title: "Баримт буцаах",
      description: `${document.documentNo} батлагдсан баримтад буцаалтын (сторно) журнал үүсгэх үү?`,
      confirmText: "Буцаах",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          const result = await reverseCashDocument(document.id);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Баримт буцаагдлаа — сторно журнал үүслээ");
          refreshOpenPanels();
          router.refresh();
        } catch {
          toast.error("Буцаах амжилтгүй");
        }
      });
    });
  }

  const cashAccountLabel =
    document.documentType === "transfer"
      ? `${document.fromAccountName ?? ""} → ${document.toAccountName ?? ""}`
      : document.documentType === "receipt"
        ? document.toAccountName ?? ""
        : document.fromAccountName ?? "";

  // Валюттай баримт валютын дүн + MNT сууриа хамт үзүүлнэ; GL-ээс үүссэн
  // ханшгүй ноорогт зөвхөн MNT дүн нь бодит.
  const amountLabel =
    document.currency === "MNT"
      ? fmtMnt(document.amount)
      : document.exchangeRate > 0 && document.amount > 0
        ? `${document.amount.toLocaleString("en-US")} ${document.currency} · ${fmtMnt(document.baseAmount)}`
        : `${fmtMnt(document.baseAmount)} · ${document.currency} ханш тодорхойгүй`;

  // Үзүүлэх журнал: батлагдсан/холбогдсон воучер, үгүй бол ноорог үүссэн
  // эх воучер (тэр бичилт GL-д аль хэдийн бий — нягтланч батлахын өмнө
  // яг үүнийг шалгана).
  const journalId = detail.voucherId ?? detail.sourceVoucherId;
  const showsSourceVoucher = !detail.voucherId && !!detail.sourceVoucherId;

  const printTitle =
    document.documentType === "receipt"
      ? "МӨНГӨН ОРЛОГЫН БАРИМТ"
      : document.documentType === "payment"
        ? "МӨНГӨН ЗАРЛАГЫН БАРИМТ"
        : "ШИЛЖҮҮЛГИЙН БАРИМТ";

  // Хэвлэх маягт — журналын баримттай ижил хэв маяг, кассын толгойтой.
  const printSheet = (
    <div className="ea-print-sheet hidden bg-white p-8 text-black print:block">
      <div className="mb-1 text-center text-lg font-bold uppercase tracking-wide">
        {printTitle}
      </div>
      <div className="mb-5 text-center text-xs text-neutral-500">
        № {document.documentNo}
      </div>
      <div className="mb-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <span className="text-neutral-500">Огноо: </span>
          <span className="font-mono">{document.date}</span>
        </div>
        <div>
          <span className="text-neutral-500">Данс: </span>
          {cashAccountLabel}
        </div>
        <div>
          <span className="text-neutral-500">Дүн: </span>
          <span className="font-mono font-semibold">{amountLabel}</span>
        </div>
        {document.counterparty && (
          <div>
            <span className="text-neutral-500">Харилцагч: </span>
            {document.counterparty}
          </div>
        )}
        {linkedInvoice && (
          <div>
            <span className="text-neutral-500">Нэхэмжлэх: </span>
            <span className="font-mono">{linkedInvoice.documentNo}</span>
          </div>
        )}
        <div className="col-span-3">
          <span className="text-neutral-500">Гүйлгээний утга: </span>
          {document.description || "—"}
        </div>
      </div>

      {detail.lines.length > 0 && (
        <div
          className="grid border-b border-t border-black text-xs"
          style={{ gridTemplateColumns: "1.4fr 1.2fr 1.4fr 0.9fr 0.9fr" }}
        >
          <div className="border-b border-neutral-400 py-1.5 font-semibold">Данс</div>
          <div className="border-b border-neutral-400 py-1.5 font-semibold">Дансны нэр</div>
          <div className="border-b border-neutral-400 py-1.5 font-semibold">Тайлбар</div>
          <div className="border-b border-neutral-400 py-1.5 text-right font-semibold">Дебет</div>
          <div className="border-b border-neutral-400 py-1.5 text-right font-semibold">Кредит</div>
          {detail.lines.map((line, index) => (
            <div key={index} className="contents">
              <div className="py-1 font-mono">
                {fmtAccountDisplay(line.accountNumber, activeSegIds)}
              </div>
              <div className="py-1">{glName(line.accountNumber.split(".").length === 10 ? line.accountNumber.split(".")[2] : line.accountNumber)}</div>
              <div className="py-1">{line.description ?? ""}</div>
              <div className="py-1 text-right font-mono">
                {Number(line.debit) ? fmtMnt(Number(line.debit)) : ""}
              </div>
              <div className="py-1 text-right font-mono">
                {Number(line.credit) ? fmtMnt(Number(line.credit)) : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-12 grid grid-cols-3 gap-8 text-xs">
        <div>
          Бүрдүүлсэн: _______________________
          <div className="mt-1 text-neutral-500">/овог нэр, гарын үсэг/</div>
        </div>
        <div>
          Шалгасан: _______________________
          <div className="mt-1 text-neutral-500">/овог нэр, гарын үсэг/</div>
        </div>
        <div>
          {document.documentType === "receipt" ? "Тушаасан" : "Хүлээн авсан"}:
          _______________________
          <div className="mt-1 text-neutral-500">/овог нэр, гарын үсэг/</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
            <span className="mr-2 font-mono text-xs font-normal text-[var(--ea-text-3)]">
              {document.documentNo}
            </span>
            {TYPE_LABELS[document.documentType] ?? document.documentType}
          </h2>
          <StatusBadge tone={STATUS_TONES[document.status] ?? "muted"}>
            {STATUS_LABELS[document.status] ?? document.status}
          </StatusBadge>
        </div>

        {/* Толгойн талбарууд */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
          <Row label="Огноо" value={document.date} mono />
          <Row label="Мөнгөн хөрөнгийн данс" value={cashAccountLabel} />
          <Row label="Дүн" value={amountLabel} mono strong />
          {document.documentType !== "transfer" && (
            <Row
              label="Харилцагч / GL данс"
              value={[
                document.counterparty,
                document.counterAccountNumber
                  ? `${document.counterAccountNumber} ${glName(document.counterAccountNumber)}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          )}
          {document.cashFlowCode && (
            <Row label="Мөнгөн урсгал (S8)" value={document.cashFlowCode} mono />
          )}
          <Row label="Утга" value={document.description || "—"} span2 />
        </dl>

        {/* Холбогдсон АР/АП нэхэмжлэх — зэрэгцээ панелиар нээнэ */}
        {linkedInvoice && (
          <button
            type="button"
            onClick={() =>
              openArapDocPanel({
                documentId: linkedInvoice.id,
                mode: "combined",
                title: `${linkedInvoice.documentNo} · ${linkedInvoice.counterpartyName}`,
              })
            }
            className="flex w-full items-center gap-2.5 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2 text-left transition-colors hover:border-[var(--ea-primary)]"
          >
            <Icon name="document" size="sm" className="shrink-0 text-[var(--ea-primary)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-[var(--ea-text-1)]">
                {linkedInvoice.documentNo} · {linkedInvoice.counterpartyName}
              </span>
              <span className="text-[10px] text-[var(--ea-text-4)]">
                Холбогдсон{" "}
                {linkedInvoice.documentType === "ar_invoice"
                  ? "авлагын нэхэмжлэл"
                  : "өглөгийн нэхэмжлэх"}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--ea-primary)]">
              Нэхэмжлэх нээх
              <Icon name="openDetail" size="xs" />
            </span>
          </button>
        )}

        {/* Холбоотой GL журнал — GL-ээс үүссэн ноорогт энэ нь эх воучер. */}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--ea-text-2)]">
              {showsSourceVoucher ? "Эх GL журнал" : "GL журнал"}
              {detail.voucherDate && (
                <span className="ml-2 font-mono font-normal text-[var(--ea-text-4)]">
                  {detail.voucherDate}
                </span>
              )}
            </span>
            {journalId && (
              <button
                type="button"
                onClick={() =>
                  openVoucherPanel(
                    journalId,
                    detail.voucherDescription || "Журнал"
                  )
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ea-primary)] hover:underline"
              >
                Журнал нээх
                <Icon name="openExternal" size="xs" />
              </button>
            )}
          </div>
          {detail.lines.length > 0 ? (
            <>
              <div className="overflow-hidden rounded-md border border-[var(--ea-border)]">
                <JournalLinesGrid
                  lines={toRows(detail.lines)}
                  onLinesChange={noop}
                  activeSegIds={activeSegIds}
                  segOptions={segOptions}
                  readOnly
                />
              </div>
              {showsSourceVoucher && (
                <p className="mt-1.5 text-[11px] text-[var(--ea-text-4)]">
                  Энэ бичилт GL-д аль хэдийн батлагдсан. Баримтыг батлахад
                  шинэ журнал үүсэхгүй — энэ журналыг холбоно.
                </p>
              )}
            </>
          ) : (
            <div className="rounded-md border border-[var(--ea-border)] py-6 text-center text-xs text-[var(--ea-text-4)]">
              {document.status === "draft"
                ? "Ноорог — батлагдаагүй тул GL журнал үүсээгүй"
                : "GL журнал олдсонгүй"}
            </div>
          )}
        </div>

        {/* Буцаалтын журнал */}
        {detail.reversalLines.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-semibold text-[var(--ea-warning-fg)]">
              Буцаалтын журнал
            </div>
            <div className="overflow-hidden rounded-md border border-[var(--ea-border)]">
              <JournalLinesGrid
                lines={toRows(detail.reversalLines)}
                onLinesChange={noop}
                activeSegIds={activeSegIds}
                segOptions={segOptions}
                readOnly
              />
            </div>
          </div>
        )}

        {/* Үйлдлүүд — GL журналын харах дэлгэцтэй ижил зарчим */}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--ea-border)] pt-3">
          <Button variant="outline" onClick={print} disabled={isPending}>
            <Icon name="print" size="sm" />
            Хэвлэх
          </Button>
          <Button variant="outline" onClick={requestClose} disabled={isPending}>
            Хаах
          </Button>
          {document.status === "draft" && (
            <>
              <Button variant="outline" onClick={handleDelete} disabled={isPending}>
                <Icon name="delete" size="sm" />
                Устгах
              </Button>
              <Button onClick={handlePost} disabled={isPending}>
                <Icon name="approve" size="sm" />
                Батлах
              </Button>
            </>
          )}
          {document.status === "posted" && (
            <>
              <Button variant="outline" onClick={handleDelete} disabled={isPending}>
                <Icon name="delete" size="sm" />
                Устгах
              </Button>
              <Button variant="outline" onClick={handleReverse} disabled={isPending}>
                <Icon name="reset" size="sm" />
                Буцаах
              </Button>
            </>
          )}
        </div>
      </div>
      {confirmDialog}
      {renderSheet(printSheet)}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  strong,
  span2,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "col-span-2" : undefined}>
      <dt className="text-[var(--ea-text-4)]">{label}</dt>
      <dd
        className={[
          "mt-0.5 text-[var(--ea-text-1)]",
          mono ? "font-mono" : "",
          strong ? "font-semibold" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

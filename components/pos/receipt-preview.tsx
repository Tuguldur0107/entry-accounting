"use client";

// POS баримтын урьдчилсан харагдац (80мм) + хэвлэх — docs/pos §3.3 ⑤.
//
// Хэвлэх зарчим нь components/gl/journal-entry-form.tsx-тэй ИЖИЛ: хэвлэх
// агшинд баримтыг body-д portal-оор гаргаж body-д `ea-printing-pos` class
// тавина — app/globals.css-ийн @media print дүрэм зөвхөн `.pos-receipt`-ийг
// үзүүлнэ (апп, диалог, бусад панель хэвлэгдэхгүй). Z-тайлан ч мөн
// `usePosPrint`-ийг хэрэглэнэ.

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon, type IconName } from "@/components/ui/icon";
import { FilterChips } from "@/components/ui/tabs";
import { sendPosSaleEbarimtNow } from "@/lib/actions/ebarimt";
import type { PosReceipt } from "@/lib/actions/pos";
import { receiptSteps, type ReceiptStep, type ReceiptStepState } from "@/lib/pos/receipt-steps";
import { fmtMnt } from "@/lib/reports/balances";

/**
 * Хэвлэх туслах: `print()` дуудахад `content` body-д `.pos-receipt` болж
 * portal-оор гарч window.print() ажиллана. `portal`-ыг дуудагч render-дээ
 * заавал оруулна. `onAfterPrint` — хэвлэх цонх хаагдсаны дараа.
 */
export function usePosPrint(content: ReactNode, onAfterPrint?: () => void) {
  const [printing, setPrinting] = useState(false);
  const afterPrintRef = useRef(onAfterPrint);
  useEffect(() => {
    afterPrintRef.current = onAfterPrint;
  });

  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("ea-printing-pos");
    window.print();
    document.body.classList.remove("ea-printing-pos");
    // window.print() нь хэвлэх dialog хаагдтал блоклоно — дараа нь portal-ыг
    // буулгана (sync setState effect дотор хориотой тул timeout-оор).
    const timer = setTimeout(() => {
      setPrinting(false);
      afterPrintRef.current?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [printing]);

  const portal =
    printing && typeof document !== "undefined"
      ? createPortal(
          <div className="pos-receipt bg-white text-black">{content}</div>,
          document.body
        )
      : null;

  // Тогтвортой — автомат хэвлэлтийн effect-ийн dependency.
  const print = useCallback(() => setPrinting(true), []);
  return { print, portal, printing };
}

const fmtTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" }).slice(0, 16);
};

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

// ── eBarimt-ийн QR (ТЕГ-ийн `qrData`) ────────────────────────────────────────
//
// `qrcode-generator` (хамааралгүй, ~10KB) dynamic import-оор ачаалагдаж
// МОДУЛИЙН МАТРИЦ inline SVG болж зурагдана — зураг татахгүй, хэвлэхэд ч
// ижил. Хэвлэх агшинд portal шууд render хийгддэг тул үйлдвэр (factory) ба
// матриц МОДУЛИЙН ТҮВШИНД кэшлэгдэнэ: диалог нэгэнт харагдсан бол хэвлэхэд
// QR аль хэдийн бэлэн байна.

interface QrCodeLike {
  addData(data: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}

let qrFactory: ((typeNumber: 0, errorCorrectionLevel: "M") => QrCodeLike) | null = null;
const qrPathCache = new Map<string, { path: string; count: number }>();

function buildQrPath(value: string): { path: string; count: number } | null {
  const cached = qrPathCache.get(value);
  if (cached) return cached;
  if (!qrFactory) return null;
  try {
    const code = qrFactory(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let path = "";
    for (let row = 0; row < count; row += 1)
      for (let col = 0; col < count; col += 1)
        if (code.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    const result = { path, count };
    qrPathCache.set(value, result);
    return result;
  } catch {
    // QR үүсээгүй бол баримт QR-гүй хэвлэгдэнэ — борлуулалт зогсохгүй.
    return null;
  }
}

/**
 * `qrcode-generator`-ийг НЭГ удаа ачаална (давхар дуудалт нэг promise-ийг
 * хуваалцана). Баримтын диалог mount болмогц урьдчилан дуудагдана — сугалаа,
 * QR нь нэг л удаа хэвлэгддэг тул эхний баримт ч QR-тай гарах ёстой.
 */
let qrFactoryLoading: Promise<void> | null = null;
function ensureQrFactory(): Promise<void> {
  if (qrFactory) return Promise.resolve();
  qrFactoryLoading ??= import("qrcode-generator")
    .then((module) => {
      qrFactory = module.default;
    })
    .catch(() => {
      // Ачаалагдаагүй — QR хэвлэгдэхгүй, ДДТД/сугалаа хэвээр; дараа дахин оролдоно.
      qrFactoryLoading = null;
    });
  return qrFactoryLoading;
}

function ReceiptQr({ value }: { value: string }) {
  // Render бүрд шууд (buildQrPath өөрөө Map-аар кэшлэдэг). useMemo([value]) нь
  // сан ачаалагдахаас өмнөх null-ийг хадгалж QR ХЭЗЭЭ Ч зурагдахгүй байв —
  // components/ui/qr-code.tsx-ийн #111 засвартай ижил алдаа.
  const [, setLoaded] = useState(0);
  const qr = buildQrPath(value);

  useEffect(() => {
    if (qr) return;
    let cancelled = false;
    void ensureQrFactory().then(() => {
      if (!cancelled && qrFactory) setLoaded((current) => current + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [qr]);

  if (!qr) return null;
  return (
    <div className="mt-1 flex justify-center">
      <svg
        viewBox={`-2 -2 ${qr.count + 4} ${qr.count + 4}`}
        style={{ width: "36mm", height: "36mm", background: "var(--ea-qr-bg)" }}
        shapeRendering="crispEdges"
        role="img"
        aria-label="eBarimt QR"
      >
        {/* Дэлгэцийн урьдчилсан харагдац dark горимд ч цагаан дээр хар (урвуу QR уншигдахгүй) */}
        <path d={qr.path} fill="var(--ea-qr-fg)" />
      </svg>
    </div>
  );
}

/** 80мм-ийн баримтын бие — дэлгэц дээр ч, хэвлэхэд ч ИЖИЛ markup. */
export function ReceiptSheet({
  receipt,
  ebarimtPlaceholder = false,
}: {
  receipt: PosReceipt;
  /** Урьдчилан харахад: eBarimt олгох бол ДДТД/сугалаа/QR-ийн БАЙР (утга батлахад л). */
  ebarimtPlaceholder?: boolean;
}) {
  const headerLines = receipt.header.split("\n").filter((line) => line.trim());
  const footerLines = receipt.footer.split("\n").filter((line) => line.trim());
  return (
    <div
      className="mx-auto w-[80mm] max-w-full font-mono text-[11px] leading-snug"
      style={{ color: "inherit" }}
    >
      {/* Борлуулагчийн толгой — компанийн мэдээллээс (ENT-053). */}
      {receipt.seller ? (
        <div className="mb-1 text-center">
          <div className="text-[13px] font-bold">{receipt.seller.name}</div>
          {receipt.seller.vatPayerNo || receipt.seller.registerNo ? (
            <div>
              {receipt.seller.vatPayerNo
                ? `ТТД ${receipt.seller.vatPayerNo}`
                : `РД ${receipt.seller.registerNo}`}
            </div>
          ) : null}
          {receipt.seller.address ? <div>{receipt.seller.address}</div> : null}
          {receipt.seller.phone ? <div>Утас {receipt.seller.phone}</div> : null}
        </div>
      ) : null}
      {headerLines.length > 0 && (
        <div className="mb-2 text-center">
          {headerLines.map((line, index) => (
            <div
              key={index}
              className={index === 0 && !receipt.seller ? "text-[13px] font-bold" : ""}
            >
              {line}
            </div>
          ))}
        </div>
      )}
      <div className="border-b border-dashed border-current pb-1">
        <div className="flex justify-between">
          <span>№ {receipt.documentNo}</span>
          <span>{fmtTime(receipt.soldAt)}</span>
        </div>
        <div className="flex justify-between">
          <span>Кассчин: {receipt.cashierName || "—"}</span>
        </div>
        {receipt.customerName && <div>Харилцагч: {receipt.customerName}</div>}
        {/* B2B худалдан авагч — ХСН №16: нэр, ТТД (иргэний дугаар ХЭВЛЭХГҮЙ) */}
        {receipt.buyer && (
          <div className="mt-0.5">
            <div>Худалдан авагч: {receipt.buyer.name || "—"}</div>
            <div>
              ТТД {receipt.buyer.tin}
              {receipt.buyer.regNo && receipt.buyer.regNo !== receipt.buyer.tin
                ? ` · РД ${receipt.buyer.regNo}`
                : ""}
            </div>
          </div>
        )}
      </div>

      <div className="py-1">
        {receipt.lines.map((line, index) => (
          <div key={index} className="mb-1">
            <div className="break-words">{line.name}</div>
            <div className="flex justify-between">
              <span>
                {fmtQty(line.quantity)} {line.unit} × {fmtMnt(line.unitPrice)}
              </span>
              <span>{fmtMnt(line.total)}</span>
            </div>
            {line.discount > 0 && (
              <div className="flex justify-between">
                <span className="pl-2">хөнгөлөлт</span>
                <span>−{fmtMnt(line.discount)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-dashed border-current pt-1">
        <Row label="Нийт (хөнг. өмнө)" value={fmtMnt(receipt.grossAmount)} />
        {receipt.discountTotal > 0 && (
          <Row label="Хөнгөлөлт" value={`−${fmtMnt(receipt.discountTotal)}`} />
        )}
        {receipt.isVatPayer ? (
          <>
            <Row label="НӨАТ-гүй дүн" value={fmtMnt(receipt.netAmount)} />
            <Row label="НӨАТ" value={fmtMnt(receipt.vatAmount)} />
          </>
        ) : (
          <div className="text-[10px]">НӨАТ-гүй</div>
        )}
        {receipt.cityTaxAmount > 0 && <Row label="НХАТ" value={fmtMnt(receipt.cityTaxAmount)} />}
        {receipt.roundingAmount !== 0 && (
          <Row label="Бөөрөнхийлөл" value={fmtMnt(receipt.roundingAmount)} />
        )}
        <div className="mt-1 flex justify-between text-[13px] font-bold">
          <span>ТӨЛӨХ</span>
          <span>{fmtMnt(receipt.total)}</span>
        </div>
      </div>

      <div className="mt-1 border-t border-dashed border-current pt-1">
        {receipt.payments.map((payment, index) => (
          <Row
            key={index}
            label={payment.name}
            value={
              payment.currency !== "MNT"
                ? `${payment.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${payment.currency} = ${fmtMnt(payment.baseAmount)}`
                : fmtMnt(payment.baseAmount)
            }
          />
        ))}
        {receipt.change > 0 && <Row label="Хариулт" value={fmtMnt(receipt.change)} />}
      </div>

      {ebarimtPlaceholder && (
        <div className="mt-1 border-t border-dashed border-current pt-1">
          <div>ДДТД: ——————————</div>
          <div>Сугалаа: ————————</div>
          <div className="mx-auto my-1 flex size-[34mm] items-center justify-center border border-dashed border-current text-[10px]">
            QR
          </div>
        </div>
      )}

      {(receipt.ebarimtId ||
        receipt.ebarimtLottery ||
        receipt.ebarimtQrData ||
        receipt.ebarimtStatus === "pending" ||
        receipt.ebarimtStatus === "failed") && (
        <div className="mt-1 border-t border-dashed border-current pt-1">
          {receipt.ebarimtId && <div>ДДТД: {receipt.ebarimtId}</div>}
          {receipt.ebarimtLottery && <div>Сугалаа: {receipt.ebarimtLottery}</div>}
          {receipt.ebarimtQrData && <ReceiptQr value={receipt.ebarimtQrData} />}
          {(receipt.ebarimtStatus === "pending" || receipt.ebarimtStatus === "failed") && (
            <div className="text-[var(--ea-danger-fg)] print:text-black">
              eBarimt: баримт олгогдоогүй
            </div>
          )}
        </div>
      )}

      {receipt.negativeStock.length > 0 && (
        <div className="mt-1 border-t border-dashed border-current pt-1 text-[var(--ea-warning-fg)] print:text-black">
          {receipt.negativeStock.map((entry, index) => (
            <div key={index}>
              ⚠ {entry.itemName} — {entry.warehouseName} үлдэгдэл{" "}
              {fmtQty(entry.balanceAfter)}
            </div>
          ))}
        </div>
      )}

      {footerLines.length > 0 && (
        <div className="mt-2 border-t border-dashed border-current pt-1 text-center">
          {footerLines.map((line, index) => (
            <div key={index}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="truncate">{label}</span>
      <span className="shrink-0">{value}</span>
    </div>
  );
}

const PRINT_MODE_OPTIONS = [
  { value: "steps", label: "Алхамаар" },
  { value: "auto", label: "Шууд хэвлэх" },
] as const;

const STEP_ICON: Record<ReceiptStepState, { icon: IconName; color: string }> = {
  done: { icon: "success", color: "text-[var(--ea-success-fg)]" },
  active: { icon: "pending", color: "text-[var(--ea-primary)]" },
  error: { icon: "error", color: "text-[var(--ea-danger-fg)]" },
  skipped: { icon: "info", color: "text-[var(--ea-text-3)]" },
  waiting: { icon: "pending", color: "text-[var(--ea-text-3)]" },
};

/** ① Борлуулалт → ② eBarimt → ③ Хэвлэх (lib/pos/receipt-steps.ts). Зөвхөн дэлгэцэнд. */
function ReceiptStepList({ steps, onRetry }: { steps: ReceiptStep[]; onRetry?: () => void }) {
  return (
    <ol className="space-y-1.5 rounded-md border border-[var(--ea-border)] p-3 text-sm">
      {steps.map((step, index) => {
        const tone = STEP_ICON[step.state];
        const loading = step.state === "active" && step.key === "ebarimt";
        return (
          <li key={step.key} className="flex items-start gap-2">
            <Icon name={loading ? "loading" : tone.icon} size="sm" className={`mt-0.5 shrink-0 ${tone.color}`} />
            <div className="min-w-0 flex-1">
              <div
                className={
                  step.state === "waiting"
                    ? "text-[var(--ea-text-3)]"
                    : step.state === "error"
                      ? "font-semibold text-[var(--ea-danger-fg)]"
                      : "font-medium text-[var(--ea-text-1)]"
                }
              >
                {index + 1}. {step.label}
              </div>
              {step.detail && (
                <div className="break-words text-xs text-[var(--ea-text-2)]">{step.detail}</div>
              )}
              {step.key === "ebarimt" && step.state === "error" && onRetry && (
                <Button className="mt-1.5" size="sm" onClick={onRetry}>
                  <Icon name="send" size="sm" />
                  Дахин илгээх
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Browser горимд eBarimt-ийн хариу (сугалаа/QR) ирэхийг хүлээх дээд хугацаа. */
const EBARIMT_PRINT_WAIT_MS = 8_000;

const ebarimtMissing = (receipt: PosReceipt | null) =>
  receipt?.ebarimtStatus === "pending" || receipt?.ebarimtStatus === "failed";

/**
 * Баримтын диалог: борлуулалт батлагдсаны дараа (кассын дэлгэц) ба
 * "Дахин хэвлэх" (борлуулалтын панель) хоёуланд.
 *
 * Кассын дэлгэц `autoPrint`-ийг дамжуулна (төхөөрөмжийн тохиргоо): шинэ баримт
 * гармагц хэвлэгдэж, хэвлэсний дараа цонх өөрөө хаагдана. eBarimt-ийн
 * сугалаа, QR нь ЗӨВХӨН энэ цонхонд нэг удаа гардаг (хадгалахыг хуулиар
 * хориглосон) тул хэвлээгүй хаах гэвэл анхааруулна.
 *
 * Server горимд eBarimt амжилтгүй / хүлээгдэж байвал АВТОМАТААР ХЭВЛЭХГҮЙ —
 * шалтгааныг (зөвхөн дэлгэцэнд) харуулж «Дахин илгээх»-ээр ТЕГ-ийн хариуг
 * (сугалаа/QR) авсны ДАРАА хэвлэнэ; eBarimt-гүй хэвлэх бол ил баталгаажуулна.
 */
export function ReceiptPreview({
  receipt: receiptProp,
  onClose,
  autoPrint,
  onAutoPrintChange,
  waitForEbarimt = false,
}: {
  receipt: PosReceipt | null;
  onClose: () => void;
  /** undefined = автомат хэвлэлтгүй (панелийн «Дахин хэвлэх»). */
  autoPrint?: boolean;
  onAutoPrintChange?: (value: boolean) => void;
  /** eBarimt browser горим: `pending` баримтыг хариу иртэл (≤8 сек) хүлээж хэвлэнэ. */
  waitForEbarimt?: boolean;
}) {
  // «Дахин илгээх»-ийн хариу (сугалаа/QR) — зөвхөн энэ борлуулалтад, санах ойд.
  const [live, setLive] = useState<Partial<PosReceipt> & { saleId: string } | null>(null);
  const receipt: PosReceipt | null =
    receiptProp && live && live.saleId === receiptProp.saleId ? { ...receiptProp, ...live } : receiptProp;
  const [printedId, setPrintedId] = useState<string | null>(null);
  const autoPrintedFor = useRef<string | null>(null);
  const closeAfterPrint = useRef(false);
  const [sending, startSending] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { print, portal } = usePosPrint(receipt ? <ReceiptSheet receipt={receipt} /> : null, () => {
    if (receipt) setPrintedId(receipt.saleId);
    if (closeAfterPrint.current) {
      closeAfterPrint.current = false;
      onClose();
    }
  });

  // QR-ийн санг урьдчилан ачаална — эхний борлуулалтын баримт ч QR-тай хэвлэгдэнэ.
  useEffect(() => {
    void ensureQrFactory();
  }, []);

  const saleId = receipt?.saleId ?? null;
  const ebarimtPending = receipt?.ebarimtStatus === "pending";
  const missing = ebarimtMissing(receipt);
  // Server горимд eBarimt олгогдоогүй бол кассчин шийднэ (Дахин илгээх / eBarimt-гүй хэвлэх).
  const holdForCashier = missing && !waitForEbarimt;
  const hasQr = !!receipt?.ebarimtQrData;
  useEffect(() => {
    if (!autoPrint || !saleId || autoPrintedFor.current === saleId || holdForCashier) return;
    let cancelled = false;
    const run = async () => {
      // QR нэг л удаа хэвлэгддэг тул сан ачаалагдтал хүлээнэ (унасан бол QR-гүй).
      if (hasQr) await ensureQrFactory();
      if (cancelled) return;
      autoPrintedFor.current = saleId;
      closeAfterPrint.current = true;
      print();
    };
    const timer = setTimeout(() => void run(), waitForEbarimt && ebarimtPending ? EBARIMT_PRINT_WAIT_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [autoPrint, saleId, ebarimtPending, waitForEbarimt, holdForCashier, hasQr, print]);

  const printed = receipt !== null && printedId === receipt.saleId;
  const hasOneTimeData = !!(receipt?.ebarimtLottery || receipt?.ebarimtQrData);

  function sendNow() {
    if (!receipt) return;
    const id = receipt.saleId;
    startSending(async () => {
      const result = await sendPosSaleEbarimtNow(id);
      if (result.error) {
        setLive({ saleId: id, ebarimtError: result.error });
        return;
      }
      setLive({
        saleId: id,
        ebarimtStatus: result.status ?? "pending",
        ebarimtId: result.ebarimtId ?? null,
        ebarimtLottery: result.ebarimtLottery ?? null,
        ebarimtQrData: result.ebarimtQrData ?? null,
        ebarimtError: result.reason ?? null,
      });
      if (result.ebarimtQrData) void ensureQrFactory();
    });
  }

  async function requestPrint() {
    if (missing && !printed) {
      const ok = await confirm({
        title: "eBarimt олгогдоогүй байна",
        description:
          "Баримт ТЕГ-д бүртгэгдээгүй тул ДДТД, сугалаа, QR-гүй хэвлэгдэнэ. Эхлээд «Дахин илгээх» дарахыг зөвлөж байна. eBarimt-гүй хэвлэх үү?",
        confirmText: "eBarimt-гүй хэвлэх",
        cancelText: "Буцах",
        danger: true,
      });
      if (!ok) return;
    }
    print();
  }

  async function requestClose() {
    if (!printed && hasOneTimeData) {
      const ok = await confirm({
        title: "Баримт хэвлээгүй байна",
        description:
          "eBarimt-ийн сугалаа, QR зөвхөн энэ цонхонд гардаг — хаавал дахин хэвлэхэд зөвхөн ДДТД гарна. Хэвлэхгүй хаах уу?",
        confirmText: "Хэвлэхгүй хаах",
        cancelText: "Буцах",
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  }

  return (
    <>
      <Dialog
        open={receipt !== null}
        onOpenChange={(open) => {
          if (!open) void requestClose();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Баримт — {receipt?.documentNo}</DialogTitle>
            <DialogDescription>
              80мм-ийн кассын баримт. «Хэвлэх» нь зөвхөн баримтыг хэвлэнэ.
            </DialogDescription>
          </DialogHeader>
          {onAutoPrintChange && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ea-text-3)]">
              <span>Хэвлэх горим</span>
              <FilterChips
                options={PRINT_MODE_OPTIONS}
                value={autoPrint ? "auto" : "steps"}
                onChange={(mode) => onAutoPrintChange(mode === "auto")}
              />
              <span className="basis-full">
                {autoPrint
                  ? "Энэ төхөөрөмжид: батлагдмагц шууд хэвлэж цонх хаагдана (eBarimt олгогдоогүй бол зогсоно)"
                  : "Энэ төхөөрөмжид: алхам бүрийг шалгаад «Хэвлэх» дарна"}
              </span>
            </div>
          )}
          {receipt && (
            <ReceiptStepList
              steps={receiptSteps({
                documentNo: receipt.documentNo,
                ebarimtStatus: receipt.ebarimtStatus,
                ebarimtId: receipt.ebarimtId,
                ebarimtLottery: receipt.ebarimtLottery,
                ebarimtError: receipt.ebarimtError,
                sending,
                waitingForBrowser: waitForEbarimt,
                printed,
              })}
              onRetry={holdForCashier && !sending ? sendNow : undefined}
            />
          )}
          {receipt && (
            <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-3 text-[var(--ea-text-1)]">
              <ReceiptSheet receipt={receipt} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => void requestClose()}>
              Хаах
            </Button>
            <Button onClick={() => void requestPrint()} autoFocus={!holdForCashier} disabled={sending}>
              <Icon name="print" size="sm" />
              {printed ? "Дахин хэвлэх" : "Хэвлэх"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
      {portal}
    </>
  );
}

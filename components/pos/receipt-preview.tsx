"use client";

// POS баримтын урьдчилсан харагдац (80мм) + хэвлэх — docs/pos §3.3 ⑤.
//
// Хэвлэх зарчим нь components/gl/journal-entry-form.tsx-тэй ИЖИЛ: хэвлэх
// агшинд баримтыг body-д portal-оор гаргаж body-д `ea-printing-pos` class
// тавина — app/globals.css-ийн @media print дүрэм зөвхөн `.pos-receipt`-ийг
// үзүүлнэ (апп, диалог, бусад панель хэвлэгдэхгүй). Z-тайлан ч мөн
// `usePosPrint`-ийг хэрэглэнэ.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
import type { PosReceipt } from "@/lib/actions/pos";
import { fmtMnt } from "@/lib/reports/balances";

/**
 * Хэвлэх туслах: `print()` дуудахад `content` body-д `.pos-receipt` болж
 * portal-оор гарч window.print() ажиллана. `portal`-ыг дуудагч render-дээ
 * заавал оруулна.
 */
export function usePosPrint(content: ReactNode) {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("ea-printing-pos");
    window.print();
    document.body.classList.remove("ea-printing-pos");
    // window.print() нь хэвлэх dialog хаагдтал блоклоно — дараа нь portal-ыг
    // буулгана (sync setState effect дотор хориотой тул timeout-оор).
    const timer = setTimeout(() => setPrinting(false), 0);
    return () => clearTimeout(timer);
  }, [printing]);

  const portal =
    printing && typeof document !== "undefined"
      ? createPortal(
          <div className="pos-receipt bg-white text-black">{content}</div>,
          document.body
        )
      : null;

  return { print: () => setPrinting(true), portal, printing };
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

function ReceiptQr({ value }: { value: string }) {
  const [, setLoaded] = useState(0);
  const qr = useMemo(() => buildQrPath(value), [value]);

  useEffect(() => {
    if (qr || qrFactory) return;
    let cancelled = false;
    import("qrcode-generator")
      .then((module) => {
        if (cancelled) return;
        qrFactory = module.default;
        setLoaded((current) => current + 1);
      })
      .catch(() => {
        // Ачаалагдаагүй — QR хэвлэгдэхгүй, ДДТД/сугалаа хэвээр.
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
        style={{ width: "36mm", height: "36mm" }}
        shapeRendering="crispEdges"
        role="img"
        aria-label="eBarimt QR"
      >
        <path d={qr.path} fill="currentColor" />
      </svg>
    </div>
  );
}

/** 80мм-ийн баримтын бие — дэлгэц дээр ч, хэвлэхэд ч ИЖИЛ markup. */
export function ReceiptSheet({ receipt }: { receipt: PosReceipt }) {
  const headerLines = receipt.header.split("\n").filter((line) => line.trim());
  const footerLines = receipt.footer.split("\n").filter((line) => line.trim());
  return (
    <div
      className="mx-auto w-[80mm] max-w-full font-mono text-[11px] leading-snug"
      style={{ color: "inherit" }}
    >
      {headerLines.length > 0 && (
        <div className="mb-2 text-center">
          {headerLines.map((line, index) => (
            <div key={index} className={index === 0 ? "text-[13px] font-bold" : ""}>
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
        <div>Харилцагч: {receipt.customerName}</div>
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

      {(receipt.ebarimtId ||
        receipt.ebarimtLottery ||
        receipt.ebarimtQrData ||
        receipt.ebarimtStatus === "pending" ||
        receipt.ebarimtStatus === "failed") && (
        <div className="mt-1 border-t border-dashed border-current pt-1">
          {receipt.ebarimtId && <div>ДДТД: {receipt.ebarimtId}</div>}
          {receipt.ebarimtLottery && <div>Сугалаа: {receipt.ebarimtLottery}</div>}
          {receipt.ebarimtQrData && <ReceiptQr value={receipt.ebarimtQrData} />}
          {receipt.ebarimtStatus === "pending" && (
            <div className="text-[var(--ea-text-3)] print:text-black">
              eBarimt: илгээж байна… (дараа нь дахин хэвлэнэ)
            </div>
          )}
          {receipt.ebarimtStatus === "failed" && (
            <div className="text-[var(--ea-danger-fg)] print:text-black">
              eBarimt: илгээгдсэнгүй
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

/**
 * Баримтын диалог: борлуулалт батлагдсаны дараа (кассын дэлгэц) ба
 * "Дахин хэвлэх" (борлуулалтын панель) хоёуланд.
 */
export function ReceiptPreview({
  receipt,
  onClose,
}: {
  receipt: PosReceipt | null;
  onClose: () => void;
}) {
  const { print, portal } = usePosPrint(receipt ? <ReceiptSheet receipt={receipt} /> : null);
  return (
    <>
      <Dialog
        open={receipt !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Баримт — {receipt?.documentNo}</DialogTitle>
            <DialogDescription>
              80мм-ийн кассын баримт. «Хэвлэх» нь зөвхөн баримтыг хэвлэнэ.
            </DialogDescription>
          </DialogHeader>
          {receipt && (
            <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-3 text-[var(--ea-text-1)]">
              <ReceiptSheet receipt={receipt} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Хаах
            </Button>
            <Button onClick={print} autoFocus>
              <Icon name="print" size="sm" />
              Хэвлэх
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {portal}
    </>
  );
}

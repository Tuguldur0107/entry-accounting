"use client";

// Кассын дэлгэц `/inventory/pos` — docs/pos/00-proposal.md §4.1 (v2, дэлгүүрийн
// POS загвар: Odoo / Square / Loyverse-ийн заншлаар).
//
//   ЗҮҮН  `ProductPanel`  сканнер/хайлт → бүлгийн chip → барааны TILE grid
//   БАРУУН `TicketPanel`  харилцагч → баримтын мөрүүд (товшиж сонгох, −/+, ×)
//                         → дүн (ТӨЛӨХ) → numpad (Тоо / Хөнг % / Үнэ) → ТӨЛБӨР
//   Ээлж нээгээгүй бол дэлгэц дээр НЭГ ТОВЧНЫ диалог (сүүлийн ээлжийн default).
//
// Үнэ / хөнгөлөлт CLIENT талд ТООЦОГДОХГҮЙ — зөвхөн серверийн `quotePosSale`
// (борлуулалттай ЯГ ижил хөдөлгөгч, 250мс debounce). Сагс DB-д ноорог
// үүсгэхгүй: ноорог + түр хадгалсан (парк) сагснууд localStorage-д.
// Сагсны цэвэр төлөв `lib/pos/checkout-state.ts` (тесттэй).
//
// Товчлуур: F9 төлбөр · F2 эсвэл "/" хайлт · F4 хөнгөлөлт · F6 харилцагч ·
// ↑/↓ мөр сонгох · + / − тоо · Delete мөр хасах · Esc сонголт → сагс цэвэрлэх.
// Сканнер = гар (keyboard wedge): хайлтын input ҮРГЭЛЖ focus-той — tile,
// мөр, numpad бүгд mousedown-ыг preventDefault хийж focus-ыг булаахгүй.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DiscountDialog } from "@/components/pos/checkout/discount-dialog";
import { ParkedDialog } from "@/components/pos/checkout/parked-dialog";
import { ProductPanel } from "@/components/pos/checkout/product-panel";
import { TicketPanel, type TicketLineView } from "@/components/pos/checkout/ticket-panel";
import { PaymentDialog, type EbarimtBuyerInput } from "@/components/pos/payment-dialog";
import { ReceiptPreview } from "@/components/pos/receipt-preview";
import { CloseShiftDialog, OpenShiftForm } from "@/components/pos/shift-dialogs";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { getEbarimtOutbox, recordEbarimtResponse } from "@/lib/actions/ebarimt";
import {
  createPosSale,
  quotePosSale,
  type PosReceipt,
  type SaleLineInput,
  type SaleQuote,
} from "@/lib/actions/pos";
import { POSAPI_PATHS } from "@/lib/ebarimt/constants";
import type { EbarimtReceiptResponse } from "@/lib/ebarimt/types";
import {
  addToCart,
  adjustLineQuantity,
  applyNumpad,
  cartQuantityByItem,
  parkTicket,
  parseParkedTickets,
  parseStoredCart,
  pressNumpad,
  removeLine,
  resolveScan,
  unparkTicket,
  type CartRow,
  type NumpadKey,
  type NumpadMode,
  type ParkedTicket,
  type StoredCart,
} from "@/lib/pos/checkout-state";
import type { CheckoutData, CheckoutItem } from "@/lib/pos/load-data";
import { ulaanbaatarNow } from "@/lib/pos/sale-math";
import type { PaymentInput } from "@/lib/pos/types";
import { fmtMnt } from "@/lib/reports/balances";
import { feedback } from "@/lib/ui/feedback";

const QUOTE_DEBOUNCE_MS = 250;
const DRAFT_SAVE_MS = 300;

const draftKey = (warehouseId: string) => `ea-pos-cart-${warehouseId}`;
const parkedKey = (warehouseId: string) => `ea-pos-parked-${warehouseId}`;

function readStorage(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown): boolean {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** PosAPI 3.0 `/rest/receipt` — browser горимд кассын PC-ийн localhost руу. */
async function callPosApiReceipt(
  base: string,
  method: "POST" | "DELETE",
  body: unknown
): Promise<EbarimtReceiptResponse> {
  const response = await fetch(`${base}${POSAPI_PATHS.receipt}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  let parsed: EbarimtReceiptResponse;
  try {
    parsed = (text ? JSON.parse(text) : {}) as EbarimtReceiptResponse;
  } catch {
    parsed = { message: text.slice(0, 500) };
  }
  return { ...parsed, httpStatus: response.status };
}

let lineSeq = 0;
const nextLineKey = () => `line-${Date.now().toString(36)}-${++lineSeq}`;

export function PosCheckoutView({
  data,
  cashierName,
}: {
  data: CheckoutData;
  cashierName: string;
}) {
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirm();

  // ── Ээлж / агуулах / харилцагч ─────────────────────────────────────────
  const [shiftId, setShiftId] = useState(data.openShifts[0]?.id ?? "");
  const shift = useMemo(
    () => data.openShifts.find((entry) => entry.id === shiftId) ?? data.openShifts[0] ?? null,
    [data.openShifts, shiftId]
  );
  const [closingShift, setClosingShift] = useState(false);
  // Агуулах ээлжийнхээр default; кассчин сольж болно (сонголт тухайн ээлжид л хүчинтэй).
  const [warehouseChoice, setWarehouseChoice] = useState<{ shiftId: string; id: string } | null>(null);
  const warehouseId =
    warehouseChoice && warehouseChoice.shiftId === (shift?.id ?? "")
      ? warehouseChoice.id
      : (shift?.warehouseId ??
        data.lastShift?.warehouseId ??
        data.settings.defaultWarehouseId ??
        data.warehouses[0]?.id ??
        "");
  const warehouseName = data.warehouses.find((w) => w.id === warehouseId)?.name ?? "";

  const walkIn = useMemo(
    () =>
      data.customers.find((customer) => customer.isWalkIn) ??
      data.customers.find((customer) => customer.id === data.settings.walkInCounterpartyId) ??
      null,
    [data.customers, data.settings.walkInCounterpartyId]
  );
  const [customerId, setCustomerId] = useState(walkIn?.id ?? "");
  const customer = useMemo(
    () => data.customers.find((entry) => entry.id === customerId) ?? walkIn,
    [data.customers, customerId, walkIn]
  );
  const customerOptions = useMemo(
    () =>
      data.customers.map((entry) => ({
        value: entry.id,
        label: entry.name,
        hint: entry.customerGroup ?? undefined,
      })),
    [data.customers]
  );

  // ── Сагс ───────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartRow[]>([]);
  const [couponCodes, setCouponCodes] = useState<string[]>([]);
  const [receiptDiscountMode, setReceiptDiscountMode] = useState<"percent" | "amount">("percent");
  const [receiptDiscountValue, setReceiptDiscountValue] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [numpadMode, setNumpadMode] = useState<NumpadMode>("qty");
  const [numpadBuffer, setNumpadBuffer] = useState("");
  const [parked, setParked] = useState<ParkedTicket[]>([]);

  const [discountOpen, setDiscountOpen] = useState(false);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  /** Төлбөрийн диалогийг нээх бүрд remount (мөрүүд цэвэр эхэлнэ). */
  const [paymentSession, setPaymentSession] = useState(0);
  const [saleBusy, setSaleBusy] = useState(false);
  const [receipt, setReceipt] = useState<PosReceipt | null>(null);
  /** Сүүлийн үнийн санал — аль оролтод (key) хамаарахыг хамт хадгална. */
  const [quoteState, setQuoteState] = useState<{ key: string; quote: SaleQuote | null; error: string } | null>(null);

  const itemIds = useMemo(() => new Set(data.items.map((item) => item.id)), [data.items]);

  const applyStored = useCallback(
    (stored: StoredCart) => {
      setCart(stored.cart);
      setCouponCodes(stored.couponCodes);
      setReceiptDiscountMode(stored.receiptDiscountMode);
      setReceiptDiscountValue(stored.receiptDiscountValue);
      setCustomerId(
        stored.customerId && data.customers.some((entry) => entry.id === stored.customerId)
          ? stored.customerId
          : (walkIn?.id ?? "")
      );
      setSelectedKey(null);
      setNumpadBuffer("");
    },
    [data.customers, walkIn?.id]
  );

  // Ноорог + парк сэргээх — агуулах бүрд тусдаа түлхүүр (шинэ агуулах бүрд нэг удаа).
  const restoredFor = useRef<string | null>(null);
  const draftReady = useRef(false);
  useEffect(() => {
    if (!warehouseId || restoredFor.current === warehouseId) return;
    restoredFor.current = warehouseId;
    draftReady.current = false;
    // localStorage = гадаад систем; state-ийг дараагийн tick-т тавина
    // (effect дотор шууд setState — cascading render).
    const timer = setTimeout(() => {
      setParked(parseParkedTickets(readStorage(parkedKey(warehouseId)), itemIds));
      const stored = parseStoredCart(readStorage(draftKey(warehouseId)), itemIds);
      setCart((current) => {
        if (stored && current.length === 0) {
          applyStored(stored);
          toast.info(`Дуусаагүй сагс сэргээгдлээ (${stored.cart.length} мөр)`);
          return stored.cart;
        }
        return current;
      });
      draftReady.current = true;
    }, 0);
    return () => clearTimeout(timer);
  }, [warehouseId, itemIds, applyStored]);

  // Ноорог автоматаар хадгалагдана — хуудас дахин ачаалахад сагс алдагдахгүй.
  useEffect(() => {
    if (!warehouseId || !draftReady.current) return;
    const timer = setTimeout(() => {
      const stored: StoredCart = { cart, couponCodes, receiptDiscountMode, receiptDiscountValue, customerId };
      writeStorage(draftKey(warehouseId), cart.length > 0 ? stored : null);
    }, DRAFT_SAVE_MS);
    return () => clearTimeout(timer);
  }, [cart, couponCodes, receiptDiscountMode, receiptDiscountValue, customerId, warehouseId]);

  const persistParked = useCallback(
    (list: ParkedTicket[]) => {
      setParked(list);
      if (!writeStorage(parkedKey(warehouseId), list.length > 0 ? list : null))
        toast.error("Хөтчийн хадгалалт хаалттай байна");
    },
    [warehouseId]
  );

  const receiptDiscountNumber = Number(receiptDiscountValue);
  const receiptDiscountPercent =
    receiptDiscountMode === "percent" && receiptDiscountNumber > 0 ? receiptDiscountNumber : null;
  const receiptDiscountAmount =
    receiptDiscountMode === "amount" && receiptDiscountNumber > 0 ? receiptDiscountNumber : null;

  const lineInputs = useMemo<SaleLineInput[]>(
    () =>
      cart.map((row) => ({
        itemId: row.itemId,
        quantity: row.quantity,
        unitPrice: row.priceOverridden ? row.unitPrice : undefined,
        manualDiscountPercent: row.manualDiscountPercent,
        manualDiscountAmount: row.manualDiscountAmount,
      })),
    [cart]
  );

  const quoteCustomerId = customer && !customer.isWalkIn ? customer.id : null;
  const quoteKey = useMemo(
    () =>
      JSON.stringify({ lineInputs, customerId: quoteCustomerId, couponCodes, receiptDiscountPercent, receiptDiscountAmount }),
    [lineInputs, quoteCustomerId, couponCodes, receiptDiscountPercent, receiptDiscountAmount]
  );
  const quoteKeyRef = useRef(quoteKey);
  useEffect(() => {
    quoteKeyRef.current = quoteKey;
  });

  // Серверийн үнийн санал — сагс / харилцагч / купон / гар хөнгөлөлт өөрчлөгдөх бүрд
  // (debounce). Хоцорч ирсэн хуучин хариуг key-ээр таньж хаяна.
  useEffect(() => {
    if (lineInputs.length === 0) return;
    const key = quoteKey;
    const timer = setTimeout(() => {
      quotePosSale({
        counterpartyId: quoteCustomerId,
        lines: lineInputs,
        couponCodes,
        receiptDiscountPercent,
        receiptDiscountAmount,
      })
        .then((result) => {
          if (quoteKeyRef.current !== key) return;
          setQuoteState({ key, quote: result.quote ?? null, error: result.error ?? "" });
        })
        .catch(() => {
          if (quoteKeyRef.current === key)
            setQuoteState({ key, quote: null, error: "Үнийн санал тооцогдсонгүй" });
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [quoteKey, lineInputs, quoteCustomerId, couponCodes, receiptDiscountPercent, receiptDiscountAmount]);

  const hasLines = lineInputs.length > 0;
  const quoteFresh = hasLines && quoteState?.key === quoteKey;
  /** Шинэчлэгдэж байх зуур өмнөх саналыг үзүүлнэ (анивчихгүй). */
  const quote = hasLines ? (quoteState?.quote ?? null) : null;
  const quoteBusy = hasLines && !quoteFresh;
  const quoteError = quoteFresh ? quoteState!.error : "";

  // ── Сагсны үйлдлүүд ────────────────────────────────────────────────────
  const searchRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLDivElement>(null);
  const focusSearch = useCallback(() => searchRef.current?.focus(), []);

  const selectLine = useCallback((key: string | null) => {
    setSelectedKey(key);
    setNumpadMode("qty");
    setNumpadBuffer("");
  }, []);

  const addItem = useCallback(
    (item: CheckoutItem) => {
      if (item.salesPrice == null) {
        toast.error(`${item.name}: борлуулах үнэ тохируулаагүй — Бараа, агуулах дээр оруулна уу`);
        return;
      }
      setCart((current) => addToCart(current, item, nextLineKey)?.cart ?? current);
      setSelectedKey(null);
      setNumpadBuffer("");
    },
    []
  );

  const incLine = useCallback((key: string) => {
    setCart((current) => adjustLineQuantity(current, key, 1));
    setNumpadBuffer("");
  }, []);
  const decLine = useCallback((key: string) => {
    setCart((current) => adjustLineQuantity(current, key, -1));
    setNumpadBuffer("");
  }, []);
  const dropLine = useCallback(
    (key: string) => {
      setCart((current) => removeLine(current, key));
      if (selectedKey === key) selectLine(null);
    },
    [selectedKey, selectLine]
  );

  // Numpad: товч бүр буферт орж, буфер ТУХАЙ БҮР сонгосон мөрд орно (Odoo-ийн заншил).
  const onNumpadKey = useCallback(
    (key: NumpadKey) => {
      if (!selectedKey) return;
      const buffer = pressNumpad(numpadBuffer, key);
      setNumpadBuffer(buffer);
      if (buffer === "" && numpadMode === "qty") return; // ⌫-ээр хоосолбол тоог хөндөхгүй
      setCart((current) => applyNumpad(current, selectedKey, numpadMode, buffer));
    },
    [selectedKey, numpadBuffer, numpadMode]
  );
  const onNumpadMode = useCallback((mode: NumpadMode) => {
    setNumpadMode(mode);
    setNumpadBuffer("");
  }, []);
  // Тоо 0 → мөр хасагдсан бол сонголт ҮР ДҮНГЭЭР нь алга болно (effect биш, deriv).
  const activeKey = selectedKey && cart.some((row) => row.key === selectedKey) ? selectedKey : null;

  const resetCart = useCallback(() => {
    setCart([]);
    setCouponCodes([]);
    setReceiptDiscountValue("");
    setSelectedKey(null);
    setNumpadBuffer("");
    if (walkIn) setCustomerId(walkIn.id);
  }, [walkIn]);

  const clearCart = useCallback(async () => {
    if (cart.length === 0) return;
    const ok = await confirm({
      title: "Сагс цэвэрлэх",
      description: `${cart.length} мөрийг хасах уу?`,
      confirmText: "Цэвэрлэх",
      danger: true,
    });
    if (!ok) return;
    writeStorage(draftKey(warehouseId), null);
    resetCart();
    focusSearch();
  }, [cart.length, confirm, warehouseId, resetCart, focusSearch]);

  const parkCurrent = useCallback(
    (silent = false) => {
      if (cart.length === 0) return false;
      const ticket: ParkedTicket = {
        id: `park-${Date.now().toString(36)}`,
        parkedAt: new Date().toISOString(),
        label: customer && !customer.isWalkIn ? customer.name : "",
        cart,
        couponCodes,
        receiptDiscountMode,
        receiptDiscountValue,
        customerId,
        lineCount: cart.length,
        total: quote?.total ?? null,
      };
      persistParked(parkTicket(parked, ticket));
      writeStorage(draftKey(warehouseId), null);
      resetCart();
      if (!silent) toast.success("Сагс түр хадгалагдлаа — «Түр хадгалах» дээрх тооноос сэргээнэ");
      return true;
    },
    [cart, customer, couponCodes, receiptDiscountMode, receiptDiscountValue, customerId, quote?.total, persistParked, parked, warehouseId, resetCart]
  );

  function restoreParked(id: string) {
    const ticket = parked.find((entry) => entry.id === id);
    if (!ticket) return;
    let list = parked;
    if (cart.length > 0) {
      // Одоогийн сагсыг алдахгүй — автоматаар парклана (диалогийн тайлбарт бичсэн).
      const current: ParkedTicket = {
        id: `park-${Date.now().toString(36)}`,
        parkedAt: new Date().toISOString(),
        label: customer && !customer.isWalkIn ? customer.name : "",
        cart,
        couponCodes,
        receiptDiscountMode,
        receiptDiscountValue,
        customerId,
        lineCount: cart.length,
        total: quote?.total ?? null,
      };
      list = parkTicket(list, current);
    }
    persistParked(unparkTicket(list, id));
    applyStored(ticket);
    setParkedOpen(false);
    focusSearch();
  }

  // ── Хайлт / сканнер ────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");

  const commitScan = useCallback(() => {
    const needle = query.trim();
    if (!needle) return;
    const picked = resolveScan(data.items, needle);
    if (!picked) {
      toast.error(`«${needle}» бараа олдсонгүй`);
      return;
    }
    addItem(picked);
    setQuery("");
    focusSearch();
  }, [query, data.items, addItem, focusSearch]);

  // ── Төлбөр ─────────────────────────────────────────────────────────────
  const canPay = cart.length > 0 && !!quote && !quoteError && !quoteBusy && !!shift && !saleBusy;

  const openPayment = useCallback(() => {
    if (!shift) return toast.error("Эхлээд ээлж нээнэ үү");
    if (cart.length === 0) return toast.error("Сагс хоосон байна");
    if (!quote || quoteError || quoteBusy)
      return toast.error(quoteError || "Үнийн санал тооцогдож байна…");
    setPaymentSession((value) => value + 1);
    setPaymentOpen(true);
  }, [shift, cart.length, quote, quoteError, quoteBusy]);

  // ── Глобал товчлуур ────────────────────────────────────────────────────
  const keyHandlers = useRef({ openPayment, clearCart, commitScan, selectLine, incLine, decLine, dropLine });
  useEffect(() => {
    keyHandlers.current = { openPayment, clearCart, commitScan, selectLine, incLine, decLine, dropLine };
  });
  const keyState = useRef({ query, selectedKey: activeKey, cartKeys: [] as string[] });
  useEffect(() => {
    keyState.current = { query, selectedKey: activeKey, cartKeys: cart.map((row) => row.key) };
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const dialogOpen = document.querySelector('[data-slot="dialog-content"]') !== null;
      if (dialogOpen) return;
      const target = event.target as HTMLElement | null;
      const isSearch = target === searchRef.current;
      const typingElsewhere =
        !isSearch &&
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const h = keyHandlers.current;
      const s = keyState.current;
      if (event.key === "F9") {
        event.preventDefault();
        h.openPayment();
        return;
      }
      if (event.key === "F2" || (event.key === "/" && !isSearch && !typingElsewhere)) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key === "F4") {
        event.preventDefault();
        setDiscountOpen(true);
        return;
      }
      if (event.key === "F6") {
        event.preventDefault();
        customerRef.current?.querySelector("button")?.focus();
        return;
      }
      if (typingElsewhere) return;
      // Хайлтын мөр хоосон үед л мөрийн товчлуурууд (бичиж байхад саад болохгүй).
      if (s.query !== "") return;
      if (document.querySelector("[data-searchable-portal]")) return;
      if (event.key === "Escape") {
        if (s.selectedKey) h.selectLine(null);
        else void h.clearCart();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (s.cartKeys.length === 0) return;
        event.preventDefault();
        const index = s.selectedKey ? s.cartKeys.indexOf(s.selectedKey) : -1;
        const next =
          event.key === "ArrowDown"
            ? Math.min(index + 1, s.cartKeys.length - 1)
            : Math.max(index - 1, 0);
        h.selectLine(s.cartKeys[next] ?? null);
        return;
      }
      if (!s.selectedKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        h.incLine(s.selectedKey);
      } else if (event.key === "-") {
        event.preventDefault();
        h.decLine(s.selectedKey);
      } else if (event.key === "Delete") {
        event.preventDefault();
        h.dropLine(s.selectedKey);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Ticket-ийн мөрүүд (сагс + серверийн quote + үлдэгдэл) ─────────────
  const cartQtyByItem = useMemo(() => cartQuantityByItem(cart), [cart]);
  const ticketLines = useMemo<TicketLineView[]>(
    () =>
      cart.map((row, index) => {
        const quoted = quote?.lines[index];
        const stock = data.stock[`${row.itemId}|${warehouseId}`] ?? 0;
        return {
          ...row,
          discountAmount: quoted?.discountAmount ?? 0,
          discountCodes: quoted
            ? [...new Set(quoted.discountDetail.map((entry) => entry.ruleCode ?? entry.kind))].join(", ")
            : "",
          lineTotal: quoted?.lineTotal ?? Math.round(row.quantity * row.unitPrice * 100) / 100,
          stockAfter: stock - (cartQtyByItem.get(row.itemId) ?? 0),
        };
      }),
    [cart, quote, data.stock, warehouseId, cartQtyByItem]
  );

  const discountBreakdown = useMemo(() => {
    if (!quote) return [] as { code: string; amount: number }[];
    const map = new Map<string, number>();
    for (const line of quote.lines)
      for (const detail of line.discountDetail) {
        const code = detail.ruleCode ?? (detail.kind === "manual" ? "Гар хөнгөлөлт" : detail.kind === "receipt" ? "Баримт" : detail.kind);
        map.set(code, (map.get(code) ?? 0) + detail.amount);
      }
    return [...map.entries()].map(([code, amount]) => ({ code, amount: Math.round(amount * 100) / 100 }));
  }, [quote]);

  // ── eBarimt browser горим (§3 B) ─────────────────────────────────────────
  //
  // Сервер PosAPI-д хүрэхгүй үед кассын дэлгэц өөрөө localhost:7080 рүү
  // илгээж хариуг сервер рүү бичнэ. Алдаа нь борлуулалтыг ЗОГСООХГҮЙ —
  // чимээгүй console.error, дараагийн tick-т дахин оролдоно.
  const ebarimtBrowserMode =
    data.settings.ebarimtEnabled && data.settings.ebarimtMode === "browser";

  const flushEbarimtOutbox = useCallback(async () => {
    if (!ebarimtBrowserMode) return;
    try {
      const result = await getEbarimtOutbox();
      if (result.error || !result.items || result.items.length === 0) return;
      const base = (result.posApiUrl ?? "").trim().replace(/\/+$/, "");
      if (!base) return;
      for (const item of result.items) {
        try {
          if (item.cancel) {
            // Бүтэн буцаалт — DELETE (албан спек §6).
            const cancelResponse = await callPosApiReceipt(base, "DELETE", item.cancel);
            await recordEbarimtResponse({ submissionId: item.id, stage: "cancel", response: cancelResponse });
            continue;
          }
          if (!item.payload) continue;
          // Шинэ баримт, эсвэл хэсэгчилсэн буцаалтын засвар (payload.inactiveId — §5).
          const response = await callPosApiReceipt(base, "POST", item.payload);
          const recorded = await recordEbarimtResponse({ submissionId: item.id, stage: "send", response });
          // Сугалаа/QR DB-д хадгалагдахгүй (албан спек) — дэлгэц дээр байгаа ЭНЭ
          // борлуулалтын баримт бол хариуг шууд түүнд оноож нэг удаа хэвлүүлнэ.
          if (!recorded.error && recorded.ok && typeof response.id === "string")
            setReceipt((current) =>
              current && current.saleId === item.saleId
                ? {
                    ...current,
                    ebarimtId: response.id ?? current.ebarimtId,
                    ebarimtLottery: typeof response.lottery === "string" ? response.lottery : null,
                    ebarimtQrData: typeof response.qrData === "string" ? response.qrData : null,
                    ebarimtStatus: "sent",
                  }
                : current
            );
        } catch (caught) {
          console.error("eBarimt (browser горим) илгээлт амжилтгүй", caught);
        }
      }
    } catch (caught) {
      console.error("eBarimt (browser горим) дараалал уншигдсангүй", caught);
    }
  }, [ebarimtBrowserMode]);

  useEffect(() => {
    if (!ebarimtBrowserMode) return;
    const timer = setInterval(() => void flushEbarimtOutbox(), 30_000);
    return () => clearInterval(timer);
  }, [ebarimtBrowserMode, flushEbarimtOutbox]);

  async function confirmSale(payments: PaymentInput[], buyer: EbarimtBuyerInput) {
    if (!shift) return false;
    setSaleBusy(true);
    try {
      const result = await createPosSale({
        shiftId: shift.id,
        warehouseId,
        counterpartyId: customer && !customer.isWalkIn ? customer.id : null,
        lines: lineInputs,
        couponCodes,
        receiptDiscountPercent,
        receiptDiscountAmount,
        payments,
        ebarimtConsumerNo: buyer.ebarimtConsumerNo,
        ebarimtCustomerTin: buyer.ebarimtCustomerTin,
        ebarimtCustomerRegNo: buyer.ebarimtCustomerRegNo,
      });
      if (result.error || !result.receipt) {
        feedback.error(result.error ?? "Борлуулалт бичигдсэнгүй");
        return false;
      }
      feedback.posted(`${result.documentNo} батлагдлаа`);
      writeStorage(draftKey(warehouseId), null);
      setPaymentOpen(false);
      resetCart();
      setReceipt(result.receipt);
      router.refresh();
      // Browser горимд PosAPI нь кассын PC дээр — борлуулалтын дараа шууд түлхнэ.
      void flushEbarimtOutbox();
      return true;
    } finally {
      setSaleBusy(false);
    }
  }

  const setupMissing = data.cashAccounts.length === 0 || data.warehouses.length === 0;
  const discountsActive = couponCodes.length + (receiptDiscountNumber > 0 ? 1 : 0);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <Header
        cashierName={cashierName}
        shift={shift}
        warehouseId={warehouseId}
        warehouses={data.warehouses}
        onWarehouseChange={(id) => setWarehouseChoice({ shiftId: shift?.id ?? "", id })}
        shiftOptions={data.openShifts.length > 1 ? data.openShifts : undefined}
        onShiftChange={setShiftId}
        onCloseShift={() => setClosingShift(true)}
      />

      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <ProductPanel
          ref={searchRef}
          items={data.items}
          categories={data.categories}
          stock={data.stock}
          warehouseId={warehouseId}
          cartQtyByItem={cartQtyByItem}
          query={query}
          onQueryChange={setQuery}
          category={category}
          onCategoryChange={setCategory}
          onPick={addItem}
          onScan={commitScan}
        />
        <TicketPanel
          lines={ticketLines}
          selectedKey={activeKey}
          onSelect={selectLine}
          onInc={incLine}
          onDec={decLine}
          onRemove={dropLine}
          customerId={customerId}
          customerOptions={customerOptions}
          onCustomerChange={setCustomerId}
          customer={customer}
          customerRef={customerRef}
          quote={quote}
          quoteBusy={quoteBusy}
          quoteError={quoteError}
          isVatPayer={data.isVatPayer}
          vatRatePercent={data.vatRatePercent}
          discountBreakdown={discountBreakdown}
          numpadMode={numpadMode}
          onNumpadMode={onNumpadMode}
          numpadBuffer={numpadBuffer}
          onNumpadKey={onNumpadKey}
          discountsActive={discountsActive}
          onOpenDiscount={() => setDiscountOpen(true)}
          parkedCount={parked.length}
          onPark={() => void parkCurrent()}
          onOpenParked={() => setParkedOpen(true)}
          onClear={() => void clearCart()}
          canPay={canPay}
          saleBusy={saleBusy}
          onPay={openPayment}
          warehouseName={warehouseName}
          allowNegativeStock={data.settings.allowNegativeStock}
        />
      </div>

      {/* ── Ээлж нээгээгүй → нэг товчны диалог (дэлгэц ард нь харагдана) ── */}
      <Dialog open={!shift}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ээлж нээх</DialogTitle>
            <DialogDescription>
              {setupMissing
                ? "Борлуулалт эхлэхээс өмнө касс ба агуулах бүртгэлтэй байх ёстой."
                : "Кассанд байгаа бэлэн мөнгөө оруулаад «Ээлж нээх» дарна — борлуулалт бүр энэ ээлжид бүртгэгдэнэ."}
            </DialogDescription>
          </DialogHeader>
          {setupMissing ? (
            <EmptyState
              icon="cash"
              title="Касс эсвэл агуулах бүртгэгдээгүй"
              description="Эхлээд Мөнгөн хөрөнгө → Данс болон Бараа материал → Агуулах бүртгэнэ үү."
              actions={[
                { label: "Кассын данс", href: "/cash/accounts", icon: "cash" },
                { label: "Агуулах", href: "/inventory/items", icon: "warehouse", primary: true },
              ]}
            />
          ) : (
            !shift && (
              <OpenShiftForm
                autoFocus
                cashAccounts={data.cashAccounts}
                warehouses={data.warehouses}
                defaultWarehouseId={data.lastShift?.warehouseId ?? data.settings.defaultWarehouseId}
                defaultCashAccountId={data.lastShift?.cashAccountId}
                defaultOpeningFloat={data.lastShift?.countedCash}
                openingHint={
                  data.lastShift?.countedCash != null
                    ? `Өмнөх ээлжийн хаалтад тоолсон бэлэн: ${fmtMnt(data.lastShift.countedCash)}₮`
                    : undefined
                }
                onDone={(opened) => {
                  setShiftId(opened.id);
                  router.refresh();
                  setTimeout(focusSearch, 50);
                }}
              />
            )
          )}
        </DialogContent>
      </Dialog>

      <DiscountDialog
        open={discountOpen}
        onOpenChange={(open) => {
          setDiscountOpen(open);
          if (!open) focusSearch();
        }}
        couponCodes={couponCodes}
        onCouponCodesChange={setCouponCodes}
        receiptDiscountMode={receiptDiscountMode}
        onReceiptDiscountModeChange={setReceiptDiscountMode}
        receiptDiscountValue={receiptDiscountValue}
        onReceiptDiscountValueChange={setReceiptDiscountValue}
        maxManualDiscountPercent={data.settings.maxManualDiscountPercent}
      />
      <ParkedDialog
        open={parkedOpen}
        onOpenChange={(open) => {
          setParkedOpen(open);
          if (!open) focusSearch();
        }}
        tickets={parked}
        onRestore={restoreParked}
        onDelete={(id) => persistParked(unparkTicket(parked, id))}
      />
      <CloseShiftDialog
        shift={closingShift ? shift : null}
        onClose={() => setClosingShift(false)}
        onDone={() => router.refresh()}
      />
      <PaymentDialog
        key={paymentSession}
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        methods={data.methods}
        total={quote?.total ?? 0}
        customer={customer}
        shift={shift}
        cashRoundingUnit={data.settings.cashRoundingUnit}
        ebarimtEnabled={data.settings.ebarimtEnabled}
        busy={saleBusy}
        onConfirm={confirmSale}
      />
      <ReceiptPreview
        receipt={receipt}
        onClose={() => {
          setReceipt(null);
          focusSearch();
        }}
      />
      {confirmDialog}
    </section>
  );
}

function Header({
  cashierName,
  shift,
  warehouseId,
  warehouses,
  onWarehouseChange,
  shiftOptions,
  onShiftChange,
  onCloseShift,
}: {
  cashierName: string;
  shift: CheckoutData["openShifts"][number] | null;
  warehouseId: string;
  warehouses: CheckoutData["warehouses"];
  onWarehouseChange: (id: string) => void;
  shiftOptions?: CheckoutData["openShifts"];
  onShiftChange?: (id: string) => void;
  onCloseShift: () => void;
}) {
  // Цаг — зөвхөн mount-ийн дараа (SSR-тэй зөрөхгүй), минут тутам.
  const [clock, setClock] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setClock(ulaanbaatarNow().time);
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ea-text-3)]">
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Касс</h1>
        {shift ? (
          <>
            {shiftOptions ? (
              <select
                className="ea-form-select h-8 w-auto text-xs"
                value={shift.id}
                onChange={(event) => onShiftChange?.(event.target.value)}
              >
                {shiftOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.documentNo} · {entry.cashAccountName}
                  </option>
                ))}
              </select>
            ) : (
              <StatusBadge tone="success" size="sm" className="font-mono">
                {shift.documentNo}
              </StatusBadge>
            )}
            <span>Касс: {shift.cashAccountName}</span>
          </>
        ) : (
          <StatusBadge tone="muted" size="sm">
            Ээлж нээгээгүй
          </StatusBadge>
        )}
        <label className="flex items-center gap-1">
          <span>Агуулах:</span>
          <select
            className="ea-form-select h-8 w-auto text-xs"
            value={warehouseId}
            onChange={(event) => onWarehouseChange(event.target.value)}
            disabled={!shift}
          >
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <span>Кассчин: {cashierName || shift?.openedByName}</span>
        {clock && <span className="font-mono text-[var(--ea-text-2)]">{clock}</span>}
      </div>
      {shift && (
        <Button variant="outline" size="sm" type="button" onClick={onCloseShift}>
          <Icon name="locked" size="sm" />
          Ээлж хаах
        </Button>
      )}
    </div>
  );
}

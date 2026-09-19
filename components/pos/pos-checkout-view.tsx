"use client";

// Кассын дэлгэц `/inventory/pos` — docs/pos/00-proposal.md §4.1.
//
// Зүүн: сканнер/хайлт (keyboard wedge — Enter дээр barcode яг таарвал мөр
// нэмнэ/нэмэгдүүлнэ, үгүй бол код/нэрийн 8 хүртэлх санал) + сагсны хүснэгт
// (DataGridDynamic, Тоо / Үнэ / Хөнг % / Хөнг ₮ засагдана). Баруун: үнийн
// санал (`quotePosSale` — борлуулалттай ЯГ ижил хөдөлгөгч, 250мс debounce),
// купон, баримтын гар хөнгөлөлт, зөвшөөрлийн шалтгаан, төлбөр.
//
// Үнэ / хөнгөлөлт CLIENT талд ТООЦОГДОХГҮЙ — зөвхөн серверийн quote-ийг
// үзүүлнэ; сагс DB-д ноорог үүсгэхгүй (localStorage-д түр хадгална).
// Товчлуур: F9 төлбөр · F2 эсвэл "/" хайлт · F6 харилцагч · Esc цэвэрлэх.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CellKeyDownEvent,
  CellValueChangedEvent,
  ColDef,
  ICellRendererParams,
} from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { PaymentDialog, type EbarimtBuyerInput } from "@/components/pos/payment-dialog";
import { ReceiptPreview } from "@/components/pos/receipt-preview";
import { OpenShiftForm } from "@/components/pos/shift-dialogs";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkButton } from "@/components/ui/link-button";
import { SearchableSelect } from "@/components/ui/searchable-select";
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
import { parseMntInput } from "@/lib/grid/formatters";
import type { CheckoutData, CheckoutItem } from "@/lib/pos/load-data";
import type { PaymentInput } from "@/lib/pos/types";
import { fmtMnt } from "@/lib/reports/balances";
import { feedback } from "@/lib/ui/feedback";

const QUOTE_DEBOUNCE_MS = 250;
const MAX_MATCHES = 8;

interface CartRow {
  key: string;
  itemId: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  /** Кассчин үнийг гараар зассан (сервер зөвшөөрөл шаардана). */
  priceOverridden: boolean;
  salesPrice: number | null;
  manualDiscountPercent: number | null;
  manualDiscountAmount: number | null;
}

/** Grid-ийн мөр — сагсны мөр + серверийн quote-ийн үр дүн + үлдэгдэл. */
interface GridRow extends CartRow {
  discountAmount: number;
  discountCodes: string;
  lineTotal: number;
  stockAfter: number;
}

interface StoredCart {
  cart: CartRow[];
  couponCodes: string[];
  receiptDiscountMode: "percent" | "amount";
  receiptDiscountValue: string;
  customerId: string;
}

const storageKey = (warehouseId: string) => `ea-pos-cart-${warehouseId}`;

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

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

let lineSeq = 0;

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
  // Агуулах ээлжийнхээр default; кассчин сольж болно (сонголт тухайн ээлжид л хүчинтэй).
  const [warehouseChoice, setWarehouseChoice] = useState<{ shiftId: string; id: string } | null>(null);
  const warehouseId =
    warehouseChoice && warehouseChoice.shiftId === (shift?.id ?? "")
      ? warehouseChoice.id
      : (shift?.warehouseId ?? data.settings.defaultWarehouseId ?? data.warehouses[0]?.id ?? "");
  const setWarehouseId = useCallback(
    (id: string) => setWarehouseChoice({ shiftId: shift?.id ?? "", id }),
    [shift?.id]
  );

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
  const [couponInput, setCouponInput] = useState("");
  const [receiptDiscountMode, setReceiptDiscountMode] = useState<"percent" | "amount">("percent");
  const [receiptDiscountValue, setReceiptDiscountValue] = useState("");
  /** Сүүлийн үнийн санал — аль оролтод (key) хамаарахыг хамт хадгална. */
  const [quoteState, setQuoteState] = useState<{ key: string; quote: SaleQuote | null; error: string } | null>(null);

  const [paymentOpen, setPaymentOpen] = useState(false);
  /** Төлбөрийн диалогийг нээх бүрд remount (мөрүүд цэвэр эхэлнэ). */
  const [paymentSession, setPaymentSession] = useState(0);
  const [saleBusy, setSaleBusy] = useState(false);
  const [receipt, setReceipt] = useState<PosReceipt | null>(null);

  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items]);

  // Түр хадгалсан сагсыг сэргээх — агуулах бүрд тусдаа түлхүүр.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!warehouseId || restoredFor.current === warehouseId) return;
    restoredFor.current = warehouseId;
    // localStorage = гадаад систем; state-ийг дараагийн tick-т тавина
    // (effect дотор шууд setState — cascading render).
    const timer = setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(storageKey(warehouseId));
        if (!raw) return;
        const stored = JSON.parse(raw) as StoredCart;
        if (!Array.isArray(stored.cart) || stored.cart.length === 0) return;
        const valid = stored.cart.filter((row) => itemById.has(row.itemId));
        if (valid.length === 0) return;
        setCart((current) => (current.length === 0 ? valid : current));
        setCouponCodes(stored.couponCodes ?? []);
        setReceiptDiscountMode(stored.receiptDiscountMode ?? "percent");
        setReceiptDiscountValue(stored.receiptDiscountValue ?? "");
        if (stored.customerId && data.customers.some((entry) => entry.id === stored.customerId))
          setCustomerId(stored.customerId);
        toast.info(`Түр хадгалсан сагс сэргээгдлээ (${valid.length} мөр)`);
      } catch {
        // Хадгалалт эвдэрсэн байж болно — чимээгүй алгасна.
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [warehouseId, itemById, data.customers]);

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
      JSON.stringify({
        lineInputs,
        customerId: quoteCustomerId,
        couponCodes,
        receiptDiscountPercent,
        receiptDiscountAmount,
      }),
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
  const addItem = useCallback(
    (item: CheckoutItem) => {
      if (item.salesPrice == null) {
        toast.error(`${item.code} · ${item.name}: борлуулах үнэ тохируулаагүй — Бараа, агуулах дээр оруулна уу`);
        return;
      }
      setCart((current) => {
        const existing = current.find(
          (row) =>
            row.itemId === item.id &&
            !row.priceOverridden &&
            row.manualDiscountPercent == null &&
            row.manualDiscountAmount == null
        );
        if (existing)
          return current.map((row) =>
            row.key === existing.key ? { ...row, quantity: row.quantity + 1 } : row
          );
        return [
          ...current,
          {
            key: `line-${++lineSeq}`,
            itemId: item.id,
            code: item.code,
            name: item.name,
            unit: item.unit,
            quantity: 1,
            unitPrice: item.salesPrice!,
            priceOverridden: false,
            salesPrice: item.salesPrice,
            manualDiscountPercent: null,
            manualDiscountAmount: null,
          },
        ];
      });
    },
    []
  );

  const removeLine = useCallback((key: string) => {
    setCart((current) => current.filter((row) => row.key !== key));
  }, []);

  const resetCart = useCallback(() => {
    setCart([]);
    setCouponCodes([]);
    setCouponInput("");
    setReceiptDiscountValue("");
    if (walkIn) setCustomerId(walkIn.id);
  }, [walkIn]);

  async function clearCart() {
    if (cart.length === 0) return;
    const ok = await confirm({
      title: "Сагс цэвэрлэх",
      description: `${cart.length} мөрийг хасах уу? Түр хадгалсан сагс мөн устана.`,
      confirmText: "Цэвэрлэх",
      danger: true,
    });
    if (!ok) return;
    try {
      window.localStorage.removeItem(storageKey(warehouseId));
    } catch {
      // localStorage хаалттай байж болно.
    }
    resetCart();
    focusSearch();
  }

  function holdCart() {
    if (cart.length === 0) return toast.error("Сагс хоосон байна");
    const stored: StoredCart = {
      cart,
      couponCodes,
      receiptDiscountMode,
      receiptDiscountValue,
      customerId,
    };
    try {
      window.localStorage.setItem(storageKey(warehouseId), JSON.stringify(stored));
      toast.success("Сагс түр хадгалагдлаа — дараагийн нээлтэд сэргэнэ");
    } catch {
      toast.error("Хөтчийн хадгалалт хаалттай байна");
    }
  }

  // ── Хайлт / сканнер ────────────────────────────────────────────────────
  const searchRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLDivElement>(null);
  const [query, setQueryState] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  function setQuery(value: string) {
    setQueryState(value);
    setActiveIndex(0);
  }
  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [] as CheckoutItem[];
    const exact = data.items.filter(
      (item) => item.barcode?.toLowerCase() === needle || item.code.toLowerCase() === needle
    );
    const partial = data.items.filter(
      (item) =>
        !exact.includes(item) &&
        (item.code.toLowerCase().includes(needle) ||
          item.name.toLowerCase().includes(needle) ||
          (item.barcode?.toLowerCase().includes(needle) ?? false))
    );
    return [...exact, ...partial].slice(0, MAX_MATCHES);
  }, [data.items, query]);

  function commitSearch() {
    const needle = query.trim();
    if (!needle) return;
    const barcodeHit = data.items.find((item) => item.barcode === needle);
    const picked = barcodeHit ?? matches[activeIndex] ?? matches[0];
    if (!picked) {
      toast.error(`«${needle}» бараа олдсонгүй`);
      return;
    }
    addItem(picked);
    setQuery("");
    focusSearch();
  }

  // ── Глобал товчлуур ────────────────────────────────────────────────────
  const openPaymentRef = useRef<() => void>(() => {});
  const clearCartRef = useRef<() => void>(() => {});
  useEffect(() => {
    clearCartRef.current = () => void clearCart();
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const dialogOpen = document.querySelector('[data-slot="dialog-content"]') !== null;
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "F9") {
        event.preventDefault();
        if (!dialogOpen) openPaymentRef.current();
      } else if (event.key === "F2" || (event.key === "/" && !typing)) {
        if (dialogOpen) return;
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === "F6") {
        if (dialogOpen) return;
        event.preventDefault();
        customerRef.current?.querySelector("button")?.focus();
      } else if (event.key === "Escape") {
        // Диалог / dropdown / grid-ийн муж Esc-ийг өөрсдөө барина.
        if (dialogOpen || typing || document.querySelector("[data-searchable-portal]")) return;
        clearCartRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Grid ───────────────────────────────────────────────────────────────
  const cartQtyByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of cart) map.set(row.itemId, (map.get(row.itemId) ?? 0) + row.quantity);
    return map;
  }, [cart]);

  const gridRows = useMemo<GridRow[]>(
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

  const negativeLines = gridRows.filter((row) => row.stockAfter < 0);

  const removeLineRef = useRef(removeLine);
  useEffect(() => {
    removeLineRef.current = removeLine;
  }, [removeLine]);

  const columns = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        headerName: "#",
        width: 44,
        cellClass: "ag-center-cell text-xs",
        valueGetter: (p) => (p.node?.rowIndex == null ? "" : p.node.rowIndex + 1),
      },
      {
        headerName: "Бараа",
        colId: "item",
        minWidth: 180,
        flex: 1,
        valueGetter: (p) => (p.data ? `${p.data.code} · ${p.data.name}` : ""),
        tooltipValueGetter: (p) =>
          p.data?.priceOverridden ? `Үнэ зассан (жишиг ${fmtMnt(p.data.salesPrice ?? 0)})` : null,
      },
      {
        headerName: "Тоо",
        field: "quantity",
        width: 84,
        editable: true,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueParser: (p) => {
          const value = parseMntInput(p.newValue);
          return Number.isFinite(value) && value > 0 ? value : p.oldValue;
        },
        valueFormatter: (p) => fmtQty(Number(p.value ?? 0)),
      },
      {
        headerName: "Үнэ",
        field: "unitPrice",
        width: 116,
        editable: true,
        cellClass: (p) =>
          `ag-right-aligned-cell font-mono${p.data?.priceOverridden ? " text-[var(--ea-warning-fg)]" : ""}`,
        headerClass: "ag-right-aligned-header",
        valueParser: (p) => {
          const value = parseMntInput(p.newValue);
          return Number.isFinite(value) && value >= 0 ? value : p.oldValue;
        },
        valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
      },
      {
        headerName: "Хөнг %",
        field: "manualDiscountPercent",
        width: 84,
        editable: true,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueParser: (p) => {
          if (p.newValue == null || String(p.newValue).trim() === "") return null;
          const value = parseMntInput(p.newValue);
          return Number.isFinite(value) && value >= 0 && value <= 100 ? value : p.oldValue;
        },
        valueFormatter: (p) => (p.value == null ? "" : `${p.value}%`),
      },
      {
        headerName: "Хөнг ₮",
        field: "manualDiscountAmount",
        width: 100,
        editable: true,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueParser: (p) => {
          if (p.newValue == null || String(p.newValue).trim() === "") return null;
          const value = parseMntInput(p.newValue);
          return Number.isFinite(value) && value >= 0 ? value : p.oldValue;
        },
        valueFormatter: (p) => (p.value == null ? "" : fmtMnt(Number(p.value))),
      },
      {
        headerName: "Хөнгөлөлт",
        field: "discountAmount",
        width: 108,
        cellClass: "ag-right-aligned-cell font-mono text-xs text-[var(--ea-text-3)]",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => (Number(p.value) > 0 ? `−${fmtMnt(Number(p.value))}` : ""),
        tooltipValueGetter: (p) => p.data?.discountCodes || null,
      },
      {
        headerName: "Дүн",
        field: "lineTotal",
        width: 124,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
      },
      {
        headerName: "Үлдэгдэл",
        field: "stockAfter",
        width: 96,
        cellClass: (p) =>
          `ag-right-aligned-cell font-mono text-xs${
            (p.value ?? 0) < 0 ? " font-semibold text-[var(--ea-warning-fg)]" : ""
          }`,
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => `${(p.value ?? 0) < 0 ? "⚠ " : ""}${fmtQty(Number(p.value ?? 0))}`,
        tooltipValueGetter: (p) =>
          (p.value ?? 0) < 0 ? "Борлуулалтын дараа агуулахын үлдэгдэл хасах болно (D9)" : null,
      },
      {
        headerName: "",
        colId: "actions",
        width: 44,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-center",
        cellRenderer: (p: ICellRendererParams<GridRow>) =>
          p.data ? (
            <IconAction
              name="close"
              label="Мөр хасах"
              size="xs"
              variant="danger"
              onClick={() => removeLineRef.current(p.data!.key)}
            />
          ) : null,
      },
    ],
    []
  );

  const handleCellChange = useCallback((event: CellValueChangedEvent<GridRow>) => {
    const field = event.colDef.field as keyof CartRow | undefined;
    const row = event.data;
    if (!field || !row) return;
    setCart((current) =>
      current.map((entry) => {
        if (entry.key !== row.key) return entry;
        if (field === "unitPrice") {
          const price = Number(row.unitPrice);
          return {
            ...entry,
            unitPrice: price,
            priceOverridden: entry.salesPrice == null || Math.abs(price - entry.salesPrice) >= 0.01,
          };
        }
        if (field === "quantity") return { ...entry, quantity: Number(row.quantity) };
        if (field === "manualDiscountPercent")
          return {
            ...entry,
            manualDiscountPercent: row.manualDiscountPercent,
            manualDiscountAmount: row.manualDiscountPercent != null ? null : entry.manualDiscountAmount,
          };
        if (field === "manualDiscountAmount")
          return {
            ...entry,
            manualDiscountAmount: row.manualDiscountAmount,
            manualDiscountPercent: row.manualDiscountAmount != null ? null : entry.manualDiscountPercent,
          };
        return entry;
      })
    );
  }, []);

  const handleCellKeyDown = useCallback((event: CellKeyDownEvent<GridRow>) => {
    const keyboard = event.event as KeyboardEvent | null;
    if (!keyboard || keyboard.key !== "Delete" || !event.data) return;
    if (event.api.getEditingCells().length > 0) return;
    removeLineRef.current(event.data.key);
  }, []);

  // ── Хөнгөлөлтийн задаргаа (баруун карт) ────────────────────────────────
  const discountBreakdown = useMemo(() => {
    if (!quote) return [] as { code: string; amount: number }[];
    const map = new Map<string, number>();
    for (const line of quote.lines)
      for (const detail of line.discountDetail) {
        const code = detail.ruleCode ?? (detail.kind === "manual" ? "Гар" : detail.kind === "receipt" ? "Баримт" : detail.kind);
        map.set(code, (map.get(code) ?? 0) + detail.amount);
      }
    return [...map.entries()].map(([code, amount]) => ({ code, amount: Math.round(amount * 100) / 100 }));
  }, [quote]);

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
  useEffect(() => {
    openPaymentRef.current = openPayment;
  }, [openPayment]);

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
          if (item.kind === "cancel") {
            if (!item.cancel) continue;
            const cancelResponse = await callPosApiReceipt(base, "DELETE", item.cancel);
            const recorded = await recordEbarimtResponse({
              submissionId: item.id,
              stage: "cancel",
              response: cancelResponse,
            });
            if (recorded.error || !recorded.ok || !item.payload) continue;
            // Хэсэгчилсэн буцаалт: цуцлаад үлдсэн мөрөөр шинэ баримт.
            const sendResponse = await callPosApiReceipt(base, "POST", item.payload);
            await recordEbarimtResponse({
              submissionId: item.id,
              stage: "send",
              response: sendResponse,
            });
            continue;
          }
          if (!item.payload) continue;
          const response = await callPosApiReceipt(base, "POST", item.payload);
          await recordEbarimtResponse({ submissionId: item.id, stage: "send", response });
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
      try {
        window.localStorage.removeItem(storageKey(warehouseId));
      } catch {
        // localStorage хаалттай байж болно.
      }
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

  function addCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    if (couponCodes.includes(code)) {
      toast.info("Энэ купон нэмэгдсэн байна");
      setCouponInput("");
      return;
    }
    setCouponCodes((current) => [...current, code]);
    setCouponInput("");
  }

  // ── Ээлж нээгээгүй ─────────────────────────────────────────────────────
  if (!shift) {
    return (
      <section className="flex min-h-0 flex-1 flex-col gap-4">
        <Header cashierName={cashierName} shift={null} warehouseName="" />
        <div className="mx-auto w-full max-w-2xl rounded-lg border border-[var(--ea-border)] bg-[var(--ea-surface)] p-5">
          <div className="mb-1 text-base font-semibold text-[var(--ea-text-1)]">Ээлж нээх</div>
          <p className="mb-4 text-xs text-[var(--ea-text-3)]">
            Борлуулалт бүр нээлттэй ээлжид харьяалагдана — касс, агуулах, эхний мөнгөө оруулна уу.
          </p>
          {data.cashAccounts.length === 0 || data.warehouses.length === 0 ? (
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
            <OpenShiftForm
              cashAccounts={data.cashAccounts}
              warehouses={data.warehouses}
              defaultWarehouseId={data.settings.defaultWarehouseId}
              onDone={(opened) => {
                setShiftId(opened.id);
                router.refresh();
              }}
            />
          )}
        </div>
      </section>
    );
  }

  const warehouseName = data.warehouses.find((w) => w.id === warehouseId)?.name ?? "";

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <Header
        cashierName={cashierName}
        shift={shift}
        warehouseName={warehouseName}
        shiftOptions={data.openShifts.length > 1 ? data.openShifts : undefined}
        onShiftChange={setShiftId}
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Зүүн: хайлт + сагс ── */}
        <div className="flex min-h-0 flex-col gap-2">
          <div className="relative">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  ref={searchRef}
                  autoFocus
                  value={query}
                  placeholder="Barcode / нэр / код … ⏎  (F2 эсвэл /)"
                  className="h-10 pr-9 text-base"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitSearch();
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setActiveIndex((index) => Math.min(index + 1, Math.max(0, matches.length - 1)));
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveIndex((index) => Math.max(0, index - 1));
                    } else if (event.key === "Escape" && query) {
                      event.stopPropagation();
                      setQuery("");
                    }
                  }}
                />
                <Icon
                  name="search"
                  size="sm"
                  className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[var(--ea-text-4)]"
                />
              </div>
              <select
                className="ea-form-select w-48"
                value={warehouseId}
                title="Агуулах"
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                {data.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} · {warehouse.name}
                  </option>
                ))}
              </select>
            </div>
            {query.trim() && (
              <MatchList
                matches={matches}
                activeIndex={activeIndex}
                stock={data.stock}
                warehouseId={warehouseId}
                onHover={setActiveIndex}
                onPick={(item) => {
                  addItem(item);
                  setQuery("");
                  focusSearch();
                }}
              />
            )}
          </div>

          {cart.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed border-[var(--ea-border)]">
              <EmptyState
                icon="inventory"
                title="Сагс хоосон"
                description="Сканнераар уншуулах эсвэл нэр/кодоор хайж бараа нэмнэ үү."
              />
            </div>
          ) : (
            <DataGridDynamic<GridRow>
              rowData={gridRows}
              columnDefs={columns}
              getRowId={(params) => params.data.key}
              onCellValueChanged={handleCellChange}
              onCellKeyDown={handleCellKeyDown}
              height="flex"
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              singleClickEdit
              stopEditingWhenCellsLoseFocus
            />
          )}

          {negativeLines.length > 0 && (
            <div className="rounded-md border border-[var(--ea-warning)] bg-[color-mix(in_srgb,var(--ea-warning)_10%,transparent)] px-3 py-1.5 text-xs text-[var(--ea-warning-fg)]">
              {negativeLines.map((row) => (
                <div key={row.key}>
                  ⚠ {row.code} · {row.name} — үлдэгдэл {fmtQty(row.stockAfter)} {row.unit} ({warehouseName})
                  {!data.settings.allowNegativeStock && " · хасах үлдэгдэл хориотой тохиргоотой"}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Баруун: харилцагч + дүн + төлбөр ── */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="rounded-lg border border-[var(--ea-border)] bg-[var(--ea-surface)] p-3">
            <Label className="mb-1.5">Харилцагч (F6)</Label>
            <div ref={customerRef}>
              <SearchableSelect
                value={customerId}
                onChange={setCustomerId}
                options={customerOptions}
                hideValue
                placeholder="Бэлэн худалдан авагч"
              />
            </div>
            {customer && !customer.isWalkIn && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-[var(--ea-text-3)]">
                <span>Бүлэг: {customer.customerGroup ?? "—"}</span>
                {customer.creditLimit != null && <span>Зээлийн лимит: {fmtMnt(customer.creditLimit)}₮</span>}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[var(--ea-border)] bg-[var(--ea-surface)] p-3">
            <div className="space-y-1 text-sm">
              <TotalRow label="Нийт (хөнг. өмнө)" value={quote ? fmtMnt(quote.grossAmount) : "—"} />
              <TotalRow
                label="Хөнгөлөлт"
                value={quote && quote.discountTotal > 0 ? `−${fmtMnt(quote.discountTotal)}` : "0"}
              />
              {discountBreakdown.length > 0 && (
                <div className="pl-3 text-[11px] text-[var(--ea-text-3)]">
                  {discountBreakdown.map((entry) => (
                    <div key={entry.code} className="flex justify-between">
                      <span className="truncate">{entry.code}</span>
                      <span className="font-mono">−{fmtMnt(entry.amount)}</span>
                    </div>
                  ))}
                  {quote?.receiptDiscounts.map((entry, index) => (
                    <div key={`r-${index}`} className="flex justify-between">
                      <span className="truncate">{entry.ruleCode ?? "Баримт"} (баримт)</span>
                      <span className="font-mono">−{fmtMnt(entry.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {data.isVatPayer && (
                <TotalRow
                  label={`НӨАТ ${data.vatRatePercent}% (орсон)`}
                  value={quote ? fmtMnt(quote.vatAmount) : "—"}
                />
              )}
              <div className="mt-2 flex items-baseline justify-between border-t border-[var(--ea-border)] pt-2">
                <span className="text-sm font-semibold">ТӨЛӨХ</span>
                <span className="font-mono text-2xl font-bold text-[var(--ea-text-1)]">
                  {quote ? fmtMnt(quote.total) : "0"}
                </span>
              </div>
              <div className="h-4 text-[11px] text-[var(--ea-text-4)]">
                {quoteBusy ? "Тооцож байна…" : quoteError ? (
                  <span className="text-[var(--ea-danger-fg)]">{quoteError}</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-[var(--ea-border)] bg-[var(--ea-surface)] p-3">
            <Label>Купон</Label>
            <div className="flex gap-1.5">
              <Input
                value={couponInput}
                placeholder="Промо код"
                className="font-mono uppercase"
                onChange={(event) => setCouponInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCoupon();
                  }
                }}
              />
              <Button variant="outline" size="sm" type="button" onClick={addCoupon} className="h-8">
                Нэмэх
              </Button>
            </div>
            {couponCodes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {couponCodes.map((code) => (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--ea-border)] px-2 py-0.5 font-mono text-[11px]"
                  >
                    {code}
                    <IconAction
                      name="close"
                      label={`${code} хасах`}
                      size="xs"
                      onClick={() => setCouponCodes((current) => current.filter((entry) => entry !== code))}
                    />
                  </span>
                ))}
              </div>
            )}
            <Label>Баримтын хөнгөлөлт</Label>
            <div className="flex gap-1.5">
              <select
                className="ea-form-select w-24"
                value={receiptDiscountMode}
                onChange={(event) => setReceiptDiscountMode(event.target.value as "percent" | "amount")}
              >
                <option value="percent">%</option>
                <option value="amount">₮</option>
              </select>
              <Input
                type="number"
                min="0"
                value={receiptDiscountValue}
                placeholder={receiptDiscountMode === "percent" ? `≤ ${data.settings.maxManualDiscountPercent}%` : "Дүн"}
                className="font-mono text-right"
                onChange={(event) => setReceiptDiscountValue(event.target.value)}
              />
            </div>
          </div>

          {quote && quote.approvalReasons.length > 0 && (
            <div className="rounded-md border border-[var(--ea-warning)] bg-[color-mix(in_srgb,var(--ea-warning)_10%,transparent)] p-3 text-xs text-[var(--ea-warning-fg)]">
              <div className="mb-1 font-semibold">Менежерийн зөвшөөрөл шаардана (pos:post эрх)</div>
              <ul className="space-y-0.5">
                {quote.approvalReasons.map((reason, index) => (
                  <li key={index}>• {reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-auto space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" type="button" onClick={holdCart} disabled={cart.length === 0}>
                <Icon name="save" size="sm" />
                Түр хадгалах
              </Button>
              <Button variant="outline" type="button" onClick={clearCart} disabled={cart.length === 0}>
                <Icon name="reset" size="sm" />
                Цэвэрлэх (Esc)
              </Button>
            </div>
            <Button
              size="lg"
              type="button"
              className="h-12 w-full text-base font-semibold"
              disabled={!canPay}
              onClick={openPayment}
            >
              <Icon name="cash" size="md" />
              ТӨЛБӨР АВАХ (F9)
            </Button>
          </div>
        </div>
      </div>

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

/** Хайлтын саналын жагсаалт — сонголт эцэг рүү callback-аар (ref хөндөхгүй). */
function MatchList({
  matches,
  activeIndex,
  stock,
  warehouseId,
  onHover,
  onPick,
}: {
  matches: CheckoutItem[];
  activeIndex: number;
  stock: CheckoutData["stock"];
  warehouseId: string;
  onHover: (index: number) => void;
  onPick: (item: CheckoutItem) => void;
}) {
  return (
    <div className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-[var(--ea-border-strong)] bg-[var(--ea-surface)] shadow-lg">
      {matches.length === 0 ? (
        <div className="px-3 py-2 text-xs text-[var(--ea-text-3)]">Илэрц олдсонгүй</div>
      ) : (
        matches.map((item, index) => {
          const balance = stock[`${item.id}|${warehouseId}`] ?? 0;
          return (
            <button
              key={item.id}
              type="button"
              className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                index === activeIndex
                  ? "bg-[var(--ea-selected-bg)] text-[var(--ea-text-1)]"
                  : "text-[var(--ea-text-2)]"
              }`}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(item)}
            >
              <span className="min-w-0 truncate">
                <span className="font-mono text-xs text-[var(--ea-text-3)]">{item.code}</span> {item.name}
                {item.barcode && (
                  <span className="ml-2 font-mono text-[10px] text-[var(--ea-text-4)]">{item.barcode}</span>
                )}
              </span>
              <span className="shrink-0 font-mono text-xs">
                {item.salesPrice == null ? (
                  <span className="text-[var(--ea-danger-fg)]">үнэгүй</span>
                ) : (
                  fmtMnt(item.salesPrice)
                )}
                <span className={`ml-2 ${balance <= 0 ? "text-[var(--ea-warning-fg)]" : "text-[var(--ea-text-4)]"}`}>
                  {fmtQty(balance)} {item.unit}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--ea-text-3)]">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function Header({
  cashierName,
  shift,
  warehouseName,
  shiftOptions,
  onShiftChange,
}: {
  cashierName: string;
  shift: CheckoutData["openShifts"][number] | null;
  warehouseName: string;
  shiftOptions?: CheckoutData["openShifts"];
  onShiftChange?: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Касс (POS)</h1>
        {shift ? (
          <>
            {shiftOptions ? (
              <select
                className="ea-form-select w-auto"
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
              <span className="font-mono text-xs font-semibold">{shift.documentNo}</span>
            )}
            <span className="text-xs text-[var(--ea-text-3)]">Касс: {shift.cashAccountName}</span>
            <span className="text-xs text-[var(--ea-text-3)]">Агуулах: {warehouseName || shift.warehouseName}</span>
            <span className="text-xs text-[var(--ea-text-3)]">Кассчин: {cashierName || shift.openedByName}</span>
          </>
        ) : (
          <span className="text-xs text-[var(--ea-text-3)]">Кассчин: {cashierName}</span>
        )}
      </div>
      {shift && (
        <LinkButton href="/inventory/sales?tab=shifts" icon="locked">
          Ээлж хаах
        </LinkButton>
      )}
    </div>
  );
}

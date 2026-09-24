"use client";

// Кассын дэлгэцийн ЗҮҮН панель — docs/pos §4.1 v2 (дэлгүүрийн POS загвар):
//   хайлт/сканнер (keyboard wedge — Enter дээр `resolveScan`) →
//   бүлгийн chip (`FilterChips`) → барааны TILE grid (хүрэлцэх дэлгэцэд
//   нэг товшилт = сагсанд +1). Хайлт tile-ийг ГАЗАР ДЭЭР нь шүүнэ — тусдаа
//   dropdown байхгүй (Odoo / Loyverse-ийн заншил).

import { forwardRef, useMemo } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { FilterChips } from "@/components/ui/tabs";
import { filterCheckoutItems } from "@/lib/pos/checkout-state";
import type { CheckoutData, CheckoutItem } from "@/lib/pos/load-data";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

/** Нэг дор зурах tile-ийн дээд тоо — үлдсэнийг хайлтаар нарийсгана. */
const MAX_TILES = 240;

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

export interface ProductPanelProps {
  items: CheckoutItem[];
  categories: CheckoutData["categories"];
  stock: CheckoutData["stock"];
  warehouseId: string;
  /** Сагсан дахь тоо бараагаар — tile-ийн булангийн badge. */
  cartQtyByItem: Map<string, number>;
  query: string;
  onQueryChange: (value: string) => void;
  category: string;
  onCategoryChange: (code: string) => void;
  /** Tile товшилт. */
  onPick: (item: CheckoutItem) => void;
  /** Enter / сканнер. */
  onScan: () => void;
}

export const ProductPanel = forwardRef<HTMLInputElement, ProductPanelProps>(function ProductPanel(
  {
    items,
    categories,
    stock,
    warehouseId,
    cartQtyByItem,
    query,
    onQueryChange,
    category,
    onCategoryChange,
    onPick,
    onScan,
  },
  searchRef
) {
  const visible = useMemo(
    () => filterCheckoutItems(items, query, category || null),
    [items, query, category]
  );
  const shown = visible.slice(0, MAX_TILES);

  const chips = useMemo(
    () => [
      { value: "", label: "Бүгд" },
      ...categories.map((entry) => ({ value: entry.code, label: entry.name })),
    ],
    [categories]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="relative">
        <Input
          ref={searchRef}
          autoFocus
          value={query}
          placeholder="Сканнер · barcode · нэр · код …  ⏎ нэмнэ   (F2)"
          className="h-11 pr-10 text-base"
          autoComplete="off"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onScan();
            } else if (event.key === "Escape" && query) {
              event.stopPropagation();
              onQueryChange("");
            }
          }}
        />
        <Icon
          name="search"
          size="md"
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[var(--ea-text-4)]"
        />
      </div>

      {categories.length > 0 && (
        <div className="-mx-0.5 overflow-x-auto px-0.5 pb-0.5">
          <FilterChips options={chips} value={category} onChange={onCategoryChange} className="w-max" />
        </div>
      )}

      {shown.length === 0 ? (
        <div className="flex min-h-0 flex-1">
          <EmptyState
            icon="inventory"
            title={items.length === 0 ? "Борлуулах бараа алга" : "Бараа олдсонгүй"}
            description={
              items.length === 0
                ? "Бараа материал → Бараа дээр бараа бүртгээд борлуулах үнийг нь оруулна уу."
                : "Хайлтаа өөрчлөх эсвэл «Бүгд» бүлгийг сонгоно уу."
            }
            actions={
              items.length === 0
                ? [{ label: "Бараа", href: "/inventory/items", icon: "inventory", primary: true }]
                : []
            }
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-[var(--ea-border)] bg-[var(--ea-bg-2)] p-2">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.75rem,1fr))] gap-2">
            {shown.map((item) => (
              <ProductTile
                key={item.id}
                item={item}
                balance={stock[`${item.id}|${warehouseId}`] ?? 0}
                inCart={cartQtyByItem.get(item.id) ?? 0}
                onPick={onPick}
              />
            ))}
          </div>
          {visible.length > shown.length && (
            <p className="px-1 pt-3 pb-1 text-center text-[11px] text-[var(--ea-text-3)]">
              {visible.length - shown.length} бараа харагдахгүй байна — хайлтаар нарийсгана уу
            </p>
          )}
        </div>
      )}
    </div>
  );
});

function ProductTile({
  item,
  balance,
  inCart,
  onPick,
}: {
  item: CheckoutItem;
  balance: number;
  inCart: number;
  onPick: (item: CheckoutItem) => void;
}) {
  const noPrice = item.salesPrice == null;
  return (
    <button
      type="button"
      tabIndex={-1}
      title={`${item.code} · ${item.name}${item.barcode ? ` · ${item.barcode}` : ""}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(item)}
      className={cn(
        "ea-interactive relative flex h-[5.75rem] select-none flex-col justify-between rounded-lg border border-[var(--ea-border)] bg-[var(--ea-surface)] p-2 text-left shadow-[var(--ea-shadow-2)] hover:border-[var(--ea-primary)] hover:shadow-[var(--ea-shadow-hover)] active:translate-y-px",
        noPrice && "opacity-60",
        inCart > 0 && "border-[var(--ea-primary)] bg-[var(--ea-primary-50)]"
      )}
    >
      {inCart > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--ea-primary)] px-1 font-mono text-[11px] font-semibold text-[var(--primary-foreground)] shadow-[var(--ea-shadow-2)]">
          {fmtQty(inCart)}
        </span>
      )}
      <span className="line-clamp-2 text-[13px] leading-snug font-medium text-[var(--ea-text-1)]">
        {item.name}
      </span>
      <span className="flex items-end justify-between gap-1">
        <span
          className={cn(
            "font-mono text-sm font-semibold",
            noPrice ? "text-[var(--ea-danger-fg)]" : "text-[var(--ea-text-1)]"
          )}
        >
          {noPrice ? "үнэгүй" : fmtMnt(item.salesPrice!)}
        </span>
        <span
          className={cn(
            "font-mono text-[10px]",
            balance <= 0 ? "text-[var(--ea-warning-fg)]" : "text-[var(--ea-text-4)]"
          )}
        >
          {fmtQty(balance)} {item.unit}
        </span>
      </span>
    </button>
  );
}

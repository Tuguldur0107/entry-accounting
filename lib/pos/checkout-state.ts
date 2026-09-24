// Кассын дэлгэцийн ЦЭВЭР төлөв — docs/pos/00-proposal.md §4.1 (v2, дэлгүүрийн
// POS загвар). DB, React, `@/lib/db` импортгүй — client component шууд уншина,
// `tests/pos-checkout-state.test.ts` шалгана.
//
// Үнэ / хөнгөлөлт ЭНД ТООЦОГДОХГҮЙ — зөвхөн сагсны мөрийн ОРОЛТ (тоо, гар
// хөнгөлөлт) хадгалагдана; дүн нь серверийн `quotePosSale`-аас.
//
// Кассаас ҮНЭ ЗАСАХГҮЙ: үнэ нь барааны картын борлуулах үнэ (жинлэдэг бараанд
// кг-ийн үнэ, жин = тоо). Үнэ буулгах нь хөнгөлөлтөөр (хязгаар, тайлан, contra
// данс дагана), өсгөх нь барааны карт дээр (үнийн түүх) — хэрэглэгчийн шийдвэр
// 2026-09-24.

export interface CartRow {
  key: string;
  itemId: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  /** Барааны борлуулах үнэ (харуулах; сервер өөрөө дахин уншина). */
  unitPrice: number;
  manualDiscountPercent: number | null;
  manualDiscountAmount: number | null;
}

/** Сагсанд нэмэгдэх бараа — `CheckoutItem`-ийн дэд олонлог. */
export interface CartItemLike {
  id: string;
  code: string;
  name: string;
  unit: string;
  barcode?: string | null;
  categoryCode?: string | null;
  /** Ангиллын өвөг кодууд [өөр, эцэг, …] — эцэг ангиллын chip дэд ангиллын барааг ч харуулна. */
  categoryPath?: string[];
  salesPrice: number | null;
}

/** Numpad-ийн горим: сонгосон мөрийн аль талбарт бичих вэ. */
export type NumpadMode = "qty" | "discount";

export const NUMPAD_MODE_LABELS: Record<NumpadMode, string> = {
  qty: "Тоо",
  discount: "Хөнг %",
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Бараа нэмэх: хөнгөлөлтгүй ижил барааны мөр байвал тоог
 * нэмэгдүүлнэ, үгүй бол шинэ мөр. Борлуулах үнэгүй бараа НЭМЭГДЭХГҮЙ (үнэ
 * зохиохгүй) — `null` буцаана.
 */
export function addToCart(
  cart: CartRow[],
  item: CartItemLike,
  nextKey: () => string,
  quantity = 1
): { cart: CartRow[]; key: string } | null {
  if (item.salesPrice == null || !(quantity > 0)) return null;
  const existing = cart.find(
    (row) =>
      row.itemId === item.id &&
      row.manualDiscountPercent == null &&
      row.manualDiscountAmount == null
  );
  if (existing) {
    return {
      cart: cart.map((row) =>
        row.key === existing.key ? { ...row, quantity: row.quantity + quantity } : row
      ),
      key: existing.key,
    };
  }
  const key = nextKey();
  return {
    cart: [
      ...cart,
      {
        key,
        itemId: item.id,
        code: item.code,
        name: item.name,
        unit: item.unit,
        quantity,
        unitPrice: item.salesPrice,
        manualDiscountPercent: null,
        manualDiscountAmount: null,
      },
    ],
    key,
  };
}

/** Тоо ≤ 0 болбол мөр ХАСАГДАНА (дэлгүүрийн POS-ийн заншил). */
export function setLineQuantity(cart: CartRow[], key: string, quantity: number): CartRow[] {
  if (!Number.isFinite(quantity)) return cart;
  if (quantity <= 0) return cart.filter((row) => row.key !== key);
  return cart.map((row) => (row.key === key ? { ...row, quantity } : row));
}

export function adjustLineQuantity(cart: CartRow[], key: string, delta: number): CartRow[] {
  const row = cart.find((entry) => entry.key === key);
  if (!row) return cart;
  return setLineQuantity(cart, key, round2(row.quantity + delta));
}


/** Хувийн хөнгөлөлт 0–100; `null` бол арилгана. Дүнгийн хөнгөлөлттэй ХАМТ байхгүй. */
export function setLineDiscountPercent(
  cart: CartRow[],
  key: string,
  percent: number | null
): CartRow[] {
  if (percent != null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) return cart;
  return cart.map((row) =>
    row.key === key
      ? {
          ...row,
          manualDiscountPercent: percent != null && percent > 0 ? percent : null,
          manualDiscountAmount: percent != null && percent > 0 ? null : row.manualDiscountAmount,
        }
      : row
  );
}

export function setLineDiscountAmount(
  cart: CartRow[],
  key: string,
  amount: number | null
): CartRow[] {
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) return cart;
  return cart.map((row) =>
    row.key === key
      ? {
          ...row,
          manualDiscountAmount: amount != null && amount > 0 ? amount : null,
          manualDiscountPercent: amount != null && amount > 0 ? null : row.manualDiscountPercent,
        }
      : row
  );
}

export function removeLine(cart: CartRow[], key: string): CartRow[] {
  return cart.filter((row) => row.key !== key);
}

// ── Numpad ──────────────────────────────────────────────────────────────────

export type NumpadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "⌫";

/**
 * Буферт товч нэмнэ: давхар цэг үгүй, тэргүүний 0 солигдоно ("0" → "5" = "5",
 * "0." хэвээр), ⌫ сүүлийн тэмдэгтийг хасна. 12 тэмдэгтээс уртсахгүй.
 */
export function pressNumpad(buffer: string, key: NumpadKey): string {
  if (key === "⌫") return buffer.slice(0, -1);
  if (key === ".") return buffer.includes(".") ? buffer : buffer === "" ? "0." : `${buffer}.`;
  if (buffer.length >= 12) return buffer;
  if (buffer === "0") return key;
  return `${buffer}${key}`;
}

/** Буферийн тоон утга; хоосон / "." → null. */
export function numpadValue(buffer: string): number | null {
  if (buffer === "" || buffer === "." || buffer === "0.") return buffer === "0." ? 0 : null;
  const value = Number(buffer);
  return Number.isFinite(value) ? value : null;
}

/**
 * Буферийг сонгосон мөрд горимоор нь оруулна. Тоо 0 → мөр хасагдана; хөнгөлөлт
 * >100 → өөрчлөлтгүй.
 */
export function applyNumpad(
  cart: CartRow[],
  key: string,
  mode: NumpadMode,
  buffer: string
): CartRow[] {
  const value = numpadValue(buffer);
  if (value == null) return cart;
  switch (mode) {
    case "qty":
      return setLineQuantity(cart, key, value);
    case "discount":
      return setLineDiscountPercent(cart, key, value);
  }
}

// ── Хайлт / сканнер ─────────────────────────────────────────────────────────

/**
 * Tile-ийн шүүлт: бүлэг (null = бүгд) + хайлт. Яг таарсан barcode/код ЭХЭНД,
 * дараа нь код/нэр/barcode-д агуулагдсан. Хайлтгүй бол бүлгийн бүх бараа.
 */
export function filterCheckoutItems<T extends CartItemLike>(
  items: T[],
  query: string,
  categoryCode: string | null
): T[] {
  const scoped = categoryCode
    ? items.filter((item) =>
        item.categoryPath ? item.categoryPath.includes(categoryCode) : item.categoryCode === categoryCode
      )
    : items;
  const needle = query.trim().toLowerCase();
  if (!needle) return scoped;
  const exact: T[] = [];
  const partial: T[] = [];
  for (const item of scoped) {
    const code = item.code.toLowerCase();
    const barcode = item.barcode?.toLowerCase() ?? "";
    if (code === needle || (barcode !== "" && barcode === needle)) exact.push(item);
    else if (code.includes(needle) || item.name.toLowerCase().includes(needle) || barcode.includes(needle))
      partial.push(item);
  }
  return [...exact, ...partial];
}

/**
 * Enter / сканнер: яг таарсан barcode → яг таарсан код → БҮХ барааны дунд
 * (бүлгийн шүүлт үл хамааран) эхний илэрц. Олдохгүй бол null.
 */
export function resolveScan<T extends CartItemLike>(items: T[], query: string): T | null {
  const needle = query.trim();
  if (!needle) return null;
  const lower = needle.toLowerCase();
  return (
    items.find((item) => item.barcode != null && item.barcode.toLowerCase() === lower) ??
    items.find((item) => item.code.toLowerCase() === lower) ??
    filterCheckoutItems(items, needle, null)[0] ??
    null
  );
}

// ── Түр хадгалалт (localStorage-ийн бүтэц) ─────────────────────────────────

export interface StoredCart {
  cart: CartRow[];
  couponCodes: string[];
  receiptDiscountMode: "percent" | "amount";
  receiptDiscountValue: string;
  customerId: string;
}

export interface ParkedTicket extends StoredCart {
  id: string;
  parkedAt: string;
  /** Кассчины тэмдэглэл (ж: "Ноутбуктай залуу"). */
  label: string;
  lineCount: number;
  /** Парклах үеийн серверийн ТӨЛӨХ дүн — жагсаалтын лавлагаа (дахин quote хийгдэнэ). */
  total: number | null;
}

export const MAX_PARKED_TICKETS = 20;

export function emptyStoredCart(customerId = ""): StoredCart {
  return {
    cart: [],
    couponCodes: [],
    receiptDiscountMode: "percent",
    receiptDiscountValue: "",
    customerId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCartRow(value: unknown): CartRow | null {
  if (!isRecord(value)) return null;
  const quantity = Number(value.quantity);
  // Хуучин парк гараар зассан үнэ (`priceOverridden`) авч явж болно — касс үнэ
  // засахаа больсон тул барааны борлуулах үнэ рүү буцаана.
  const unitPrice = Number(value.salesPrice ?? value.unitPrice);
  if (typeof value.itemId !== "string" || typeof value.key !== "string") return null;
  if (!(quantity > 0) || !Number.isFinite(unitPrice) || unitPrice < 0) return null;
  const pct = value.manualDiscountPercent == null ? null : Number(value.manualDiscountPercent);
  const amt = value.manualDiscountAmount == null ? null : Number(value.manualDiscountAmount);
  return {
    key: value.key,
    itemId: value.itemId,
    code: String(value.code ?? ""),
    name: String(value.name ?? ""),
    unit: String(value.unit ?? ""),
    quantity,
    unitPrice,
    manualDiscountPercent: pct != null && pct > 0 && pct <= 100 ? pct : null,
    manualDiscountAmount: amt != null && amt > 0 ? amt : null,
  };
}

/**
 * Хадгалсан сагсыг шалгаж уншина: одоо байхгүй (идэвхгүй болсон) бараатай мөр
 * хасагдана; хүчинтэй мөргүй бол null.
 */
export function parseStoredCart(raw: unknown, knownItemIds: Set<string>): StoredCart | null {
  if (!isRecord(raw) || !Array.isArray(raw.cart)) return null;
  const cart = raw.cart
    .map(parseCartRow)
    .filter((row): row is CartRow => row !== null && knownItemIds.has(row.itemId));
  if (cart.length === 0) return null;
  const mode = raw.receiptDiscountMode === "amount" ? "amount" : "percent";
  return {
    cart,
    couponCodes: Array.isArray(raw.couponCodes)
      ? raw.couponCodes.filter((code): code is string => typeof code === "string")
      : [],
    receiptDiscountMode: mode,
    receiptDiscountValue: typeof raw.receiptDiscountValue === "string" ? raw.receiptDiscountValue : "",
    customerId: typeof raw.customerId === "string" ? raw.customerId : "",
  };
}

export function parseParkedTickets(raw: unknown, knownItemIds: Set<string>): ParkedTicket[] {
  if (!Array.isArray(raw)) return [];
  const tickets: ParkedTicket[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const stored = parseStoredCart(entry, knownItemIds);
    if (!stored) continue;
    const total = entry.total == null ? null : Number(entry.total);
    tickets.push({
      ...stored,
      id: entry.id,
      parkedAt: typeof entry.parkedAt === "string" ? entry.parkedAt : "",
      label: typeof entry.label === "string" ? entry.label : "",
      lineCount: stored.cart.length,
      total: total != null && Number.isFinite(total) ? total : null,
    });
  }
  return tickets.slice(0, MAX_PARKED_TICKETS);
}

/** Шинэ парк ЭХЭНД; MAX-аас илүү бол хамгийн хуучин нь хасагдана. */
export function parkTicket(list: ParkedTicket[], ticket: ParkedTicket): ParkedTicket[] {
  return [ticket, ...list.filter((entry) => entry.id !== ticket.id)].slice(0, MAX_PARKED_TICKETS);
}

export function unparkTicket(list: ParkedTicket[], id: string): ParkedTicket[] {
  return list.filter((entry) => entry.id !== id);
}

/** Сагсны нийт тоо (тоолуурын badge-д). */
export function cartQuantity(cart: CartRow[]): number {
  return round2(cart.reduce((sum, row) => sum + row.quantity, 0));
}

/** Бараа бүрийн сагсан дахь нийт тоо — үлдэгдлийн шалгалтад. */
export function cartQuantityByItem(cart: CartRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of cart) map.set(row.itemId, (map.get(row.itemId) ?? 0) + row.quantity);
  return map;
}

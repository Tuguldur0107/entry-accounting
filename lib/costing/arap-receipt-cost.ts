// PO-ГҮЙ АП нэхэмжлэхийн бараатай мөрөөс үүссэн орлогын (movement.sourceType
// "arap_line") өртөг — ЦЭВЭР (tests/arap-receipt-cost.test.ts).
//
// Урьд ийм орлого батлагдахад өртгийн бичилт үүсдэггүй тул сар бүр «үнэ
// хүлээж буй» жагсаалтад орж, хүлээн авалт бүрийн өртгийг гараар дахин
// бичүүлдэг байв; MCP-ийн run_monthly_costing-д үнэ өгөх зам ч байгаагүй
// (ENT-018). Нэхэмжлэхийн мөрийн дүн нь эх баримт тул өртөг ЗОХИОГДОХГҮЙ:
// дүн × баримтын ханш (MNT) ÷ тоо.

const round4 = (value: number) => Math.round(value * 10000) / 10000;
const round2 = (value: number) => Math.round(value * 100) / 100;

export interface ArapLineCostInput {
  /** Мөрийн дүн — баримтын валютаар (НӨАТ-гүй: НӨАТ нь тусдаа мөр). */
  amount: number | string;
  quantity: number | string | null;
  /** Баримтын ханш (MNT баримтад 1). */
  exchangeRate: number | string | null;
}

/** Нэгж өртөг (MNT) ба нийт дүн — тоо/дүн хүчингүй бол null (зохиохгүй). */
export function arapLineReceiptCost(
  input: ArapLineCostInput
): { unitCost: number; amount: number } | null {
  const quantity = Number(input.quantity);
  const amount = Number(input.amount);
  const rate = input.exchangeRate == null ? 1 : Number(input.exchangeRate);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const base = round2(amount * rate);
  return { unitCost: round4(base / quantity), amount: base };
}

/**
 * Өртгийн run-д АВТОМАТААР капиталжуулах arap_line орлого мөн үү (аудит M).
 * Run нь `asOfDate` хүртэл л үнэлнэ; ХААГДСАН үеийн орлогод ноорог ч, 0 дүнтэй
 * шууд «posted» бичилт ч үүсгэвэл snapshot (§4) хуучирч, хаалтын дараа
 * тухайн үеийн өртөг чимээгүй өөрчлөгдөнө — тийм орлого дахин нээж байж л
 * үнэлэгдэнэ.
 */
export function isArapCapitalizeCandidate(
  movement: { id: string; date: string },
  context: {
    asOfDate: string;
    closedPeriodCodes: ReadonlySet<string>;
    manuallyPriced: ReadonlySet<string>;
  }
): boolean {
  if (context.manuallyPriced.has(movement.id)) return false;
  if (movement.date > context.asOfDate) return false;
  return !context.closedPeriodCodes.has(movement.date.slice(0, 7));
}

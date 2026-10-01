// Урьдчилгааны ЦЭВЭР логик (docs/dev/arap.md §5l) — DB импортгүй тул client
// component ч импортолж болно (CLAUDE.md «Client/server хил»). Тесттэй:
// tests/arap-advances.test.ts.
//
//   Урьдчилж орсон орлого (customer): Dr банк / Cr урьдчилгааны өр
//     → дараа нь Dr урьдчилгааны өр / Cr авлага (нэхэмжлэхтэй суутгах)
//   Урьдчилж төлсөн (supplier):       Dr урьдчилж төлсөн / Cr банк
//     → дараа нь Dr өглөг / Cr урьдчилж төлсөн

export type AdvanceSide = "customer" | "supplier";

export const ADVANCE_SIDE_LABELS: Record<AdvanceSide, string> = {
  customer: "Урьдчилж орсон орлого",
  supplier: "Урьдчилж төлсөн зардал / урьдчилгаа",
};

/** Нэхэмжлэхийн төрлөөс аль урьдчилгаагаар хаагдахыг — бусад төрөлд null. */
export function advanceSideOf(documentType: string): AdvanceSide | null {
  if (documentType === "ar_invoice") return "customer";
  if (documentType === "ap_bill") return "supplier";
  return null;
}

/**
 * Урьдчилгааны кассын баримтын тэмдэг: худалдан авагчийн урьдчилгааг
 * орлогын баримт нэмэгдүүлж, буцаан олголт (зарлага) бууруулна; нийлүүлэгчид
 * эсрэгээрээ.
 */
export function advanceCashSign(side: AdvanceSide, cashDocumentType: string): 1 | -1 | 0 {
  if (cashDocumentType === "receipt") return side === "customer" ? 1 : -1;
  if (cashDocumentType === "payment") return side === "customer" ? -1 : 1;
  return 0;
}

export type AdvanceCashInput = {
  counterpartyId: string;
  side: AdvanceSide;
  documentType: string;
  /** MNT дүн (baseAmount). */
  amount: number;
};

export type AdvanceApplicationInput = {
  counterpartyId: string;
  side: AdvanceSide;
  amount: number;
};

export type AdvanceBalance = {
  counterpartyId: string;
  side: AdvanceSide;
  received: number;
  applied: number;
  balance: number;
};

const round = (value: number) => Math.round(value * 100) / 100;

/** Харилцагч × тал бүрийн урьдчилгааны үлдэгдэл (0-ээс бусад нь). */
export function computeAdvanceBalances(
  cash: AdvanceCashInput[],
  applications: AdvanceApplicationInput[]
): AdvanceBalance[] {
  const map = new Map<string, AdvanceBalance>();
  const slot = (counterpartyId: string, side: AdvanceSide) => {
    const key = `${counterpartyId}:${side}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { counterpartyId, side, received: 0, applied: 0, balance: 0 };
      map.set(key, entry);
    }
    return entry;
  };
  for (const row of cash) {
    const sign = advanceCashSign(row.side, row.documentType);
    if (sign === 0) continue;
    const entry = slot(row.counterpartyId, row.side);
    entry.received = round(entry.received + sign * row.amount);
  }
  for (const row of applications) {
    const entry = slot(row.counterpartyId, row.side);
    entry.applied = round(entry.applied + row.amount);
  }
  return [...map.values()]
    .map((entry) => ({ ...entry, balance: round(entry.received - entry.applied) }))
    .filter((entry) => Math.abs(entry.balance) > 0.005 || Math.abs(entry.received) > 0.005);
}

/**
 * Суутгах дүн — өгөгдөөгүй бол урьдчилгааны үлдэгдэл ба нэхэмжлэхийн
 * үлдэгдлийн бага нь; хэтэрвэл ил алдаа (ЗОХИОХГҮЙ). Алдааны текст эсвэл дүн.
 */
export function resolveAdvanceApplyAmount(input: {
  requested?: number | null;
  advanceBalance: number;
  invoiceBalance: number;
}): { amount: number } | { error: string } {
  const available = round(Math.min(input.advanceBalance, input.invoiceBalance));
  if (input.advanceBalance <= 0.005) return { error: "Энэ харилцагчид суутгах урьдчилгааны үлдэгдэл алга" };
  if (input.invoiceBalance <= 0.005) return { error: "Нэхэмжлэхийн үлдэгдэл алга" };
  if (input.requested == null) return { amount: available };
  const requested = round(Number(input.requested));
  if (!Number.isFinite(requested) || requested <= 0) return { error: "Суутгах дүн 0-ээс их байна" };
  if (requested > input.advanceBalance + 0.005)
    return { error: `Суутгах дүн урьдчилгааны үлдэгдлээс (${input.advanceBalance.toLocaleString("en-US")}) их байна` };
  if (requested > input.invoiceBalance + 0.005)
    return { error: `Суутгах дүн нэхэмжлэхийн үлдэгдлээс (${input.invoiceBalance.toLocaleString("en-US")}) их байна` };
  return { amount: requested };
}

// ── Банкны хуулгын мөрийн бүртгэлийн төрөл (lib/cash/import-statement.ts) ────

export const BANK_ROW_ACTIONS = ["advance_received", "prepaid_paid", "create_ap_bill"] as const;
export type BankRowAction = (typeof BANK_ROW_ACTIONS)[number];

export const BANK_ROW_ACTION_LABELS: Record<BankRowAction, string> = {
  advance_received: "Урьдчилж орсон орлого",
  prepaid_paid: "Урьдчилж төлсөн",
  create_ap_bill: "Өглөг үүсгэж зардалд",
};

export function isBankRowAction(value: unknown): value is BankRowAction {
  return typeof value === "string" && (BANK_ROW_ACTIONS as readonly string[]).includes(value);
}

/** Үйлдэл аль чиглэлийн мөрөнд хамаарах — орлого / зарлага. */
export function bankRowActionDirection(action: BankRowAction): "income" | "expense" {
  return action === "advance_received" ? "income" : "expense";
}

/** Урьдчилгааны үйлдлийн тал (өглөг үүсгэх нь урьдчилгаа биш → null). */
export function bankRowActionAdvanceSide(action: BankRowAction): AdvanceSide | null {
  if (action === "advance_received") return "customer";
  if (action === "prepaid_paid") return "supplier";
  return null;
}

/**
 * НӨАТ-ыг нийт дүнгээс салгана (inclusive, 10/110) — lib/vat/return.ts-ийн
 * splitVat-тай ижил томъёо (тэр нь DB-гүй ч client-д импортлохгүйн тулд энд).
 */
export function splitInclusiveVat(gross: number, ratePercent: number): { net: number; vat: number } {
  const vat = round((gross * ratePercent) / (100 + ratePercent));
  return { net: round(gross - vat), vat };
}

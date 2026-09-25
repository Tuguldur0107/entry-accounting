// Э-хэтэвчийн (QPay / SocialPay / MonPay) SETTLEMENT — банкны хуулгын мөрийг
// түр дансны тулгагдаагүй орлогуудтай тулгах ЦЭВЭР логик (DB-гүй, тесттэй).
//
// Урсгал: POS-ийн QPay төлбөр → `ewallet` хэлбэрийн ТҮР данс (cash_documents
// receipt, GL Dr түр данс / Cr авлага). Провайдер T+1-д шимтгэлээ суутгаад
// ЦЭВЭР дүнг мерчантын банкинд шилжүүлнэ — хуулгын тэр орлогын мөр нь
// settlement: түр данс → банк шилжүүлэг (цэвэр) + шимтгэлийн зардал, түр
// данснаас НИЙТ (gross) хасагдана. Ингэснээр түр данс 0 руу буцаж, касс модуль
// ба GL хоёул тулна (reconcile_modules).
//
// Тулгалт FIFO: түр дансны тулгагдаагүй орлогуудыг огноогоор нийлүүлж, орлого
// бүрийн шимтгэлийг (хэлбэрийн feePercent) хасаад хуулгын цэвэр дүнтэй
// таарвал санал. Санал ХЭЗЭЭ Ч өөрөө хэрэгжихгүй — хэрэглэгч «Ашиглах» дарж
// (эсвэл MCP-д мөр бүрд ил заавал) хадгална (human-in-the-loop §9).

export type OpenEwalletReceipt = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  amount: number;
};

export type EwalletSettlementMethod = {
  paymentMethodId: string;
  /** pos_payment_methods.code (QPAY …) — MCP-д хэлбэр заахад. */
  methodCode: string;
  methodName: string;
  provider: string | null;
  cashAccountId: string;
  cashAccountName: string;
  /** Түр дансны GL (8 оронтой үндсэн данс). */
  glAccountNumber: string;
  /** Шимтгэл % (null = шимтгэлгүй — цэвэр = нийт). */
  feePercent: number | null;
  /** Түр дансны ТУЛГАГДААГҮЙ орлогууд — `unsettledReceipts`-ээс. */
  openReceipts: OpenEwalletReceipt[];
};

export type EwalletSettlementSuggestion = {
  kind: "ewallet_settlement";
  paymentMethodId: string;
  methodName: string;
  cashAccountName: string;
  /** Түр дансны GL — мөрийн харьцах (кредит) тал. */
  counterAccountNumber: string;
  /** Банкинд орсон цэвэр дүн (хуулгын мөр). */
  netAmount: number;
  /** Түр данснаас хасагдах нийт = цэвэр + шимтгэл. */
  grossAmount: number;
  /** Бодит шимтгэл = нийт − цэвэр (хуулгаас). */
  feeAmount: number;
  /** feePercent-ээр хүлээгдсэн шимтгэл (мэдээлэл). */
  expectedFeeAmount: number;
  receiptIds: string[];
  /** high = текст (провайдер/нэр) + дүн; medium = зөвхөн дүн таарсан. */
  confidence: "high" | "medium";
};

/** Хуулгын мөр settlement гэж хадгалахад шаардлагатай өгөгдөл (row.ewalletSettlement). */
export type EwalletSettlementRowInput = {
  paymentMethodId: string;
  grossAmount: number;
  feeAmount: number;
};

/** Мөнгө (цент)-ийн түвшинд харьцуулна — floating point-ийн зөрүүг хаяна. */
function cents(value: number): number {
  return Math.round(value * 100);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Нэг орлогын шимтгэл — провайдер мөр бүрд тооцдог тул мөр бүрд бөөрөнхийлнө. */
export function feeOfReceipt(amount: number, feePercent: number | null): number {
  if (feePercent == null || !(feePercent > 0)) return 0;
  return round2((amount * feePercent) / 100);
}

/**
 * Мөр бүрийн бөөрөнхийллийн зөрүүг хүлцнэ: 1₮ суурь + орлого тутамд 0.5₮
 * (провайдер шимтгэлийг мөр бүрд бүхэл ₮ болгож болно).
 */
export function settlementTolerance(receiptCount: number): number {
  return 1 + 0.5 * receiptCount;
}

/**
 * Түр дансны ТУЛГАГДААГҮЙ орлогууд — үлдэгдэлд суурилсан FIFO: өмнөх
 * settlement-үүд (түр данснаас гарсан шилжүүлэг + шимтгэлийн нийлбэр =
 * `settledTotal`) хамгийн эртний орлогуудыг хаасан гэж үзнэ. Хэсэгчлэн
 * хаагдсан орлого үлдэгдлээрээ нээлттэй үлдэнэ. Баримт тус бүрийг тэмдэглэх
 * баганагүй — түр дансны үлдэгдэл яг тулгагдаагүй нийт дүн.
 */
export function unsettledReceipts(
  receipts: OpenEwalletReceipt[],
  settledTotal: number
): OpenEwalletReceipt[] {
  const sorted = [...receipts]
    .filter((receipt) => receipt.amount > 0)
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
  let remaining = cents(Math.max(0, settledTotal));
  const open: OpenEwalletReceipt[] = [];
  for (const receipt of sorted) {
    const amount = cents(receipt.amount);
    if (remaining >= amount) {
      remaining -= amount;
      continue;
    }
    open.push(remaining > 0 ? { ...receipt, amount: (amount - remaining) / 100 } : receipt);
    remaining = 0;
  }
  return open;
}

export type PayoutMatch = {
  grossAmount: number;
  expectedFeeAmount: number;
  receiptIds: string[];
};

/**
 * Цэвэр дүнг FIFO-оор тулгана: огноо нь settlement-ийн огнооноос хойш биш
 * орлогуудыг дарааллаар нийлүүлж, (нийт − хүлээгдсэн шимтгэл) цэвэр дүнтэй
 * хүлцлийн дотор таарах ЭХНИЙ цэгт зогсоно. Давахад таарахгүй бол null.
 */
export function matchEwalletPayout(args: {
  netAmount: number;
  payoutDate: string;
  receipts: OpenEwalletReceipt[];
  feePercent: number | null;
}): PayoutMatch | null {
  const { netAmount, payoutDate, receipts, feePercent } = args;
  if (!(netAmount > 0)) return null;
  const net = cents(netAmount);
  let gross = 0;
  let fee = 0;
  const ids: string[] = [];
  for (const receipt of receipts) {
    if (receipt.date > payoutDate) break;
    gross += cents(receipt.amount);
    fee += cents(feeOfReceipt(receipt.amount, feePercent));
    ids.push(receipt.id);
    const expectedNet = gross - fee;
    const tolerance = cents(settlementTolerance(ids.length));
    if (Math.abs(expectedNet - net) <= tolerance)
      return { grossAmount: gross / 100, expectedFeeAmount: fee / 100, receiptIds: ids };
    if (expectedNet > net + tolerance) return null;
  }
  return null;
}

const PROVIDER_ALIASES: Record<string, string[]> = {
  qpay: ["qpay", "ккт", "kkt", "кьюпэй"],
  socialpay: ["socialpay", "social pay", "голомт"],
  monpay: ["monpay", "mon pay", "мобиком"],
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Хуулгын текстэд хайх түлхүүрүүд — провайдерийн alias + хэлбэрийн нэрийн үгс (≥3). */
export function settlementMatchTexts(method: Pick<EwalletSettlementMethod, "methodName" | "provider">): string[] {
  const texts = new Set<string>();
  const provider = method.provider ? normalize(method.provider) : "";
  for (const alias of PROVIDER_ALIASES[provider] ?? []) texts.add(alias);
  if (provider) texts.add(provider);
  for (const token of normalize(method.methodName).split(" "))
    if (token.length >= 3) texts.add(token);
  return [...texts];
}

export function settlementTextMatches(
  row: { counterparty: string; description: string },
  method: Pick<EwalletSettlementMethod, "methodName" | "provider">
): boolean {
  const haystack = normalize(`${row.counterparty} ${row.description}`);
  return settlementMatchTexts(method).some((needle) => haystack.includes(needle));
}

export type SettlementMatchableRow = {
  id: string;
  income: number;
  expense: number;
  counterparty: string;
  description: string;
  /** YYYY-MM-DD */
  transactionDate: string;
};

/**
 * Хуулгын мөрүүдэд settlement санал. Мөрүүдийг огноогоор дарааллуулж, санал
 * гарсан мөрийн орлогуудыг дараагийн мөрөөс ХАСНА (нэг хуулганд хэд хэдэн
 * өдрийн settlement байж болно — тус бүр өөрийн орлогуудаа авна).
 */
export function suggestEwalletSettlements(
  rows: SettlementMatchableRow[],
  methods: EwalletSettlementMethod[]
): Record<string, EwalletSettlementSuggestion[]> {
  const result: Record<string, EwalletSettlementSuggestion[]> = {};
  if (methods.length === 0) return result;
  const consumed = new Map<string, Set<string>>();
  const ordered = [...rows]
    .filter((row) => row.income > 0 && row.expense <= 0)
    .sort((a, b) =>
      a.transactionDate === b.transactionDate
        ? a.id.localeCompare(b.id)
        : a.transactionDate.localeCompare(b.transactionDate)
    );
  for (const row of ordered) {
    for (const method of methods) {
      const used = consumed.get(method.paymentMethodId) ?? new Set<string>();
      const receipts = method.openReceipts.filter((receipt) => !used.has(receipt.id));
      const match = matchEwalletPayout({
        netAmount: row.income,
        payoutDate: row.transactionDate,
        receipts,
        feePercent: method.feePercent,
      });
      if (!match) continue;
      const textHit = settlementTextMatches(row, method);
      // Текст таараагүй бол зөвхөн БҮХ тулгагдаагүй орлого нийлж таарсан үед
      // (хүчтэй дохио) «Дунд» санал — санамсаргүй дүнгийн давхцлыг хаяна.
      if (!textHit && match.receiptIds.length !== receipts.length) continue;
      for (const id of match.receiptIds) used.add(id);
      consumed.set(method.paymentMethodId, used);
      const suggestion: EwalletSettlementSuggestion = {
        kind: "ewallet_settlement",
        paymentMethodId: method.paymentMethodId,
        methodName: method.methodName,
        cashAccountName: method.cashAccountName,
        counterAccountNumber: method.glAccountNumber,
        netAmount: round2(row.income),
        grossAmount: match.grossAmount,
        feeAmount: round2(match.grossAmount - row.income),
        expectedFeeAmount: match.expectedFeeAmount,
        receiptIds: match.receiptIds,
        confidence: textHit ? "high" : "medium",
      };
      result[row.id] = [...(result[row.id] ?? []), suggestion];
      break;
    }
  }
  return result;
}

/**
 * Хадгалахын өмнөх шалгалт (import-statement.ts): нийт − шимтгэл = цэвэр,
 * шимтгэл ≥ 0, нийт нь түр дансны тулгагдаагүй үлдэгдлээс хэтрэхгүй.
 * Алдааны текстийг буцаана (хоосон = зөв).
 */
export function validateEwalletSettlementRow(args: {
  netAmount: number;
  grossAmount: number;
  feeAmount: number;
  openBalance: number;
}): string[] {
  const { netAmount, grossAmount, feeAmount, openBalance } = args;
  const errors: string[] = [];
  if (!(netAmount > 0)) errors.push("settlement нь орлогын мөр байх ёстой");
  if (!Number.isFinite(grossAmount) || !(grossAmount > 0)) errors.push("нийт (gross) дүн 0-ээс их байна");
  if (!Number.isFinite(feeAmount) || feeAmount < 0) errors.push("шимтгэл сөрөг байж болохгүй");
  if (errors.length) return errors;
  if (cents(grossAmount) - cents(feeAmount) !== cents(netAmount))
    errors.push(
      `нийт ${grossAmount.toLocaleString("en-US")} − шимтгэл ${feeAmount.toLocaleString("en-US")} ≠ банкинд орсон ${netAmount.toLocaleString("en-US")}`
    );
  if (cents(grossAmount) > cents(openBalance))
    errors.push(
      `нийт ${grossAmount.toLocaleString("en-US")} нь түр дансны тулгагдаагүй үлдэгдэл ${openBalance.toLocaleString("en-US")}-аас их байна`
    );
  return errors;
}

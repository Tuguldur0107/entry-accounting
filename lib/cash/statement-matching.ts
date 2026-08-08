// Банкны хуулгын мөрөнд тулгалтын САНАЛ гаргах цэвэр логик (DB-гүй, тесттэй).
//
// Хоёр төрлийн санал:
//   1. invoice — нээлттэй АР/АП нэхэмжлэхийн үлдэгдэл нь мөрийн дүнтэй тэнцэж,
//      (боломжтой бол) харилцагчийн нэр гүйлгээний утгад таарсан.
//      Орлогын мөр → ar_invoice, зарлагын мөр → ap_bill.
//   2. account — өмнөх баталгаажсан хуулгын мөрүүдээс "энэ харилцагч → энэ
//      данс" гэсэн давтамжийн загвар (≥2 удаа давтагдсан үед л).
//
// Санал ХЭЗЭЭ Ч автоматаар хэрэгжихгүй — UI дээр хэрэглэгч "Ашиглах" дарж
// баталгаажуулна (human-in-the-loop).

export const AMOUNT_TOLERANCE = 0.01;

/** Загвар ≥ энэ тооны давталттай үед л санал болгоно. */
export const PATTERN_MIN_COUNT = 2;

export type MatchableRow = {
  id: string;
  income: number;
  expense: number;
  counterparty: string;
  description: string;
};

export type OpenInvoiceRef = {
  id: string;
  documentNo: string;
  counterpartyName: string;
  totalAmount: number;
  paidAmount: number;
  documentType: "ar_invoice" | "ap_bill";
  /** Нэхэмжлэхийн хяналтын данс (бүтэн сегмент код) — саналыг мөрөнд бөглөхөд ашиглана. */
  controlAccountNumber?: string;
};

export type HistoricalPattern = {
  counterpartyText: string;
  counterAccountNumber: string;
  count: number;
  /** Загвар аль чиглэлээс үүссэн бэ — байхгүй бол хоёр чиглэлд хэрэглэнэ. */
  side?: "income" | "expense";
};

export type MatchContext = {
  openInvoices: OpenInvoiceRef[];
  historicalPatterns: HistoricalPattern[];
};

export type InvoiceSuggestion = {
  kind: "invoice";
  invoiceId: string;
  documentNo: string;
  counterpartyName: string;
  balance: number;
  confidence: "high" | "medium";
  /** high = нэр + дүн, medium = ганц нэхэмжлэхийн дүн л таарсан. */
  reason: "amount_and_name" | "amount_single";
  counterAccountNumber?: string;
};

export type AccountSuggestion = {
  kind: "account";
  counterAccountNumber: string;
  confidence: "medium";
  matchedText: string;
  count: number;
};

export type RowSuggestion = InvoiceSuggestion | AccountSuggestion;

// Компанийн хэлбэрийн дагавар — нэр тулгахад үл тоомсорлоно.
const SUFFIX_TOKENS = new Set([
  "ххк",
  "хк",
  "төхк",
  "ткх",
  "ббсб",
  "хзх",
  "llc",
  "ltd",
  "co",
  "inc",
  "jsc",
]);

/**
 * Харилцагчийн текст normalize: жижиг үсэг (кирилл-д ч ажиллана), хашилт
 * авах, ХХК/LLC мэт дагавар хаях, олон зайг нэг болгох.
 */
export function normalizeCounterpartyText(text: string): string {
  return text
    .toLowerCase()
    .replace(/["'«»„“”‘’`]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[.,;:()]+|[.,;:()]+$/g, ""))
    .filter((token) => token.length > 0 && !SUFFIX_TOKENS.has(token))
    .join(" ")
    .trim();
}

/** Нэрийг тулгалтад ашиглах токенууд (богино, утгагүй токеныг хаяна). */
function nameTokens(normalizedName: string): string[] {
  return normalizedName.split(" ").filter((token) => token.length >= 3);
}

function rowHaystack(row: MatchableRow): string {
  return `${normalizeCounterpartyText(row.counterparty)} ${normalizeCounterpartyText(
    row.description
  )}`.trim();
}

/** Нэхэмжлэхийн харилцагчийн нэр мөрийн текстэд агуулагдаж байна уу. */
function nameMatches(invoiceName: string, haystack: string): boolean {
  const normalized = normalizeCounterpartyText(invoiceName);
  if (!normalized || !haystack) return false;
  if (haystack.includes(normalized)) return true;
  const tokens = nameTokens(normalized);
  if (tokens.length === 0) return false;
  return tokens.some((token) => haystack.includes(token));
}

function invoiceBalance(invoice: OpenInvoiceRef): number {
  return invoice.totalAmount - invoice.paidAmount;
}

// Мөнгөн дүнг мөнгө (цент)-ийн түвшинд харьцуулна — floating point-ийн
// улмаас яг 0.01 зөрүү tolerance-с халихаас сэргийлнэ.
function amountsMatch(a: number, b: number): boolean {
  return (
    Math.abs(Math.round(a * 100) - Math.round(b * 100)) <=
    Math.round(AMOUNT_TOLERANCE * 100)
  );
}

function invoiceSuggestionsForRow(
  row: MatchableRow,
  invoices: OpenInvoiceRef[]
): InvoiceSuggestion[] {
  const amount = row.income > 0 ? row.income : row.expense;
  if (!(amount > 0)) return [];
  const wantedType = row.income > 0 ? "ar_invoice" : "ap_bill";
  const haystack = rowHaystack(row);

  const amountCandidates = invoices.filter(
    (invoice) =>
      invoice.documentType === wantedType &&
      invoiceBalance(invoice) > 0 &&
      amountsMatch(invoiceBalance(invoice), amount)
  );
  if (amountCandidates.length === 0) return [];

  const withName = amountCandidates.filter((invoice) =>
    nameMatches(invoice.counterpartyName, haystack)
  );

  if (withName.length > 0)
    return withName.map((invoice) => ({
      kind: "invoice" as const,
      invoiceId: invoice.id,
      documentNo: invoice.documentNo,
      counterpartyName: invoice.counterpartyName,
      balance: invoiceBalance(invoice),
      confidence: "high" as const,
      reason: "amount_and_name" as const,
      counterAccountNumber: invoice.controlAccountNumber,
    }));

  // Нэр таараагүй — зөвхөн ГАНЦ нээлттэй нэхэмжлэх яг энэ дүнтэй үед л
  // medium санал гаргана. Хоёр ба түүнээс олон таарвал таамаглахгүй.
  if (amountCandidates.length === 1) {
    const invoice = amountCandidates[0];
    return [
      {
        kind: "invoice",
        invoiceId: invoice.id,
        documentNo: invoice.documentNo,
        counterpartyName: invoice.counterpartyName,
        balance: invoiceBalance(invoice),
        confidence: "medium",
        reason: "amount_single",
        counterAccountNumber: invoice.controlAccountNumber,
      },
    ];
  }
  return [];
}

function accountSuggestionForRow(
  row: MatchableRow,
  patterns: HistoricalPattern[]
): AccountSuggestion | null {
  const side = row.income > 0 ? "income" : "expense";
  const rowName = normalizeCounterpartyText(row.counterparty);
  const haystack = rowHaystack(row);

  let best: { pattern: HistoricalPattern; normalized: string } | null = null;
  for (const pattern of patterns) {
    if (pattern.count < PATTERN_MIN_COUNT) continue;
    if (pattern.side && pattern.side !== side) continue;
    const normalized = normalizeCounterpartyText(pattern.counterpartyText);
    if (!normalized) continue;
    const matched =
      (rowName.length > 0 && rowName === normalized) ||
      (normalized.length >= 3 && haystack.includes(normalized));
    if (!matched) continue;
    if (!best || pattern.count > best.pattern.count)
      best = { pattern, normalized };
  }
  if (!best) return null;
  return {
    kind: "account",
    counterAccountNumber: best.pattern.counterAccountNumber,
    confidence: "medium",
    matchedText: best.pattern.counterpartyText,
    count: best.pattern.count,
  };
}

/**
 * Мөр бүрд эрэмбэлэгдсэн саналууд: invoice (high → medium) эхэлж, дараа нь
 * давтамжийн данс. Санал байхгүй мөр үр дүнд орохгүй.
 */
export function suggestMatches(
  rows: MatchableRow[],
  context: MatchContext
): Record<string, RowSuggestion[]> {
  const result: Record<string, RowSuggestion[]> = {};
  for (const row of rows) {
    const suggestions: RowSuggestion[] = [];

    const invoiceSuggestions = invoiceSuggestionsForRow(
      row,
      context.openInvoices
    ).sort((a, b) =>
      a.confidence === b.confidence
        ? a.documentNo.localeCompare(b.documentNo)
        : a.confidence === "high"
          ? -1
          : 1
    );
    suggestions.push(...invoiceSuggestions);

    const accountSuggestion = accountSuggestionForRow(
      row,
      context.historicalPatterns
    );
    if (accountSuggestion) suggestions.push(accountSuggestion);

    if (suggestions.length > 0) result[row.id] = suggestions;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Түүхэн загвар бүтээгч — өмнөх баталгаажсан хуулгын мөрүүдээс.
// Орлогын мөрд банкны данс ДЕБЕТ тал тул харьцах данс нь КРЕДИТ;
// зарлагын мөрд эсрэгээр (save route-ийн дүрэмтэй ижил).
// ---------------------------------------------------------------------------

export type HistoricalLineInput = {
  counterparty: string | null;
  income: number;
  expense: number;
  debitAccountNumber: string;
  creditAccountNumber: string;
};

export function buildHistoricalPatterns(
  lines: HistoricalLineInput[],
  limit = 300
): HistoricalPattern[] {
  const groups = new Map<
    string,
    { counterpartyText: string; counterAccountNumber: string; count: number; side: "income" | "expense" }
  >();
  for (const line of lines) {
    const text = (line.counterparty ?? "").trim();
    if (!text) continue;
    const normalized = normalizeCounterpartyText(text);
    if (!normalized) continue;
    const isIncome = line.income > 0;
    const side = isIncome ? ("income" as const) : ("expense" as const);
    const counterAccountNumber = isIncome
      ? line.creditAccountNumber
      : line.debitAccountNumber;
    if (!counterAccountNumber) continue;
    const key = `${normalized}|${side}|${counterAccountNumber}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else
      groups.set(key, {
        counterpartyText: text,
        counterAccountNumber,
        count: 1,
        side,
      });
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

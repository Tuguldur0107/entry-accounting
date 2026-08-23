// П8 — Банкны хуулгын хэрэглэгчийн ДҮРЭМ (bank rules engine), цэвэр логик
// (DB-гүй, тесттэй). Xero/QBO загвар: нөхцөл (текст агуулна / чиглэл / дүнгийн
// муж) → үйлдэл (харьцах данс, харилцагч, тайлбар бөглөх).
//
// Хоёр түвшин (mode):
//   suggest — «Санал» баганад ЭХЭНД (нэхэмжлэх/түүхэн загварын өмнө) гарна,
//             хэрэглэгч «Ашиглах» дарж хэрэгжүүлнэ
//   auto    — хуулга уншигдмагц мөрөнд ШУУД бөглөгдөнө; хэрэглэгч хадгалахаас
//             өмнө хянаж засах боломжтой хэвээр (human-in-the-loop §9)
//
// Дүрэм ХЭЗЭЭ Ч баримт өөрөө үүсгэхгүй — зөвхөн импортын мөрийг бөглөнө;
// хадгалах шийдвэр хэрэглэгчийнх.

export type BankRuleSide = "income" | "expense" | "any";
export type BankRuleMode = "suggest" | "auto";

export type BankRule = {
  id: string;
  name: string;
  /** Гүйлгээний утга + харилцагчийн текстэд агуулагдах хэсэг (case-insensitive). */
  matchText: string;
  side: BankRuleSide;
  /** null = доод хязгааргүй. */
  minAmount: number | null;
  /** null = дээд хязгааргүй. */
  maxAmount: number | null;
  /** Үйлдэл: харьцах данс (бүтэн сегмент код эсвэл 8 оронтой үндсэн данс). */
  counterAccountNumber: string;
  /** Үйлдэл: харилцагчийн текстийг СОЛИНО (null = хөндөхгүй). */
  setCounterparty: string | null;
  /** Үйлдэл: гүйлгээний утгыг СОЛИНО (null = хөндөхгүй). */
  setDescription: string | null;
  mode: BankRuleMode;
  /** Бага тоо түрүүлж шалгагдана (тэнцвэл нэрээр). */
  priority: number;
  isActive: boolean;
};

export type RuleMatchableRow = {
  income: number;
  expense: number;
  counterparty: string;
  description: string;
};

/** Дүрмийн саналыг «Санал» баганад нэхэмжлэх/загварын өмнө үзүүлэх бүртгэл. */
export type RuleSuggestion = {
  kind: "rule";
  ruleId: string;
  ruleName: string;
  mode: BankRuleMode;
  confidence: "high";
  counterAccountNumber: string;
  setCounterparty: string | null;
  setDescription: string | null;
};

function normalizeHaystack(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function ruleMatches(row: RuleMatchableRow, rule: BankRule): boolean {
  if (!rule.isActive) return false;
  const needle = normalizeHaystack(rule.matchText);
  if (!needle) return false;

  const side = row.income > 0 ? "income" : "expense";
  if (rule.side !== "any" && rule.side !== side) return false;

  const amount = row.income > 0 ? row.income : row.expense;
  if (rule.minAmount != null && amount < rule.minAmount) return false;
  if (rule.maxAmount != null && amount > rule.maxAmount) return false;

  const haystack = normalizeHaystack(
    `${row.counterparty} ${row.description}`
  );
  return haystack.includes(needle);
}

/**
 * Мөрөнд таарах ЭХНИЙ дүрэм (priority өсөхөөр, тэнцвэл нэрээр). Нэг мөрөнд
 * нэг л дүрэм үйлчилнэ — давхарласан дүрмүүдийн аль нь хожихыг priority
 * ил тодоор шийднэ.
 */
export function firstMatchingRule(
  row: RuleMatchableRow,
  rules: BankRule[]
): BankRule | null {
  let best: BankRule | null = null;
  for (const rule of rules) {
    if (!ruleMatches(row, rule)) continue;
    if (
      !best ||
      rule.priority < best.priority ||
      (rule.priority === best.priority &&
        rule.name.localeCompare(best.name) < 0)
    )
      best = rule;
  }
  return best;
}

export function toRuleSuggestion(rule: BankRule): RuleSuggestion {
  return {
    kind: "rule",
    ruleId: rule.id,
    ruleName: rule.name,
    mode: rule.mode,
    confidence: "high",
    counterAccountNumber: rule.counterAccountNumber,
    setCounterparty: rule.setCounterparty,
    setDescription: rule.setDescription,
  };
}

// Журналын ВАЛЮТЫН цэвэр логик (DB-гүй, тесттэй) — IAS 21.
//
// ЗАРЧИМ (баримтад НЭГ валют, НЭГ ханш — касс, АР/АП-тай ИЖИЛ загвар):
//   • Хэрэглэгч ГАДААД валютаар (FC) бичнэ; дэвтрийн валют (MNT) нь ТҮҮНЭЭС
//     бодогдоно — MNT-г гараар бичихийг зөвшөөрөхгүй (ханш ба дүн зөрөхгүй).
//   • Мөр бүр ТУСДАА бөөрөнхийлөгдөнө (round half-up, 2 орон). Улмаас Дт/Кт-ийн
//     MNT нийлбэр 1–2 төгрөгөөр зөрж болно — тэр ҮЛДЭГДЛИЙГ хамгийн ТОМ
//     мөрөнд ил шингээнэ (НӨАТ inclusive-ийн largest-line absorb-тай ИЖИЛ
//     дүрэм). Ингэснээр GL үргэлж ТЭНЦЭНЭ, зөрүү нь нууц данс руу ороогүй.
//   • Ханш ХЭЗЭЭ Ч энд зохиогдохгүй — 0 эсвэл сөрөг ханш ШИДНЭ (§5b).

export const BASE_CURRENCY = "MNT";

export interface CurrencyLine {
  /** Гадаад валютын дебет (≥ 0). */
  debitFc: number;
  /** Гадаад валютын кредит (≥ 0). */
  creditFc: number;
}

export interface BaseAmounts {
  debit: number;
  credit: number;
}

export interface ConvertResult {
  /** Мөр бүрийн суурь валютын (MNT) дүн — ЭРЭМБЭ нь оролттой ижил. */
  lines: BaseAmounts[];
  /** Бөөрөнхийллийн залруулга (₮) — 0 биш бол UI-д ил үзүүлнэ. */
  roundingAdjustment: number;
  /** Залруулга орсон мөрийн индекс (байхгүй бол -1). */
  adjustedIndex: number;
}

const r2 = (value: number) => Math.round(value * 100) / 100;

/** Тоо эерэг, хязгаарлагдмал эсэх — ханшийг ЗОХИОХГҮЙ, буруу бол ШИДНЭ. */
export function assertRate(rate: number, label = "Ханш"): number {
  if (!Number.isFinite(rate) || rate <= 0)
    throw new Error(`${label} 0-ээс их байх ёстой`);
  return rate;
}

/** Валютын код — 3 үсэг, ТОМ (MNT, USD, EUR, CNY…). */
export function normalizeCurrency(code: string): string {
  const upper = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) throw new Error("Валютын код 3 үсэг байна");
  return upper;
}

export const isBaseCurrency = (code: string) =>
  normalizeCurrency(code) === BASE_CURRENCY;

/**
 * Гадаад валютын мөрүүдийг суурь валют руу хөрвүүлнэ.
 *
 * Мөр бүр round(fc × rate, 2); Дт/Кт нийлбэрийн зөрүүг ХАМГИЙН ТОМ (тухайн
 * талын) мөрөнд шингээж GL-ийн тэнцлийг баталгаажуулна. Валютаар тэнцээгүй
 * оролт ирвэл ШИДНЭ — тэнцээгүй журналыг чимээгүй "засах" нь аюултай.
 */
export function convertLinesToBase(
  lines: CurrencyLine[],
  rate: number,
  options: {
    /**
     * Бөөрөнхийллийн зөрүүг шингээх эсэх. Батлагдах журналд ЗААВАЛ (GL
     * тэнцэх ёстой). НООРОГ нь тэнцээгүй байж болно (хэрэглэгч бөглөж
     * байгаа) тул зөвхөн мөр бүрийг хөрвүүлж, залруулга хийхгүй.
     */
    absorbRounding?: boolean;
  } = {}
): ConvertResult {
  const absorbRounding = options.absorbRounding ?? true;
  assertRate(rate);
  for (const line of lines) {
    if (!Number.isFinite(line.debitFc) || !Number.isFinite(line.creditFc))
      throw new Error("Валютын дүн тоо байх ёстой");
    if (line.debitFc < 0 || line.creditFc < 0)
      throw new Error("Валютын дүн сөрөг байж болохгүй");
    if (line.debitFc > 0 && line.creditFc > 0)
      throw new Error("Нэг мөрд дебет ЭСВЭЛ кредит байна");
  }

  const converted: BaseAmounts[] = lines.map((line) => ({
    debit: line.debitFc > 0 ? r2(line.debitFc * rate) : 0,
    credit: line.creditFc > 0 ? r2(line.creditFc * rate) : 0,
  }));

  const totalDebit = r2(converted.reduce((sum, line) => sum + line.debit, 0));
  const totalCredit = r2(converted.reduce((sum, line) => sum + line.credit, 0));
  const residual = r2(totalDebit - totalCredit);
  if (residual === 0 || !absorbRounding)
    return { lines: converted, roundingAdjustment: 0, adjustedIndex: -1 };

  // Зөрүү нь ЗӨВХӨН бөөрөнхийллийн хэмжээнд (мөр тутамд ≤0.01) байх ёстой.
  // Үүнээс их бол валютаар тэнцээгүй гэсэн үг — залруулахгүй, ШИДНЭ.
  const tolerance = r2(lines.length * 0.01 + 0.01);
  if (Math.abs(residual) > tolerance)
    throw new Error("Валютын дүнгээр дебет ба кредит тэнцэхгүй байна");

  // Илүү гарсан ТАЛЫН хамгийн том мөрөөс хасна (дутсан талыг өсгөхгүй —
  // хасалт нь дүнг хэзээ ч зохиомлоор өсгөхгүй).
  const heavySide: "debit" | "credit" = residual > 0 ? "debit" : "credit";
  let adjustedIndex = -1;
  let largest = 0;
  converted.forEach((line, index) => {
    const amount = line[heavySide];
    if (amount > largest) {
      largest = amount;
      adjustedIndex = index;
    }
  });
  if (adjustedIndex === -1)
    throw new Error("Бөөрөнхийллийн зөрүүг шингээх мөр олдсонгүй");

  const adjusted = converted.map((line, index) =>
    index === adjustedIndex
      ? { ...line, [heavySide]: r2(line[heavySide] - Math.abs(residual)) }
      : line
  );
  return {
    lines: adjusted,
    roundingAdjustment: -residual,
    adjustedIndex,
  };
}

/**
 * Валютын мөрүүдийн тэнцэл — ΣДт(FC) = ΣКт(FC) ба хоосон биш эсэх.
 * Журналын үндсэн guardrail-тай (CLAUDE.md §1) ИЖИЛ хэмжүүр: 0.01.
 */
export function fcBalance(lines: CurrencyLine[]) {
  const totalDebit = r2(lines.reduce((sum, line) => sum + (line.debitFc || 0), 0));
  const totalCredit = r2(lines.reduce((sum, line) => sum + (line.creditFc || 0), 0));
  return {
    totalDebit,
    totalCredit,
    difference: r2(totalDebit - totalCredit),
    isEmpty: totalDebit === 0 && totalCredit === 0,
    balanced:
      !(totalDebit === 0 && totalCredit === 0) &&
      Math.abs(r2(totalDebit - totalCredit)) <= 0.01,
  };
}

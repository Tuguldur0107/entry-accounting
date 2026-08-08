// НӨАТ-ийн цэвэр логик — DB/framework хамааралгүй (тесттэй).
//
// Эх сурвалж: knowledge/01-онол-хууль-стандарт/tax/vat.md,
// knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/vat-return.md.
//
// Сарын тооцоо:
//   Гаралтын НӨАТ = гаралтын дансны (Cr − Dr) эргэлт тухайн сард
//   Оролтын НӨАТ  = оролтын дансны (Dr − Cr) эргэлт тухайн сард
//   Төлөх = Гаралтын − Оролтын  (сөрөг бол буцаан авах / шилжүүлэх)
//
// Тооцооны (settlement) журнал дараа сард бичигддэг тул тухайн сарын
// эргэлтэд орохгүй — сар бүрийн тайлан бие даасан байна.

export type VatMode = "exclusive" | "inclusive";

/** Мөнгөн дүнг 2 орны нарийвчлалтай бөөрөнхийлнө. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * НӨАТ-ийн задаргаа. exclusive: өгсөн дүн нь ЦЭВЭР (НӨАТ-гүй) —
 * НӨАТ дээр нь нэмэгдэнэ. inclusive: өгсөн дүн нь НИЙТ (НӨАТ багтсан) —
 * НӨАТ дотроос нь ялгарна (Нийт × r/(100+r)).
 */
export function splitVat(
  amount: number,
  mode: VatMode,
  ratePercent = 10
): { net: number; vat: number; gross: number } {
  if (!(amount > 0) || !Number.isFinite(amount))
    throw new Error("НӨАТ тооцох дүн 0-ээс их байна");
  if (!(ratePercent > 0) || !Number.isFinite(ratePercent))
    throw new Error("НӨАТ-ийн хувь 0-ээс их байна");
  if (mode === "exclusive") {
    const vat = round2((amount * ratePercent) / 100);
    return { net: round2(amount), vat, gross: round2(amount + vat) };
  }
  const vat = round2((amount * ratePercent) / (100 + ratePercent));
  return { net: round2(amount - vat), vat, gross: round2(amount) };
}

/**
 * Мөр бүрийн дүнтэй баримтад НӨАТ-ийн мөр нэмэхэд: inclusive горимд мөрүүд
 * НИЙТ дүнгээ хадгалж НӨАТ нь дотроос нь ялгарах тул мөр бүр /(1+r) болж
 * багасна; бөөрөнхийллийн зөрүү ХАМГИЙН ТОМ мөрөнд шингэнэ (largest-line
 * absorb — Σ(шинэ мөр) + НӨАТ ≡ Σ(хуучин мөр) тэнцвэр алдагдахгүй).
 */
export function applyInclusiveVatToLines(
  lineAmounts: number[],
  ratePercent = 10
): { adjusted: number[]; vat: number } {
  const gross = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  const { net, vat } = splitVat(gross, "inclusive", ratePercent);
  const factor = net / gross;
  const adjusted = lineAmounts.map((amount) => round2(amount * factor));
  // Бөөрөнхийллийн үлдэгдлийг хамгийн том мөрөнд шингээнэ.
  const drift = round2(net - adjusted.reduce((sum, amount) => sum + amount, 0));
  if (drift !== 0) {
    const maxIndex = adjusted.reduce(
      (best, amount, index) => (amount > adjusted[best] ? index : best),
      0
    );
    adjusted[maxIndex] = round2(adjusted[maxIndex] + drift);
  }
  return { adjusted, vat };
}

export type VatJournalLine = {
  /** Мөрийн дансны бүтэн код эсвэл дан үндсэн данс. */
  mainAccount: string;
  debit: number;
  credit: number;
  date: string; // YYYY-MM-DD
  status: string; // журналын статус ("posted" | "reversed" | ...)
};

export type VatReturnSummary = {
  periodCode: string; // YYYY-MM
  outputVat: number; // гаралтын НӨАТ (борлуулалт)
  inputVat: number; // оролтын НӨАТ (худалдан авалт)
  /** Төлөх (>0) / буцаан авах (<0 үед 0, refundable-д тусдаа). */
  payableVat: number;
  refundableVat: number;
  /** Тайлан + төлбөрийн эцсийн хугацаа — дараа сарын 10. */
  deadline: string; // YYYY-MM-DD
  outputLineCount: number;
  inputLineCount: number;
};

/** Дараа сарын 10 — НӨАТ тайлан + төлбөрийн эцсийн хугацаа. */
export function vatDeadlineOf(periodCode: string): string {
  const [year, month] = periodCode.split("-").map(Number);
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return `${next.y}-${String(next.m).padStart(2, "0")}-10`;
}

/**
 * Сарын НӨАТ тайлан — GL мөрүүдээс. Зөвхөн posted/reversed журналын мөр
 * тоологдоно (reversed хос нь эргэлтээ өөрөө цэвэрлэнэ).
 */
export function computeVatReturn(
  lines: VatJournalLine[],
  options: {
    periodCode: string; // YYYY-MM
    outputVatAccount: string;
    inputVatAccount: string;
  }
): VatReturnSummary {
  const { periodCode, outputVatAccount, inputVatAccount } = options;
  let outputVat = 0;
  let inputVat = 0;
  let outputLineCount = 0;
  let inputLineCount = 0;

  for (const line of lines) {
    if (!line.date.startsWith(periodCode)) continue;
    if (line.status !== "posted" && line.status !== "reversed") continue;
    if (line.mainAccount === outputVatAccount) {
      outputVat += line.credit - line.debit;
      outputLineCount += 1;
    } else if (line.mainAccount === inputVatAccount) {
      inputVat += line.debit - line.credit;
      inputLineCount += 1;
    }
  }

  outputVat = round2(outputVat);
  inputVat = round2(inputVat);
  const difference = round2(outputVat - inputVat);
  return {
    periodCode,
    outputVat,
    inputVat,
    payableVat: difference > 0 ? difference : 0,
    refundableVat: difference < 0 ? round2(-difference) : 0,
    deadline: vatDeadlineOf(periodCode),
    outputLineCount,
    inputLineCount,
  };
}

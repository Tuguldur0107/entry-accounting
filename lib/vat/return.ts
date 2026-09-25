// НӨАТ-ийн цэвэр логик — DB/framework хамааралгүй (тесттэй).
//
// Эх сурвалж: entry-knowledge/01-онол-хууль-стандарт/tax/vat.md,
// entry-knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/vat-return.md.
//
// Сарын тооцоо:
//   Гаралтын НӨАТ = гаралтын дансны (Cr − Dr) эргэлт тухайн сард
//   Оролтын НӨАТ  = оролтын дансны (Dr − Cr) эргэлт тухайн сард
//   Төлөх = Гаралтын − Оролтын − Өмнөх саруудаас шилжсэн кредит
//          (сөрөг бол дараа сард шилжүүлэх)
//
// Тооцоо / төлбөр / буцаалтын журнал (зөвхөн НӨАТ + мөнгөн дансны мөртэй)
// эргэлтэд ОРОХГҮЙ (isVatSettlementVoucher) — тооцооны журнал тухайн сарын
// сүүлийн өдрөөр бичигдсэн ч тайлан өөрчлөгдөхгүй (ENT-024/035).

import { roundMoney as round2 } from "@/lib/arap/accounting";

export type VatMode = "exclusive" | "inclusive";

/** Мөнгөн дүнг 2 орны нарийвчлалтай бөөрөнхийлнө. */

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
  /**
   * Журналын ID — өгвөл тооцоо/төлбөрийн журналыг (зөвхөн НӨАТ ба мөнгөн
   * дансны мөртэй) танихад хэрэглэгдэнэ (ENT-024).
   */
  voucherId?: string;
};

/** Мөнгөн хөрөнгийн данс (10 касс, 11 банк) — balances.isCashMainAccount-тай ижил. */
const isCashMain = (main: string) => main.startsWith("10") || main.startsWith("11");

/**
 * НӨАТ-ын ТООЦОО / ТӨЛБӨРИЙН журнал уу — ГАРАЛТЫН НӨАТ-ын дансыг хөндсөн
 * бөгөөд бусад мөр нь зөвхөн оролтын НӨАТ ба мөнгөн дансных (Dr гаралт /
 * Cr оролт / Cr банк г.м.). Ийм журнал нь НӨАТ-ын ЭРГЭЛТ БИШ: урьд
 * тэдгээрийг тооцдог байсан тул өмнөх сарын төлөлт (Dr 31410000) «гаралтын
 * НӨАТ»-аас хасагдаж, тайлан тэмдгээ эргүүлж «буцаан авах 5,129,315₮» гэж
 * гардаг байв (ENT-024).
 *
 * Гаралтыг хөндөөгүй «оролт + мөнгө» журнал нь ЭРГЭЛТ хэвээр: гаалийн
 * байгууллагад бэлнээр төлсөн импортын НӨАТ (Dr 13620000 / Cr банк) нь
 * хасагдах оролтын НӨАТ, татварын албанаас буцаан авсан илүү оролт
 * (Dr банк / Cr 13620000) нь шилжсэн кредитийг (carriedInputVat) хэрэглэдэг
 * тул мөн тооцогдоно — хоёр удаа хасагдахгүй.
 */
export function isVatSettlementVoucher(
  mains: readonly string[],
  outputVatAccount: string,
  inputVatAccount: string
): boolean {
  let touchesOutput = false;
  for (const main of mains) {
    if (main === outputVatAccount) touchesOutput = true;
    else if (main !== inputVatAccount && !isCashMain(main)) return false;
  }
  return touchesOutput;
}

/**
 * Өмнөх саруудаас шилжсэн оролтын НӨАТ-ын кредит = тайлант үеийн ЭХЭН дэх
 * max(0, оролтын дансны Dt үлдэгдэл − гаралтын дансны Кт үлдэгдэл).
 * Тооцоо хийгдсэн эсэхээс үл хамаарна (тооцоо нь хоёр дансыг ижил дүнгээр
 * хаадаг тул зөрүүг өөрчлөхгүй) — ENT-052.
 */
export function carriedInputVat(openingBalances: {
  inputDebitBalance: number;
  outputCreditBalance: number;
}): number {
  return Math.max(
    0,
    round2(openingBalances.inputDebitBalance - openingBalances.outputCreditBalance)
  );
}

export type VatReturnSummary = {
  periodCode: string; // YYYY-MM
  outputVat: number; // гаралтын НӨАТ (борлуулалт)
  inputVat: number; // оролтын НӨАТ (худалдан авалт)
  /** Өмнөх саруудаас шилжсэн оролтын НӨАТ-ын кредит (ENT-052). */
  carriedInVat: number;
  /** Төлөх = гаралт − оролт − шилжсэн кредит (>0 үед). */
  payableVat: number;
  /** Дараа сард ШИЛЖҮҮЛЭХ илүү оролтын НӨАТ (гаралтаас их үед). */
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
    /** carriedInputVat()-аас — өгөхгүй бол 0. */
    carriedInVat?: number;
  }
): VatReturnSummary {
  const { periodCode, outputVatAccount, inputVatAccount } = options;
  const carriedInVat = round2(Math.max(0, options.carriedInVat ?? 0));
  let outputVat = 0;
  let inputVat = 0;
  let outputLineCount = 0;
  let inputLineCount = 0;

  // Тооцоо/төлбөрийн журнал — эргэлт биш тул хасна.
  const mainsByVoucher = new Map<string, string[]>();
  for (const line of lines)
    if (line.voucherId)
      mainsByVoucher.set(line.voucherId, [
        ...(mainsByVoucher.get(line.voucherId) ?? []),
        line.mainAccount,
      ]);
  const settlementVouchers = new Set(
    [...mainsByVoucher]
      .filter(([, mains]) => isVatSettlementVoucher(mains, outputVatAccount, inputVatAccount))
      .map(([voucherId]) => voucherId)
  );

  for (const line of lines) {
    if (!line.date.startsWith(periodCode)) continue;
    if (line.status !== "posted" && line.status !== "reversed") continue;
    if (line.voucherId && settlementVouchers.has(line.voucherId)) continue;
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
  const difference = round2(outputVat - inputVat - carriedInVat);
  return {
    periodCode,
    outputVat,
    inputVat,
    carriedInVat,
    payableVat: difference > 0 ? difference : 0,
    refundableVat: difference < 0 ? round2(-difference) : 0,
    deadline: vatDeadlineOf(periodCode),
    outputLineCount,
    inputLineCount,
  };
}

/**
 * SIM2-015: тооцоо хийсний ДАРАА тухайн сарын нэхэмжлэх батлагдвал тооцоо
 * хуучирна. Одоогийн тайлан ба аль хэдийн бичигдсэн тооцоо(нууд)-ын зөрүү =
 * НЭМЭЛТ тооцоо: Dr гаралт Δ / Кт оролт Δ / Кт банк Δ. Гаралт буурсан эсвэл
 * төлөх дүн буурсан (буцаан авах) тохиолдлыг автоматаар бичихгүй — ИЛ
 * мэдэгдэнэ (`negative`).
 */
export function planVatSettlementDelta(
  summary: Pick<VatReturnSummary, "outputVat" | "inputVat" | "carriedInVat">,
  settled: { output: number; input: number }
): { outputDelta: number; inputDelta: number; payableDelta: number; needed: boolean; negative: boolean } {
  const inputOffsetNow = Math.min(round2(summary.inputVat + summary.carriedInVat), summary.outputVat);
  const outputDelta = round2(summary.outputVat - settled.output);
  const inputDelta = round2(Math.max(0, inputOffsetNow) - settled.input);
  const payableDelta = round2(outputDelta - inputDelta);
  const needed = Math.abs(outputDelta) >= 0.01 || Math.abs(inputDelta) >= 0.01;
  return {
    outputDelta,
    inputDelta,
    payableDelta,
    needed,
    negative: needed && (outputDelta < 0 || payableDelta < 0),
  };
}

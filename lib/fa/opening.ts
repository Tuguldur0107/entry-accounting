// Үндсэн хөрөнгийн НЭЭЛТИЙН үлдэгдлийн ЦЭВЭР дүрэм (tests/fa-opening.test.ts).
//
// SIM Trade симуляци:
//   • ENT-002/049 — нэвтрүүлэлтийн өмнө элэгдэж эхэлсэн хөрөнгийн
//     «хуримтлагдсан элэгдэл»-ийг оруулах талбар байгаагүй тул систем
//     хөрөнгийг ДАХИН бүтэн хугацаагаар элэгдүүлж, бүртгэлийн тайлан GL-тэй
//     тулгарахгүй байв. Карт одоо `openingAccumulatedDepreciation` (+ татварын
//     `openingTaxAccumulated`) ба `openingAsOf` (cut-off огноо) хадгална —
//     тэр сар хүртэл систем элэгдүүлэхгүй, хуримтлагдсан нь нээлтээс эхэлнэ.
//     Нээлтийн хуримтлагдсан элэгдэл GL-д НЭЭЛТИЙН журналаар (Кт 20000002)
//     орсон гэж үзнэ — карт GL бичихгүй.
//   • ENT-066 — данснаас хасахад зөвхөн системийн элэгдлийг хааж, нээлтийн
//     хуримтлагдсан нь «өнчин» үлдэн хиймэл гарз гардаг байв.
//   • ENT-046 — нээлтийн журналын ҮХ-ийн мөр автоматаар ноорог карт үүсгэдэг
//     байв (картууд аль хэдийн бүртгэгдсэн тул давхардал).

import { assertCalendarDate } from "@/lib/periods/document-date";

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface FaOpeningInput {
  cost: number;
  salvageValue: number;
  openingAccumulatedDepreciation?: number | string | null;
  openingTaxAccumulated?: number | string | null;
  openingAsOf?: string | null;
}

export interface FaOpeningValues {
  openingAccumulatedDepreciation: number;
  openingTaxAccumulated: number;
  openingAsOf: string | null;
}

function amountOf(value: number | string | null | undefined, label: string): number {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} сөрөг бус тоо байна`);
  return round2(amount);
}

/**
 * Нээлтийн талбаруудыг шалгаж хэвшүүлнэ. Хуримтлагдсан элэгдэл нь
 * элэгдүүлэх дүнгээс (өртөг − үлдэх өртөг) хэтрэхгүй; дүнтэй бол cut-off
 * огноо ЗААВАЛ.
 */
export function normalizeFaOpening(input: FaOpeningInput): FaOpeningValues {
  const accum = amountOf(input.openingAccumulatedDepreciation, "Нээлтийн хуримтлагдсан элэгдэл");
  const taxAccum = amountOf(input.openingTaxAccumulated, "Татварын нээлтийн хуримтлагдсан элэгдэл");
  const base = round2(Number(input.cost) - Number(input.salvageValue));
  if (accum > base + 0.005)
    throw new Error(
      `Нээлтийн хуримтлагдсан элэгдэл (${accum}) элэгдүүлэх дүнгээс (өртөг − үлдэх өртөг = ${base}) их байна`
    );
  if (taxAccum > base + 0.005)
    throw new Error(
      `Татварын нээлтийн хуримтлагдсан элэгдэл (${taxAccum}) элэгдүүлэх дүнгээс (${base}) их байна`
    );
  const asOf = input.openingAsOf?.trim() || null;
  if (asOf) assertCalendarDate(asOf, "Нээлтийн огноо");
  if ((accum > 0 || taxAccum > 0) && !asOf)
    throw new Error(
      "Нээлтийн хуримтлагдсан элэгдэлтэй хөрөнгөд НЭЭЛТИЙН ОГНОО (cut-off, YYYY-MM-DD) заавал оруулна"
    );
  return { openingAccumulatedDepreciation: accum, openingTaxAccumulated: taxAccum, openingAsOf: asOf };
}

/** Данснаас хасалтын хуримтлагдсан элэгдэл ба олз/гарз (эерэг = гарз). */
export function computeFaDisposal(input: {
  cost: number;
  openingAccum: number;
  postedAccum: number;
  proceeds: number;
}): { accumulated: number; netBookValue: number; gainLoss: number } {
  const cost = round2(input.cost);
  const accumulated = round2(Number(input.openingAccum || 0) + Number(input.postedAccum || 0));
  const netBookValue = round2(cost - accumulated);
  return { accumulated, netBookValue, gainLoss: round2(netBookValue - round2(input.proceeds)) };
}

/**
 * Хасалтын журналын НИЙТ дүн (Σ Dr = Σ Cr): анхны өртөг (Cr) + олз (Cr) —
 * AI-ийн шууд батлах хязгаарыг бусад журналын адил ЭНЭ дүнгээр шалгана.
 */
export function faDisposalJournalTotal(input: { cost: number; gainLoss: number }): number {
  return round2(round2(input.cost) + Math.max(0, -round2(input.gainLoss)));
}

/**
 * Нэвтрүүлэлтийн нээлтийн журнал эсэх — externalRef `opening-*`
 * (opening-balance / opening-summary / opening-diff / opening-adj) эсвэл
 * тайлбар `[ОНБ…]`. Ийм журналаас ҮХ-ийн ноорог карт ҮҮСГЭХГҮЙ.
 */
export function isOpeningBalanceVoucher(voucher: {
  externalRef?: string | null;
  description?: string | null;
}): boolean {
  if (voucher.externalRef?.trim().toLowerCase().startsWith("opening-")) return true;
  return (voucher.description ?? "").includes("[ОНБ");
}

/**
 * ҮХ-ийн өртгийн дансанд харгалзах хуримтлагдсан элэгдлийн данс (ENT-001):
 * биет (20000001 / 21010000) → 20000002, биет бус (21000001) → 21000099.
 * Өөр данс бол биет ҮХ-ийн анхдагч.
 */
export const DEFAULT_FA_ASSET_ACCOUNT = "20000001";
export const DEFAULT_FA_ACCUM_DEP_ACCOUNT = "20000002";

export function accumDepAccountFor(assetAccountNumber: string): string {
  return assetAccountNumber === "21000001" ? "21000099" : DEFAULT_FA_ACCUM_DEP_ACCOUNT;
}

// Борлуулалтын тооцоо — ЦЭВЭР (тесттэй): НӨАТ задаргаа (D4: төлөгч эсэхээс),
// НХАТ (нийслэлийн албан татвар), бөөрөнхийлөл, нийт дүн.
// docs/pos/00-proposal.md §3.7-§3.8.
//
// НХАТ (2026-09-26, product owner): хувь нь pos_settings.cityTaxPercent
// (байгууллага өөрөө бичнэ, 0 = бодохгүй), зөвхөн `cityTaxable` бараанд. Үнэ
// хоёр татварыг хоёуланг нь АГУУЛНА; хоёулаа ЦЭВЭР үнээс бодогдоно:
//   цэвэр = T / (1 + НӨАТ% + НХАТ%)   ж: 11,200 = 10,000 + 1,000 НӨАТ + 200 НХАТ (2%)

import { roundMoney as round2 } from "@/lib/arap/accounting";
import type { PricedLine, SaleTotals, TotaledLine } from "./types";

export interface VatContext {
  /** vat_settings.isVatPayer — false бол НӨАТ мөр огт үүсэхгүй. */
  isVatPayer: boolean;
  vatRatePercent: number;
  /** pos_settings.cityTaxPercent — 0/байхгүй бол НХАТ бодохгүй. НӨАТ-аас хамаарахгүй. */
  cityTaxPercent?: number;
}

function taxRates(
  vatMode: PricedLine["vatMode"],
  cityTaxable: boolean,
  ctx: VatContext
): { vat: number; city: number } {
  const vat = ctx.isVatPayer && vatMode === "standard" && ctx.vatRatePercent > 0 ? ctx.vatRatePercent : 0;
  const cityRate = ctx.cityTaxPercent ?? 0;
  const city = cityTaxable && cityRate > 0 ? cityRate : 0;
  return { vat, city };
}

/**
 * Мөрийн татвар орсон дүнгээс НӨАТ ба НХАТ-ыг ялгана (inclusive). Хоёулаа
 * цэвэр үнээс: цэвэр = T / (1 + v + c); бөөрөнхийллийн үлдэгдэл цэвэрт.
 */
export function lineTaxes(
  lineTotal: number,
  vatMode: PricedLine["vatMode"],
  cityTaxable: boolean,
  ctx: VatContext
): { netAmount: number; vatAmount: number; cityTaxAmount: number } {
  const { vat, city } = taxRates(vatMode, cityTaxable, ctx);
  if (vat === 0 && city === 0) return { netAmount: round2(lineTotal), vatAmount: 0, cityTaxAmount: 0 };
  const divisor = 100 + vat + city;
  const vatAmount = round2((lineTotal * vat) / divisor);
  const cityTaxAmount = round2((lineTotal * city) / divisor);
  return { netAmount: round2(lineTotal - vatAmount - cityTaxAmount), vatAmount, cityTaxAmount };
}

/**
 * Мөрийн НӨАТ орсон дүнгээс НӨАТ-ийг ялгана (inclusive, НХАТ-гүй мөр).
 * exempt/zero → 0. Төлөгч биш → 0 (үнэ = орлого).
 */
export function lineVat(
  lineTotal: number,
  vatMode: PricedLine["vatMode"],
  ctx: VatContext
): { netAmount: number; vatAmount: number } {
  const { netAmount, vatAmount } = lineTaxes(lineTotal, vatMode, false, ctx);
  return { netAmount, vatAmount };
}

/** Хөнгөлөлт тооцогдсон мөрүүдээс татварын (НӨАТ, НХАТ) задаргаа + нийт дүн. */
export function computeSaleTotals(
  lines: PricedLine[],
  ctx: VatContext
): SaleTotals {
  const totaled: TotaledLine[] = lines.map((line) => ({
    ...line,
    ...lineTaxes(line.lineTotal, line.vatMode, !!line.cityTaxable, ctx),
  }));
  const grossAmount = round2(totaled.reduce((sum, line) => sum + line.lineGross, 0));
  const discountTotal = round2(totaled.reduce((sum, line) => sum + line.discountAmount, 0));
  const netAmount = round2(totaled.reduce((sum, line) => sum + line.netAmount, 0));
  const vatAmount = round2(totaled.reduce((sum, line) => sum + line.vatAmount, 0));
  const cityTaxAmount = round2(totaled.reduce((sum, line) => sum + line.cityTaxAmount, 0));
  return {
    lines: totaled,
    grossAmount,
    discountTotal,
    netAmount,
    vatAmount,
    cityTaxAmount,
    total: round2(netAmount + vatAmount + cityTaxAmount),
  };
}

/**
 * Бэлэн төлбөрийн бөөрөнхийлөл: unit 0 → өөрчлөлтгүй; 10/100 → хамгийн ойрын
 * нэгж рүү. Буцаах утга: бөөрөнхийлсөн дүн + зөрүү (rounded − amount).
 */
export function roundToCashUnit(
  amount: number,
  unit: number
): { rounded: number; diff: number } {
  if (!(unit > 0)) return { rounded: round2(amount), diff: 0 };
  const rounded = Math.round(amount / unit) * unit;
  return { rounded: round2(rounded), diff: round2(rounded - amount) };
}

/**
 * Хөнгөлөлтийн татваргүй хэсэг — contra горимд Dr Хөнгөлөлт данс энэ дүнгээр
 * (Cr Орлого бүтэн = net + энэ). Татвар (НӨАТ, НХАТ) орсон хөнгөлөлтийг
 * /(1 + v + c) болгоно; татваргүй мөрөнд бүтнээрээ.
 */
export function discountNetOf(
  discountAmount: number,
  vatMode: PricedLine["vatMode"],
  ctx: VatContext,
  cityTaxable = false
): number {
  const { vat, city } = taxRates(vatMode, cityTaxable, ctx);
  if (vat === 0 && city === 0) return round2(discountAmount);
  return round2((discountAmount * 100) / (100 + vat + city));
}

/** Гарагийн дугаар 1 (Да) … 7 (Ня) — УБ-ын цагаар. */
export function ulaanbaatarNow(now = new Date()): {
  date: string;
  time: string;
  weekday: number;
  iso: string;
} {
  const local = now.toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" });
  const date = local.slice(0, 10);
  const time = local.slice(11, 16);
  const jsDay = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Ня
  const weekday = jsDay === 0 ? 7 : jsDay;
  return { date, time, weekday, iso: now.toISOString() };
}

/**
 * POS-ийн зарлагын төрөл барааны COGS дансанд бичдэг эсэх (аудит M6, ENT-022).
 * Хуучин байгууллагад `pos_settings.issueTypeId` нь тогтмол зардлын төрөлд
 * оноогдсон байж болно — тохиргоог ЧИМЭЭГҮЙ солихгүй, ИЛ анхааруулна.
 * Асуудалгүй бол null.
 */
export function posIssueTypeWarning(
  issueType: { name: string; debitAccountSource: string; debitAccountNumber: string | null } | null
): string | null {
  if (!issueType)
    return "POS-ийн зарлагын төрөл тохируулаагүй — POS тохиргооноос «Борлуулалтын өртөг» (барааны COGS) төрлийг сонгоно уу";
  if (issueType.debitAccountSource === "item_cogs") return null;
  return `POS-ийн зарлагын төрөл «${issueType.name}» нь тогтмол данс${issueType.debitAccountNumber ? ` ${issueType.debitAccountNumber}` : ""}-д бичдэг — борлуулсан барааны өртөг барааны COGS дансанд орохгүй. POS тохиргооноос COGS төрлийг сонгоно уу (өмнөх бичилтийг засахгүй)`;
}

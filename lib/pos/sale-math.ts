// Борлуулалтын тооцоо — ЦЭВЭР (тесттэй): НӨАТ задаргаа (D4: төлөгч эсэхээс),
// бөөрөнхийлөл, нийт дүн. docs/pos/00-proposal.md §3.7-§3.8.

import { roundMoney as round2 } from "@/lib/arap/accounting";
import type { PricedLine, SaleTotals, TotaledLine } from "./types";

export interface VatContext {
  /** vat_settings.isVatPayer — false бол НӨАТ мөр огт үүсэхгүй. */
  isVatPayer: boolean;
  vatRatePercent: number;
}

/**
 * Мөрийн НӨАТ орсон дүнгээс НӨАТ-ийг ялгана (inclusive). exempt/zero → 0.
 * Төлөгч биш → 0 (үнэ = орлого).
 */
export function lineVat(
  lineTotal: number,
  vatMode: PricedLine["vatMode"],
  ctx: VatContext
): { netAmount: number; vatAmount: number } {
  if (!ctx.isVatPayer || vatMode !== "standard" || !(ctx.vatRatePercent > 0))
    return { netAmount: round2(lineTotal), vatAmount: 0 };
  const rate = ctx.vatRatePercent;
  const vatAmount = round2((lineTotal * rate) / (100 + rate));
  return { netAmount: round2(lineTotal - vatAmount), vatAmount };
}

/** Хөнгөлөлт тооцогдсон мөрүүдээс НӨАТ задаргаа + нийт дүн. */
export function computeSaleTotals(
  lines: PricedLine[],
  ctx: VatContext
): SaleTotals {
  const totaled: TotaledLine[] = lines.map((line) => ({
    ...line,
    ...lineVat(line.lineTotal, line.vatMode, ctx),
  }));
  const grossAmount = round2(totaled.reduce((sum, line) => sum + line.lineGross, 0));
  const discountTotal = round2(totaled.reduce((sum, line) => sum + line.discountAmount, 0));
  const netAmount = round2(totaled.reduce((sum, line) => sum + line.netAmount, 0));
  const vatAmount = round2(totaled.reduce((sum, line) => sum + line.vatAmount, 0));
  return {
    lines: totaled,
    grossAmount,
    discountTotal,
    netAmount,
    vatAmount,
    total: round2(netAmount + vatAmount),
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
 * Хөнгөлөлтийн НӨАТ-гүй хэсэг — contra горимд Dr Хөнгөлөлт данс энэ дүнгээр
 * (Cr Орлого бүтэн = net + энэ). Стандарт мөрөнд НӨАТ орсон хөнгөлөлтийг
 * /(1+r) болгоно; exempt/zero эсвэл төлөгч биш бол бүтнээрээ.
 */
export function discountNetOf(
  discountAmount: number,
  vatMode: PricedLine["vatMode"],
  ctx: VatContext
): number {
  if (!ctx.isVatPayer || vatMode !== "standard" || !(ctx.vatRatePercent > 0))
    return round2(discountAmount);
  return round2((discountAmount * 100) / (100 + ctx.vatRatePercent));
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

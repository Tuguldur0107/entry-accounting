// Хяналтын дансны хамгаалалт (SIM2-038) — ЦЭВЭР (tests/sim2-control-accounts.test.ts).
//
// Авлага/өглөгийн ХЯНАЛТЫН данс (13110000, 31000001, баримтуудад ашиглагдсан
// бусад) нь дэд дэвтрийн нийлбэр. Гар журнал тэнд бичвэл дэд дэвтэр ба GL
// зөрж, reconcile_modules л хожим илрүүлдэг байв. Горим компанийн тохиргоонд:
// "warn" (анхдагч — анхааруулгатай бичнэ) | "block" (хориглоно).

import { extractMainAccount } from "@/lib/reports/balances";

export type ControlAccountGuardMode = "warn" | "block";

/** Баримтгүй байгууллагад ч хамгаалагдах анхдагч хяналтын дансууд. */
export const DEFAULT_CONTROL_ACCOUNTS = ["13110000", "31000001"] as const;

export function normalizeGuardMode(value: string | null | undefined): ControlAccountGuardMode {
  return value === "block" ? "block" : "warn";
}

/** Нээлтийн журнал (нэвтрүүлэлт) — хяналтын дансны нээлт хуулиар зөв. */
export function isGuardExemptRef(externalRef: string | null | undefined): boolean {
  const ref = externalRef ?? "";
  return ref.startsWith("opening-balance:") || ref.startsWith("cash-opening:");
}

/** Журналын мөрүүдээс хөндөгдсөн хяналтын дансууд (давхардалгүй, эрэмбэтэй). */
export function controlAccountHits(
  accountNumbers: readonly string[],
  controlAccounts: ReadonlySet<string>
): string[] {
  const hits = new Set<string>();
  for (const number of accountNumbers) {
    const main = extractMainAccount(number);
    if (controlAccounts.has(main)) hits.add(main);
  }
  return [...hits].sort();
}

export function controlAccountMessage(hits: readonly string[]): string {
  return `Хяналтын данс (${hits.join(", ")}) гар журналаар хөндөгдөв — дэд дэвтэр (нэхэмжлэх) ба GL зөрнө. Кредит нэхэмжлэл/дебит нэхэмжлэх, АР↔АП суутгал, төлбөрийн баримтаар хийнэ`;
}

import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateCashBalances } from "../lib/cash/balances";
import { mergeCashBalances } from "../lib/cash/period-balances";
import type { CashAccount, CashDocument } from "../lib/db/schema";

// Кассын snapshot + delta замын үр дүн calculateCashBalances (бүх баримтыг
// эхнээс нийлдэг) -тай ЯГ ижил байх ёстой — П28-ын кассын хувилбар.

const accounts = [
  { id: "a", openingBalance: "1000000", name: "Касс" },
  { id: "b", openingBalance: "0", name: "Банк USD" },
] as unknown as CashAccount[];

function doc(
  date: string,
  documentType: "receipt" | "payment" | "transfer",
  amount: number,
  from: string | null,
  to: string | null,
  status = "posted"
): CashDocument {
  return { date, documentType, amount: String(amount), fromCashAccountId: from, toCashAccountId: to, status, documentNo: date } as unknown as CashDocument;
}

// 2026-05 хаагдсан гэж үзнэ; 06, 07-д бичилт үргэлжилнэ.
const DOCS: CashDocument[] = [
  doc("2026-05-03", "receipt", 500000, null, "a"),
  doc("2026-05-20", "payment", 120000, "a", null),
  doc("2026-05-25", "transfer", 200000, "a", "b"),
  doc("2026-05-28", "receipt", 99999, null, "a", "draft"), // ноорог тоологдохгүй
  doc("2026-06-05", "receipt", 300000, null, "a"),
  doc("2026-06-18", "payment", 50000, "b", null),
  doc("2026-07-03", "payment", 80000, "a", null),
];

/** SQL GROUP BY-г цэвэрхэн дуурайна: posted, огнооны муж, данс бүрийн in/out. */
function flows(bounds: { gt?: string; lte?: string }) {
  const out = new Map<string, { inflow: number; outflow: number }>();
  const entry = (id: string) => {
    const cur = out.get(id) ?? { inflow: 0, outflow: 0 };
    out.set(id, cur);
    return cur;
  };
  for (const d of DOCS) {
    if (d.status !== "posted") continue;
    if (bounds.gt && d.date <= bounds.gt) continue;
    if (bounds.lte && d.date > bounds.lte) continue;
    const amt = Number(d.amount);
    if ((d.documentType === "receipt" || d.documentType === "transfer") && d.toCashAccountId)
      entry(d.toCashAccountId).inflow += amt;
    if ((d.documentType === "payment" || d.documentType === "transfer") && d.fromCashAccountId)
      entry(d.fromCashAccountId).outflow += amt;
  }
  return out;
}

test("snapshot(05-31) + delta = бүх баримтыг эхнээс нийлсэнтэй ижил (asOf 07-31)", () => {
  const snapshot = calculateCashBalances(accounts, DOCS.filter((d) => d.date <= "2026-05-31"));
  const merged = mergeCashBalances(accounts, snapshot, flows({ gt: "2026-05-31", lte: "2026-07-31" }));
  const full = calculateCashBalances(accounts, DOCS.filter((d) => d.date <= "2026-07-31"));
  assert.deepEqual([...merged.entries()], [...full.entries()]);
  assert.equal(merged.get("a"), 1000000 + 500000 - 120000 - 200000 + 300000 - 80000);
  assert.equal(merged.get("b"), 200000 - 50000);
});

test("asOf 06-30: snapshot-ын дараах 07 сарын баримт орохгүй", () => {
  const snapshot = calculateCashBalances(accounts, DOCS.filter((d) => d.date <= "2026-05-31"));
  const merged = mergeCashBalances(accounts, snapshot, flows({ gt: "2026-05-31", lte: "2026-06-30" }));
  const full = calculateCashBalances(accounts, DOCS.filter((d) => d.date <= "2026-06-30"));
  assert.deepEqual([...merged.entries()], [...full.entries()]);
});

test("snapshot байхгүй (шинэ систем) — нээлт + бүх delta = бүрэн нийлбэр", () => {
  const merged = mergeCashBalances(accounts, new Map(), flows({}));
  assert.deepEqual([...merged.entries()], [...calculateCashBalances(accounts, DOCS).entries()]);
});

test("snapshot-ын дараа үүссэн данс нээлтээсээ эхэлнэ", () => {
  const withNew = [...accounts, { id: "c", openingBalance: "777", name: "Шинэ" } as unknown as CashAccount];
  const snapshot = calculateCashBalances(accounts, DOCS.filter((d) => d.date <= "2026-05-31")); // "c" байхгүй
  const merged = mergeCashBalances(withNew, snapshot, flows({ gt: "2026-05-31" }));
  assert.equal(merged.get("c"), 777);
});

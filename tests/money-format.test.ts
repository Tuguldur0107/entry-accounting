import { test } from "node:test";
import assert from "node:assert/strict";

import { fmtMntCompact, moneyOrDash } from "../lib/format/money";
import { arapBalanceSummary } from "../lib/arap/kpis";

test("fmtMntCompact: сая / мянга / тэрбум товчлол", () => {
  assert.equal(fmtMntCompact(13_952_730), "13.95 сая ₮");
  assert.equal(fmtMntCompact(2_500_000), "2.5 сая ₮");
  assert.equal(fmtMntCompact(950_000), "950 мянга ₮");
  assert.equal(fmtMntCompact(12_345), "12.3 мянга ₮");
  assert.equal(fmtMntCompact(8_500), "8,500 ₮");
  assert.equal(fmtMntCompact(1_250_000_000), "1.25 тэрбум ₮");
  assert.equal(fmtMntCompact(0), "0 ₮");
});

test("fmtMntCompact: сөрөгт жинхэнэ хасах тэмдэг, гажиг утга «—»", () => {
  assert.equal(fmtMntCompact(-39_000), "−39 мянга ₮");
  assert.equal(fmtMntCompact(Number.NaN), "—");
});

test("moneyOrDash: 0 → «—»", () => {
  const format = (value: number) => value.toFixed(2);
  assert.equal(moneyOrDash(0, format), "—");
  assert.equal(moneyOrDash(0.001, format), "—");
  assert.equal(moneyOrDash(-5, format), "-5.00");
});

test("arapBalanceSummary: хоногоор ангилна, ноорог/төлөгдсөн орохгүй, Σ = нийт", () => {
  const asOf = "2026-09-23";
  const base = { documentType: "ar_invoice", date: "2026-01-01" };
  const summary = arapBalanceSummary(
    [
      { ...base, status: "posted", dueDate: "2026-10-01", baseBalance: 100, counterpartyId: "a" }, // хугацаа болоогүй
      { ...base, status: "posted", dueDate: "2026-09-01", baseBalance: 200, counterpartyId: "a" }, // 22 хоног
      { ...base, status: "partially_paid", dueDate: "2026-08-10", baseBalance: 300, counterpartyId: "b" }, // 44
      { ...base, status: "posted", dueDate: "2025-11-04", baseBalance: 400, counterpartyId: "c" }, // 323
      { ...base, status: "draft", dueDate: "2025-01-01", baseBalance: 999, counterpartyId: "d" },
      { ...base, status: "paid", dueDate: "2025-01-01", baseBalance: 0, counterpartyId: "e" },
      { ...base, documentType: "ap_bill", status: "posted", dueDate: "2025-01-01", baseBalance: 50, counterpartyId: "f" },
    ],
    asOf,
    "ar_invoice"
  );
  assert.equal(summary.total, 1000);
  assert.equal(summary.documentCount, 4);
  assert.equal(summary.counterpartyCount, 3);
  assert.deepEqual(
    summary.buckets.map((bucket) => [bucket.key, bucket.amount, bucket.count]),
    [
      ["0-30", 300, 2],
      ["31-60", 300, 1],
      ["60+", 400, 1],
    ]
  );
  assert.equal(
    summary.buckets.reduce((sum, bucket) => sum + bucket.amount, 0),
    summary.total
  );
});

test("arapBalanceSummary: хоосон үед 0", () => {
  const summary = arapBalanceSummary([], "2026-09-23", "ap_bill");
  assert.equal(summary.total, 0);
  assert.equal(summary.counterpartyCount, 0);
  assert.ok(summary.buckets.every((bucket) => bucket.amount === 0));
});

test("readonlyMoneyValueFormatter: 0 → «—», хоосон хоосон, сөрөг «−»", async () => {
  const { readonlyMoneyValueFormatter } = await import("../lib/grid/formatters");
  assert.equal(readonlyMoneyValueFormatter({ value: 0 }), "—");
  assert.equal(readonlyMoneyValueFormatter({ value: null }), "");
  assert.equal(readonlyMoneyValueFormatter({ value: "" }), "");
  assert.ok(readonlyMoneyValueFormatter({ value: -39000 }).startsWith("−"));
  assert.ok(readonlyMoneyValueFormatter({ value: 333360 }).includes("333"));
});

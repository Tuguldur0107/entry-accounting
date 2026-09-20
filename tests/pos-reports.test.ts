import test from "node:test";
import assert from "node:assert/strict";

import { aggregateBy, aggregatePayments, summarize, type SalesLineRow, type SalesPaymentRow } from "../lib/pos/reports";

function line(partial: Partial<SalesLineRow> & Pick<SalesLineRow, "saleId" | "itemId" | "quantity" | "netAmount" | "lineTotal">): SalesLineRow {
  return {
    documentNo: partial.saleId,
    date: "2026-09-19",
    soldAt: "2026-09-19T02:00:00Z",
    isReturn: false,
    status: "posted",
    cashierName: "Сарнай",
    counterpartyId: "cp",
    counterpartyName: "Бэлэн худалдан авагч",
    customerGroup: null,
    warehouseId: "wh",
    warehouseName: "Дэлгүүр-1",
    shiftNo: null,
    itemCode: partial.itemId,
    itemName: partial.itemId,
    categoryCode: null,
    unitPrice: 0,
    lineGross: partial.lineTotal,
    discountAmount: 0,
    vatAmount: 0,
    discountRules: [],
    paymentSummary: "",
    cogs: null,
    cogsBasis: "none",
    margin: null,
    ...partial,
  };
}

test("aggregateBy бараагаар: тоо, орлого, COGS, ахиуц % (санал §6 LT-01)", () => {
  const rows = aggregateBy(
    [
      line({ saleId: "s1", itemId: "LT-01", quantity: 1, netAmount: 1_500_000, lineTotal: 1_650_000, cogs: 1_465_000, cogsBasis: "final", margin: 35_000 }),
      line({ saleId: "s2", itemId: "LT-01", quantity: 1, netAmount: 1_500_000, lineTotal: 1_650_000, cogs: 1_465_000, cogsBasis: "final", margin: 35_000 }),
    ],
    (entry) => ({ key: entry.itemId, label: entry.itemName })
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].net, 3_000_000);
  assert.equal(rows[0].cogs, 2_930_000);
  assert.equal(rows[0].margin, 70_000);
  assert.equal(rows[0].marginPercent, 2.33);
  assert.equal(rows[0].cogsBasis, "final");
});

test("буцаалт сөрөг тоо/дүнтэй, count-д орохгүй; COGS тодорхойгүй мөр → null суурь", () => {
  const rows = aggregateBy(
    [
      line({ saleId: "s1", itemId: "MN", quantity: 4, netAmount: 100, lineTotal: 110, cogs: 80, cogsBasis: "provisional", margin: 20 }),
      line({ saleId: "r1", itemId: "MN", quantity: -1, netAmount: -25, lineTotal: -27.5, isReturn: true, cogs: -20, cogsBasis: "provisional", margin: -5 }),
      line({ saleId: "s2", itemId: "MN", quantity: 1, netAmount: 30, lineTotal: 33 }),
    ],
    (entry) => ({ key: entry.itemId, label: entry.itemName })
  );
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].quantity, 4);
  assert.equal(rows[0].net, 105);
  assert.equal(rows[0].cogs, null);
  assert.equal(rows[0].cogsBasis, "none");
});

test("summarize: дундаж чек буцаалтыг хассан дүнгээр, урьдчилсан суурь хамгийн сул нь", () => {
  const summary = summarize([
    line({ saleId: "s1", itemId: "A", quantity: 1, netAmount: 100, lineTotal: 110, cogs: 60, cogsBasis: "final", margin: 40 }),
    line({ saleId: "s2", itemId: "A", quantity: 1, netAmount: 100, lineTotal: 110, cogs: 60, cogsBasis: "provisional", margin: 40 }),
    line({ saleId: "r1", itemId: "A", quantity: -1, netAmount: -100, lineTotal: -110, isReturn: true, cogs: -60, cogsBasis: "provisional", margin: -40 }),
  ]);
  assert.equal(summary.salesCount, 2);
  assert.equal(summary.returnsCount, 1);
  assert.equal(summary.total, 110);
  assert.equal(summary.returnsTotal, 110);
  assert.equal(summary.averageTicket, 110);
  assert.equal(summary.cogs, 60);
  assert.equal(summary.margin, 40);
  assert.equal(summary.marginPercent, 40);
  assert.equal(summary.cogsBasis, "provisional");
});

test("aggregatePayments: хэлбэрээр нийлбэр, буцаалт хасагдана", () => {
  const payments: SalesPaymentRow[] = [
    { saleId: "s1", date: "2026-09-19", isReturn: false, methodId: "cash", methodName: "Бэлэн", kind: "cash", baseAmount: 1_000_000 },
    { saleId: "s1", date: "2026-09-19", isReturn: false, methodId: "card", methodName: "Карт", kind: "card", baseAmount: 661_550 },
    { saleId: "r1", date: "2026-09-25", isReturn: true, methodId: "cash", methodName: "Бэлэн", kind: "cash", baseAmount: -31_350 },
    { saleId: "s2", date: "2026-09-20", isReturn: false, methodId: "qpay", methodName: "QPay", kind: "ewallet", provider: "qpay", baseAmount: 15_000 },
  ];
  const rows = aggregatePayments(payments);
  assert.equal(rows.find((row) => row.methodId === "cash")?.amount, 968_650);
  assert.equal(rows.find((row) => row.methodId === "cash")?.count, 1);
  assert.equal(rows.find((row) => row.methodId === "card")?.amount, 661_550);
  assert.equal(rows.find((row) => row.methodId === "cash")?.provider, null);
  assert.equal(rows.find((row) => row.methodId === "qpay")?.provider, "qpay");
});

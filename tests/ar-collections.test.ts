// Авлагын цуглуулалтын самбарын ЦЭВЭР тооцоо (lib/arap/collections.ts).

import assert from "node:assert/strict";
import test from "node:test";

import { daysSalesOutstanding, expectedInflow, reminderEffect, topOverdueCustomers } from "../lib/arap/collections";

const invoices = [
  { counterpartyId: "a", counterpartyName: "Бат", dueDate: "2026-09-01", balance: 300_000 },
  { counterpartyId: "a", counterpartyName: "Бат", dueDate: "2026-09-20", balance: 200_000 },
  { counterpartyId: "b", counterpartyName: "Гэрэл", dueDate: "2026-09-27", balance: 400_000 },
  { counterpartyId: "c", counterpartyName: "Номин", dueDate: "2026-10-03", balance: 100_000 },
  { counterpartyId: "c", counterpartyName: "Номин", dueDate: "2026-10-20", balance: 50_000 },
  { counterpartyId: "d", counterpartyName: "Оюу", dueDate: "2026-12-01", balance: 70_000 },
  { counterpartyId: "e", counterpartyName: "Төлсөн", dueDate: "2026-08-01", balance: 0 },
];

test("DSO", () => {
  assert.equal(daysSalesOutstanding(1_000_000, 3_000_000), 30);
  assert.equal(daysSalesOutstanding(500, 0), null);
  assert.equal(daysSalesOutstanding(-10, 1000), 0);
});

test("хүлээгдэж буй орлого — төлөх огноогоор", () => {
  assert.deepEqual(expectedInflow(invoices, "2026-09-28"), {
    overdue: 900_000,
    overdueCount: 3,
    next7: 100_000,
    next7Count: 1,
    next30: 50_000,
    next30Count: 1,
    later: 70_000,
    laterCount: 1,
  });
});

test("хамгийн их хэтэрсэн харилцагч", () => {
  assert.deepEqual(topOverdueCustomers(invoices, "2026-09-28"), [
    { counterpartyId: "a", name: "Бат", amount: 500_000, invoices: 2, maxDaysOverdue: 27 },
    { counterpartyId: "b", name: "Гэрэл", amount: 400_000, invoices: 1, maxDaysOverdue: 1 },
  ]);
  assert.equal(topOverdueCustomers(invoices, "2026-09-28", 1).length, 1);
});

test("сануулгын үр дүн — 7 хоногт төлсөн", () => {
  assert.deepEqual(
    reminderEffect(
      [
        { documentId: "x", sentDate: "2026-09-01" },
        { documentId: "y", sentDate: "2026-09-01" },
        { documentId: "z", sentDate: "2026-09-10" },
      ],
      [
        { documentId: "x", date: "2026-09-05" },
        { documentId: "y", date: "2026-09-20" },
        { documentId: "z", date: "2026-09-05" },
      ]
    ),
    { sent: 3, paid: 1, rate: 33 }
  );
  assert.deepEqual(reminderEffect([], []), { sent: 0, paid: 0, rate: null });
});

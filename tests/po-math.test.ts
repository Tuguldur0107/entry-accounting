// Захиалгын (PO) гүйцэтгэлийн арифметик — ЦЭВЭР тест (DB-гүй).
// docs/procurement §3.4 нийлбэр таарах хяналт.

import test from "node:test";
import assert from "node:assert/strict";

import {
  poCloseBlockers,
  remainingToInvoice,
  remainingToReceive,
  type PoLineProgress,
} from "../lib/procurement/po-math";

function line(partial: Partial<PoLineProgress> = {}): PoLineProgress {
  return {
    ordered: 100,
    received: 100,
    invoiced: 100,
    invoicedAmount: 40_000,
    orderedAmount: 40_000,
    ...partial,
  };
}

test("хүлээн аваагүй / нэхэмжлээгүй үлдэгдэл", () => {
  const partial = line({ received: 40, invoiced: 25, invoicedAmount: 10_000 });
  assert.equal(remainingToReceive(partial), 60);
  assert.equal(remainingToInvoice(partial), 75);
});

test("илүү хүлээн авсан/нэхэмжилсэн үед үлдэгдэл сөрөг болохгүй", () => {
  const over = line({ received: 120, invoiced: 130 });
  assert.equal(remainingToReceive(over), 0);
  assert.equal(remainingToInvoice(over), 0);
});

test("бутархай тоо хэмжээ 4 орноор бөөрөнхийлөгдөнө", () => {
  const fractional = line({ ordered: 10.5, received: 3.3333, invoiced: 0 });
  assert.equal(remainingToReceive(fractional), 7.1667);
  assert.equal(remainingToInvoice(fractional), 10.5);
});

test("бүрэн хүлээн авч, нэхэмжилж, хуваарилсан PO хаагдана", () => {
  assert.deepEqual(
    poCloseBlockers({ lines: [line(), line()], unallocatedCostAmount: 0 }),
    []
  );
});

test("мөргүй захиалга хаагдахгүй", () => {
  assert.deepEqual(poCloseBlockers({ lines: [], unallocatedCostAmount: 0 }), [
    "Захиалгад мөр байхгүй байна",
  ]);
});

test("хүлээн аваагүй үлдэгдэл blocker — мөрийн тоо, нийт тоо хэмжээтэй", () => {
  const blockers = poCloseBlockers({
    lines: [line({ received: 60 }), line({ received: 90 }), line()],
    unallocatedCostAmount: 0,
  });
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0], "Хүлээн аваагүй үлдэгдэл байна — 2 мөр (50 нэгж)");
});

test("илүү хүлээн авалт ба илүү нэхэмжлэл тусдаа blocker", () => {
  const blockers = poCloseBlockers({
    lines: [line({ received: 110, invoiced: 105, invoicedAmount: 42_000 })],
    unallocatedCostAmount: 0,
  });
  assert.deepEqual(blockers, [
    "Захиалснаас илүү хүлээн авсан — 1 мөр (10 нэгж)",
    "Захиалснаас илүү нэхэмжилсэн — 1 мөр (5 нэгж)",
    "Нэхэмжлэхийн дүн захиалгын дүнтэй таарахгүй — 1 мөр (зөрүү -2,000)",
  ]);
});

test("тоо таарсан ч дүн зөрвөл хаагдахгүй (§3.4 мөр бүрээр)", () => {
  const blockers = poCloseBlockers({
    lines: [line({ invoicedAmount: 40_500 })],
    unallocatedCostAmount: 0,
  });
  assert.deepEqual(blockers, [
    "Нэхэмжлэхийн дүн захиалгын дүнтэй таарахгүй — 1 мөр (зөрүү -500)",
  ]);
});

test("хуваарилагдаагүй нэмэлт зардал хаалтыг хориглоно", () => {
  const blockers = poCloseBlockers({
    lines: [line()],
    unallocatedCostAmount: 1_234_567.5,
  });
  assert.deepEqual(blockers, [
    "Хуваарилагдаагүй нэмэлт зардал байна — 1,234,567.5₮",
  ]);
});

test("бөөрөнхийллийн хэмжээний зөрүү (default tolerance 0.005) хориглохгүй", () => {
  assert.deepEqual(
    poCloseBlockers({
      lines: [
        line({ received: 99.999, invoiced: 100.001, invoicedAmount: 40_000.004 }),
      ],
      unallocatedCostAmount: 0.004,
    }),
    []
  );
});

test("tolerance-ийг илээр өгч чангаруулж болно", () => {
  const blockers = poCloseBlockers({
    lines: [line({ received: 99.999 })],
    unallocatedCostAmount: 0,
    tolerance: 0.0001,
  });
  assert.deepEqual(blockers, [
    "Хүлээн аваагүй үлдэгдэл байна — 1 мөр (0.001 нэгж)",
  ]);
});

// ── Дутуу хаалт (ENT-064) ────────────────────────────────────────────────────

import {
  poShortClosePlan,
  poWriteOffAccountProblem,
  type PoShortCloseLine,
} from "../lib/procurement/po-math";

function shortLine(partial: Partial<PoShortCloseLine> = {}): PoShortCloseLine {
  return {
    ordered: 20,
    received: 12,
    invoiced: 12,
    invoicedAmount: 12_000,
    orderedAmount: 20_000,
    postedInvoiced: 12,
    postedInvoicedAmount: 12_000,
    unitPrice: 1_000,
    postedInvoicedMnt: 12_000,
    ...partial,
  };
}

test("дутуу хаалт: хүлээн аваагүй үлдэгдэл цуцлагдана, зардал 0", () => {
  const plan = poShortClosePlan({ lines: [shortLine()], unallocatedCostAmount: 0 });
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.cancelledQuantity, 8);
  assert.equal(plan.writeOffMnt, 0);
});

test("дутуу хаалт: илүү нэхэмжлэл нэхэмжлэхийн (жигнэсэн) ханшаар зардал болно", () => {
  // USD: 15 × $100 нэхэмжилсэн, 3,450 ба 3,470 ханшийн хоёр нэхэмжлэх → жигнэсэн MNT.
  const plan = poShortClosePlan({
    lines: [
      shortLine({
        received: 12,
        invoiced: 15,
        postedInvoiced: 15,
        invoicedAmount: 1_500,
        postedInvoicedAmount: 1_500,
        orderedAmount: 2_000,
        unitPrice: 100,
        postedInvoicedMnt: 10 * 100 * 3_450 + 5 * 100 * 3_470,
      }),
    ],
    unallocatedCostAmount: 0,
  });
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.lines[0].overInvoicedQuantity, 3);
  assert.equal(plan.lines[0].overInvoicedAmount, 300);
  // 5,185,000 × 3 / 15 = 1,037,000
  assert.equal(plan.writeOffMnt, 1_037_000);
});

test("дутуу хаалт: хүлээн авсан ч нэхэмжлээгүй бараа хориглоно (олз гэж бичихгүй)", () => {
  const plan = poShortClosePlan({
    lines: [shortLine({ invoiced: 10, postedInvoiced: 10, postedInvoicedAmount: 10_000 })],
    unallocatedCostAmount: 0,
  });
  assert.match(plan.blockers.join(";"), /бүрэн нэхэмжлээгүй — 1 мөр \(2 нэгж\)/);
});

test("дутуу хаалт: үйл ажиллагаагүй, ноорог, хуваарилагдаагүй, үнийн зөрүү", () => {
  assert.match(
    poShortClosePlan({
      lines: [shortLine({ received: 0, invoiced: 0, postedInvoiced: 0, postedInvoicedAmount: 0, postedInvoicedMnt: 0 })],
      unallocatedCostAmount: 0,
    }).blockers.join(";"),
    /цуцална уу/
  );
  const blocked = poShortClosePlan({
    lines: [shortLine({ postedInvoicedAmount: 12_500 })],
    unallocatedCostAmount: 1_000,
    draftInvoiceCount: 1,
    draftCostEntryCount: 2,
  }).blockers.join(";");
  assert.match(blocked, /нэгж үнэ захиалгынхаас зөрсөн/);
  assert.match(blocked, /Хуваарилагдаагүй/);
  assert.match(blocked, /НООРОГ нэхэмжлэх/);
  assert.match(blocked, /Батлагдаагүй өртгийн бичилт/);
  assert.match(
    poShortClosePlan({ lines: [shortLine({ received: 21 })], unallocatedCostAmount: 0 }).blockers.join(";"),
    /илүү хүлээн авсан/
  );
});

test("дутуу хаалт: зардлын дансны шалгалт — кодод данс байхгүй", () => {
  const clearing = { invClearing: "14000099", apClearing: "31000099" };
  assert.match(poWriteOffAccountProblem("", clearing)!, /WRITE_OFF_ACCOUNT_REQUIRED/);
  assert.match(poWriteOffAccountProblem("31000099", clearing)!, /Түр дансанд/);
  assert.match(poWriteOffAccountProblem("51100000", clearing)!, /зардлын данс биш/);
  assert.equal(poWriteOffAccountProblem("72900000", clearing), null);
  assert.equal(poWriteOffAccountProblem("87000003", clearing), null);
});

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

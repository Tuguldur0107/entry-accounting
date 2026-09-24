import assert from "node:assert/strict";
import test from "node:test";

import {
  planSettlementRollback,
  statusAfterRollback,
} from "../scripts/lib/settlement-cleanup-plan.mjs";

test("бүтэн өнчин төлөлт — нэхэмжлэх нээлттэй болж сэргэнэ", () => {
  const { plans, settlementIds, missingInvoices } = planSettlementRollback(
    [{ id: "s1", documentId: "inv1", amount: "250000", baseAmount: "250000" }],
    [
      {
        id: "inv1",
        totalAmount: "250000",
        paidAmount: "250000",
        basePaidAmount: "250000",
        status: "paid",
      },
    ]
  );
  assert.deepEqual(settlementIds, ["s1"]);
  assert.deepEqual(missingInvoices, []);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].paidAfter, 0);
  assert.equal(plans[0].basePaidAfter, 0);
  assert.equal(plans[0].status, "posted");
  assert.equal(plans[0].statusBefore, "paid");
});

test("хэсэгчилсэн — үлдсэн бодит төлөлт хэвээр, төлөв partially_paid", () => {
  const { plans } = planSettlementRollback(
    [{ id: "s1", documentId: "inv1", amount: "40000", baseAmount: "40000" }],
    [
      {
        id: "inv1",
        totalAmount: "100000",
        paidAmount: "70000",
        basePaidAmount: "70000",
        status: "paid",
      },
    ]
  );
  assert.equal(plans[0].paidAfter, 30000);
  assert.equal(plans[0].status, "partially_paid");
});

test("нэг нэхэмжлэхийн хэд хэдэн өнчин мөр нэгтгэгдэнэ", () => {
  const { plans, settlementIds } = planSettlementRollback(
    [
      { id: "s1", documentId: "inv1", amount: "10000", baseAmount: "10000" },
      { id: "s2", documentId: "inv1", amount: "15000.5", baseAmount: "15000.5" },
    ],
    [
      {
        id: "inv1",
        totalAmount: "50000",
        paidAmount: "25000.5",
        basePaidAmount: "25000.5",
        status: "partially_paid",
      },
    ]
  );
  assert.equal(settlementIds.length, 2);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].settlementCount, 2);
  assert.equal(plans[0].amount, 25000.5);
  assert.equal(plans[0].paidAfter, 0);
  assert.equal(plans[0].status, "posted");
});

test("paidAmount 0-оос доош ОРОХГҮЙ (гажиг өгөгдөлд ч)", () => {
  const { plans } = planSettlementRollback(
    [{ id: "s1", documentId: "inv1", amount: "999999", baseAmount: "999999" }],
    [
      {
        id: "inv1",
        totalAmount: "100000",
        paidAmount: "100000",
        basePaidAmount: "100000",
        status: "paid",
      },
    ]
  );
  assert.equal(plans[0].paidAfter, 0);
  assert.equal(plans[0].basePaidAfter, 0);
});

test("ноорог / буцаагдсан нэхэмжлэхийн төлөв ХӨНДӨГДӨХГҮЙ", () => {
  assert.equal(
    statusAfterRollback({ status: "draft", totalAmount: 100, paidAfter: 0 }),
    "draft"
  );
  assert.equal(
    statusAfterRollback({ status: "reversed", totalAmount: 100, paidAfter: 0 }),
    "reversed"
  );
});

test("валютын баримт — baseAmount тусад хасагдана", () => {
  const { plans } = planSettlementRollback(
    [{ id: "s1", documentId: "inv1", amount: "100", baseAmount: "359561" }],
    [
      {
        id: "inv1",
        totalAmount: "100",
        paidAmount: "100",
        basePaidAmount: "359561",
        status: "paid",
      },
    ]
  );
  assert.equal(plans[0].paidAfter, 0);
  assert.equal(plans[0].basePaidAfter, 0);
});

test("нэхэмжлэх олдохгүй бол мөр л устана (таамаглахгүй)", () => {
  const { plans, settlementIds, missingInvoices } = planSettlementRollback(
    [{ id: "s1", documentId: "gone", amount: "100", baseAmount: "100" }],
    []
  );
  assert.deepEqual(plans, []);
  assert.deepEqual(settlementIds, ["s1"]);
  assert.deepEqual(missingInvoices, ["gone"]);
});

test("өнчин мөр байхгүй — хоосон төлөвлөгөө (идемпотент)", () => {
  const { plans, settlementIds } = planSettlementRollback([], []);
  assert.deepEqual(plans, []);
  assert.deepEqual(settlementIds, []);
});

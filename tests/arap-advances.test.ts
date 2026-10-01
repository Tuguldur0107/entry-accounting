// Урьдчилгааны ЦЭВЭР логик (docs/dev/arap.md §5l) — lib/arap/advance-math.ts.

import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceCashSign,
  advanceSideOf,
  bankRowActionAdvanceSide,
  bankRowActionDirection,
  computeAdvanceBalances,
  isBankRowAction,
  resolveAdvanceApplyAmount,
  splitInclusiveVat,
} from "../lib/arap/advance-math";

test("advance side follows the invoice ledger; credit notes have none", () => {
  assert.equal(advanceSideOf("ar_invoice"), "customer");
  assert.equal(advanceSideOf("ap_bill"), "supplier");
  assert.equal(advanceSideOf("ar_credit_note"), null);
  assert.equal(advanceSideOf("ap_debit_note"), null);
});

test("cash sign: customer advances grow on receipts, supplier advances on payments; refunds reduce", () => {
  assert.equal(advanceCashSign("customer", "receipt"), 1);
  assert.equal(advanceCashSign("customer", "payment"), -1);
  assert.equal(advanceCashSign("supplier", "payment"), 1);
  assert.equal(advanceCashSign("supplier", "receipt"), -1);
  assert.equal(advanceCashSign("customer", "transfer"), 0);
});

test("balances = advance cash − applications, per counterparty × side", () => {
  const balances = computeAdvanceBalances(
    [
      { counterpartyId: "C1", side: "customer", documentType: "receipt", amount: 1_100_000 },
      { counterpartyId: "C1", side: "customer", documentType: "payment", amount: 100_000 }, // буцаан олголт
      { counterpartyId: "S1", side: "supplier", documentType: "payment", amount: 500_000 },
      { counterpartyId: "S2", side: "supplier", documentType: "payment", amount: 200_000 },
    ],
    [
      { counterpartyId: "C1", side: "customer", amount: 600_000 },
      { counterpartyId: "S2", side: "supplier", amount: 200_000 },
    ]
  );
  const byKey = new Map(balances.map((row) => [`${row.counterpartyId}:${row.side}`, row]));
  assert.deepEqual(
    [byKey.get("C1:customer")?.received, byKey.get("C1:customer")?.applied, byKey.get("C1:customer")?.balance],
    [1_000_000, 600_000, 400_000]
  );
  assert.equal(byKey.get("S1:supplier")?.balance, 500_000);
  // Бүрэн суутгагдсан ч орсон түүхтэй тул жагсаалтад үлдэнэ (үлдэгдэл 0).
  assert.equal(byKey.get("S2:supplier")?.balance, 0);
});

test("apply amount defaults to the smaller balance and never exceeds either", () => {
  assert.deepEqual(resolveAdvanceApplyAmount({ advanceBalance: 400_000, invoiceBalance: 1_000_000 }), { amount: 400_000 });
  assert.deepEqual(resolveAdvanceApplyAmount({ advanceBalance: 1_500_000, invoiceBalance: 1_000_000 }), { amount: 1_000_000 });
  assert.deepEqual(resolveAdvanceApplyAmount({ requested: 250_000, advanceBalance: 400_000, invoiceBalance: 1_000_000 }), { amount: 250_000 });
  assert.match(
    (resolveAdvanceApplyAmount({ requested: 500_000, advanceBalance: 400_000, invoiceBalance: 1_000_000 }) as { error: string }).error,
    /урьдчилгааны үлдэгдлээс/
  );
  assert.match(
    (resolveAdvanceApplyAmount({ requested: 50_000, advanceBalance: 400_000, invoiceBalance: 30_000 }) as { error: string }).error,
    /нэхэмжлэхийн үлдэгдлээс/
  );
  assert.match((resolveAdvanceApplyAmount({ advanceBalance: 0, invoiceBalance: 10 }) as { error: string }).error, /урьдчилгааны үлдэгдэл алга/);
  assert.match((resolveAdvanceApplyAmount({ requested: 0, advanceBalance: 10, invoiceBalance: 10 }) as { error: string }).error, /0-ээс их/);
});

test("bank row actions: direction, advance side, validation", () => {
  assert.equal(isBankRowAction("advance_received"), true);
  assert.equal(isBankRowAction("settle"), false);
  assert.equal(isBankRowAction(null), false);
  assert.equal(bankRowActionDirection("advance_received"), "income");
  assert.equal(bankRowActionDirection("prepaid_paid"), "expense");
  assert.equal(bankRowActionDirection("create_ap_bill"), "expense");
  assert.equal(bankRowActionAdvanceSide("advance_received"), "customer");
  assert.equal(bankRowActionAdvanceSide("prepaid_paid"), "supplier");
  assert.equal(bankRowActionAdvanceSide("create_ap_bill"), null);
});

test("inclusive VAT split is 10/110 and sums back to the gross", () => {
  assert.deepEqual(splitInclusiveVat(110_000, 10), { net: 100_000, vat: 10_000 });
  const odd = splitInclusiveVat(33_333, 10);
  assert.equal(odd.vat, 3_030.27);
  assert.equal(Math.round((odd.net + odd.vat) * 100) / 100, 33_333);
});

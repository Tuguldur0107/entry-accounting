// Хуулгын бичилтийн урьдчилсан харагдацын бүлэглэлт (lib/cash/statement-preview.ts).

import assert from "node:assert/strict";
import test from "node:test";

import { buildStatementPreview } from "../lib/cash/statement-preview";

const code = (main: string) => `000.000000.${main}.00.0000`;

test("өглөг үүсгэж хаах мөр: 2 журнал, хяналтын данс цэвэр 0, давхар бичилттэй мөр тоологдоно", () => {
  const preview = buildStatementPreview({
    rowCount: 2,
    vouchers: [
      { id: "cash-2", rowNumber: 2, kind: "cash", reference: null, date: "2025-09-12" },
      { id: "pay-1", rowNumber: 1, kind: "settlement", reference: "шинэ өглөгийн нэхэмжлэх", date: "2025-09-12" },
      { id: "bill-1", rowNumber: 1, kind: "ap_bill", reference: "Голомт банк", date: "2025-09-12" },
    ],
    lines: [
      { voucherId: "bill-1", accountNumber: code("31000001"), debit: "0", credit: "110", description: "x", sortOrder: 2 },
      { voucherId: "bill-1", accountNumber: code("73100008"), debit: "100", credit: "0", description: "x", sortOrder: 0 },
      { voucherId: "bill-1", accountNumber: code("13620000"), debit: "10", credit: "0", description: "x", sortOrder: 1 },
      { voucherId: "pay-1", accountNumber: code("31000001"), debit: "110", credit: "0", description: "x", sortOrder: 0 },
      { voucherId: "pay-1", accountNumber: code("11000001"), debit: "0", credit: "110", description: "x", sortOrder: 1 },
      { voucherId: "cash-2", accountNumber: code("11000001"), debit: "50", credit: "0", description: null, sortOrder: 0 },
      { voucherId: "cash-2", accountNumber: code("51100000"), debit: "0", credit: "50", description: null, sortOrder: 1 },
    ],
    accountNames: new Map([
      ["31000001", "Өглөг"],
      ["11000001", "Харилцах данс"],
    ]),
  });

  // Мөрийн дарааллаар, мөр дотроо нэхэмжлэх → кассын баримт; мөрүүд sortOrder-оор.
  assert.deepEqual(
    preview.vouchers.map((voucher) => [voucher.rowNumber, voucher.kind]),
    [[1, "ap_bill"], [1, "settlement"], [2, "cash"]]
  );
  assert.deepEqual(preview.vouchers[0].lines.map((line) => line.mainAccount), ["73100008", "13620000", "31000001"]);
  assert.equal(preview.vouchers[0].lines[2].accountName, "Өглөг");

  const payable = preview.totals.find((entry) => entry.mainAccount === "31000001");
  assert.deepEqual(payable && [payable.debit, payable.credit, payable.net], [110, 110, 0]);
  const bank = preview.totals.find((entry) => entry.mainAccount === "11000001");
  assert.equal(bank?.net, -60);

  assert.equal(preview.debitTotal, 270);
  assert.equal(preview.creditTotal, 270);
  assert.equal(preview.balanced, true);
  assert.equal(preview.multiVoucherRows, 1);
  assert.deepEqual(
    [preview.counts.ap_bill, preview.counts.settlement, preview.counts.cash, preview.counts.ar_invoice],
    [1, 1, 1, 0]
  );
});

test("тэнцээгүй бичилт ил", () => {
  const preview = buildStatementPreview({
    rowCount: 1,
    vouchers: [{ id: "v", rowNumber: 1, kind: "cash", reference: null, date: "2025-09-12" }],
    lines: [
      { voucherId: "v", accountNumber: "11000001", debit: 100, credit: 0, description: "" },
      { voucherId: "v", accountNumber: "51100000", debit: 0, credit: 99.5, description: "" },
    ],
    accountNames: new Map(),
  });
  assert.equal(preview.balanced, false);
  assert.equal(preview.totals[0].mainAccount, "11000001");
});

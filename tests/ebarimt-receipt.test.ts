import test from "node:test";
import assert from "node:assert/strict";

import {
  allocatePayments,
  buildEbarimtReceipt,
  ebarimtSettingsProblems,
  receiptResponseOutcome,
  taxTypeOf,
} from "../lib/ebarimt/receipt";
import type { EbarimtSaleInput, EbarimtSaleLineInput, EbarimtSettingsInput } from "../lib/ebarimt/types";

const settings: EbarimtSettingsInput = {
  enabled: true,
  merchantTin: "37900846788",
  branchNo: "001",
  districtCode: "2301",
  posNo: "10001",
  posApiUrl: "http://posapi.railway.internal:7080",
  mode: "server",
};

function line(partial: Partial<EbarimtSaleLineInput> & Pick<EbarimtSaleLineInput, "itemName" | "quantity" | "lineTotal">): EbarimtSaleLineInput {
  return {
    barcode: null,
    unit: "ш",
    vatMode: "standard",
    classificationCode: "4711000",
    taxProductCode: null,
    vatAmount: Math.round((partial.lineTotal * 10) / 110 * 100) / 100,
    ...partial,
  };
}

function sale(partial: Partial<EbarimtSaleInput> = {}): EbarimtSaleInput {
  return {
    saleId: "s1",
    documentNo: "POS-2609-0001",
    isVatPayer: true,
    customerTin: null,
    consumerNo: null,
    total: 1_661_550,
    lines: [
      line({ itemName: "Зөөврийн компьютер", quantity: 1, lineTotal: 1_500_000 }),
      line({ itemName: "Хулгана", quantity: 3, lineTotal: 161_550 }),
    ],
    payments: [
      { kind: "cash", methodName: "Бэлэн", ebarimtCode: "CASH", baseAmount: 1_000_000, reference: null },
      { kind: "card", methodName: "Карт", ebarimtCode: "PAYMENT_CARD", baseAmount: 661_550, reference: "SLIP-42" },
    ],
    ...partial,
  };
}

test("тохиргооны шалгалт — дутуу талбар бүр нэрлэгдэнэ", () => {
  assert.deepEqual(ebarimtSettingsProblems(settings), []);
  const problems = ebarimtSettingsProblems({ ...settings, merchantTin: "123", districtCode: "1", posApiUrl: "posapi" });
  assert.equal(problems.length, 3);
});

test("taxType: НӨАТ төлөгч бус → NOT_VAT; төлөгч → vatMode-оор", () => {
  assert.equal(taxTypeOf({ vatMode: "standard" }, false), "NOT_VAT");
  assert.equal(taxTypeOf({ vatMode: "exempt" }, false), "NOT_VAT");
  assert.equal(taxTypeOf({ vatMode: "standard" }, true), "VAT_ABLE");
  assert.equal(taxTypeOf({ vatMode: "exempt" }, true), "VAT_FREE");
  assert.equal(taxTypeOf({ vatMode: "zero" }, true), "VAT_ZERO");
});

test("B2C баримт: нэг VAT_ABLE дэд баримт, Σ мөр = totalAmount, төлбөр = баримтын дүн", () => {
  const request = buildEbarimtReceipt(sale(), settings);
  assert.equal(request.type, "B2C_RECEIPT");
  assert.equal(request.merchantTin, "37900846788");
  assert.equal(request.receipts.length, 1);
  assert.equal(request.receipts[0].taxType, "VAT_ABLE");
  assert.equal(request.totalAmount, 1_661_550);
  assert.equal(request.totalVat, 151_050);
  assert.equal(request.receipts[0].items[1].unitPrice, 53_850);
  assert.equal(request.receipts[0].items[1].qty, 3);
  const paid = request.payments.reduce((sum, payment) => sum + payment.paidAmount, 0);
  assert.equal(paid, 1_661_550);
  assert.equal(request.payments.find((payment) => payment.code === "PAYMENT_CARD")?.exchangeCode, "SLIP-42");
  assert.equal(request.consumerNo, undefined);
});

test("НӨАТ төлөгч бус: NOT_VAT, totalVat 0, taxProductCode шаардахгүй", () => {
  const request = buildEbarimtReceipt(
    sale({ isVatPayer: false, lines: [line({ itemName: "A", quantity: 2, lineTotal: 20_000, vatMode: "exempt", vatAmount: 0 })], total: 20_000, payments: [{ kind: "cash", methodName: "Бэлэн", ebarimtCode: "CASH", baseAmount: 20_000, reference: null }] }),
    settings
  );
  assert.equal(request.receipts[0].taxType, "NOT_VAT");
  assert.equal(request.totalVat, 0);
  assert.equal(request.receipts[0].items[0].totalVat, 0);
});

test("холимог taxType → дэд баримт бүрд бүлэглэнэ; exempt-д татварын код заавал", () => {
  const mixed = sale({
    lines: [
      line({ itemName: "Ном", quantity: 1, lineTotal: 30_000, vatMode: "exempt", vatAmount: 0, taxProductCode: "447" }),
      line({ itemName: "Үзэг", quantity: 2, lineTotal: 2_200 }),
    ],
    total: 32_200,
    payments: [{ kind: "cash", methodName: "Бэлэн", ebarimtCode: "CASH", baseAmount: 32_200, reference: null }],
  });
  const request = buildEbarimtReceipt(mixed, settings);
  assert.equal(request.receipts.length, 2);
  const free = request.receipts.find((receipt) => receipt.taxType === "VAT_FREE")!;
  assert.equal(free.items[0].taxProductCode, "447");
  assert.equal(free.totalVat, 0);
  assert.equal(request.totalAmount, 32_200);

  const missingCode = sale({ ...mixed, lines: [{ ...mixed.lines[0], taxProductCode: null }, mixed.lines[1]] });
  assert.throws(() => buildEbarimtReceipt(missingCode, settings), /\[EBARIMT_TAX_PRODUCT_CODE\]/);
});

test("ангилалгүй бараа → [EBARIMT_UNMAPPED_ITEM]; кодгүй төлбөр → [EBARIMT_UNMAPPED_PAYMENT]", () => {
  assert.throws(
    () => buildEbarimtReceipt(sale({ lines: [line({ itemName: "X", quantity: 1, lineTotal: 1_100, classificationCode: null })], total: 1_100 }), settings),
    /\[EBARIMT_UNMAPPED_ITEM\].*"X"/
  );
  assert.throws(
    () => buildEbarimtReceipt(sale({ payments: [{ kind: "ewallet", methodName: "QPay", ebarimtCode: null, baseAmount: 1_661_550, reference: null }] }), settings),
    /\[EBARIMT_UNMAPPED_PAYMENT\].*QPay/
  );
});

test("B2B: customerTin өгвөл B2B_RECEIPT; буруу ТТД/иргэний дугаар шидэнэ", () => {
  const request = buildEbarimtReceipt(sale({ customerTin: "12345678901" }), settings);
  assert.equal(request.type, "B2B_RECEIPT");
  assert.equal(request.customerTin, "12345678901");
  assert.throws(() => buildEbarimtReceipt(sale({ customerTin: "12" }), settings), /\[EBARIMT_SETTINGS\]/);
  assert.throws(() => buildEbarimtReceipt(sale({ consumerNo: "123" }), settings), /\[EBARIMT_SETTINGS\]/);
  assert.equal(buildEbarimtReceipt(sale({ consumerNo: "12345678" }), settings).consumerNo, "12345678");
});

test("хэсэгчилсэн буцаалт: үлдсэн мөр л илгээгдэж, төлбөр хувь тэнцүү хуваарилагдана", () => {
  const partial = sale({
    lines: [
      line({ itemName: "Зөөврийн компьютер", quantity: 1, lineTotal: 1_500_000 }),
      // 3-аас 1 буцаагдсан → 2 үлдсэн, дүн 2/3
      line({ itemName: "Хулгана", quantity: 2, lineTotal: 107_700 }),
    ],
  });
  const request = buildEbarimtReceipt(partial, settings);
  assert.equal(request.totalAmount, 1_607_700);
  const paid = request.payments.reduce((sum, payment) => sum + payment.paidAmount, 0);
  assert.equal(Math.round(paid * 100) / 100, 1_607_700);
  assert.equal(request.payments.length, 2);
  // Бүгд буцаагдсан → илгээх мөргүй
  assert.throws(() => buildEbarimtReceipt(sale({ lines: [line({ itemName: "A", quantity: 0, lineTotal: 0 })] }), settings), /\[EBARIMT_TOTAL_MISMATCH\]/);
});

test("allocatePayments: бөөрөнхийллийн зөрүүг хамгийн том төлбөр шингээж, ижил код нэгтгэгдэнэ", () => {
  const payments = allocatePayments(
    [
      { kind: "cash", methodName: "Бэлэн", ebarimtCode: "CASH", baseAmount: 100, reference: null },
      { kind: "cash", methodName: "Бэлэн", ebarimtCode: "CASH", baseAmount: 100, reference: null },
      { kind: "card", methodName: "Карт", ebarimtCode: "PAYMENT_CARD", baseAmount: 100, reference: null },
    ],
    100
  );
  assert.equal(payments.reduce((sum, payment) => sum + payment.paidAmount, 0), 100);
  assert.equal(payments.find((payment) => payment.code === "CASH")?.paidAmount, 66.67);
  assert.equal(payments.find((payment) => payment.code === "PAYMENT_CARD")?.paidAmount, 33.33);
});

test("receiptResponseOutcome: ДДТД ирвэл амжилт, үгүй бол мессеж", () => {
  assert.deepEqual(receiptResponseOutcome({ id: "0000123", status: "SUCCESS" }), { ok: true, id: "0000123" });
  const failed = receiptResponseOutcome({ status: "ERROR", message: "Мерчант олдсонгүй" });
  assert.equal(failed.ok, false);
  assert.match(failed.ok ? "" : failed.message, /Мерчант/);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  allocatePayments,
  billIdSuffixOf,
  buildEbarimtReceipt,
  ebarimtSettingsProblems,
  initialSaleEbarimtStatus,
  receiptResponseOutcome,
  receiptTypeOf,
  stripReceiptSecrets,
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
  assert.equal(request.totalVAT, 151_050);
  assert.equal(request.receipts[0].items[1].unitPrice, 53_850);
  assert.equal(request.receipts[0].items[1].qty, 3);
  const paid = request.payments.reduce((sum, payment) => sum + payment.paidAmount, 0);
  assert.equal(paid, 1_661_550);
  assert.equal(request.payments.find((payment) => payment.code === "PAYMENT_CARD")?.exchangeCode, "SLIP-42");
  assert.equal(request.consumerNo, undefined);
});

test("НӨАТ төлөгч бус: NOT_VAT, totalVAT 0, taxProductCode шаардахгүй", () => {
  const request = buildEbarimtReceipt(
    sale({ isVatPayer: false, lines: [line({ itemName: "A", quantity: 2, lineTotal: 20_000, vatMode: "exempt", vatAmount: 0 })], total: 20_000, payments: [{ kind: "cash", methodName: "Бэлэн", ebarimtCode: "CASH", baseAmount: 20_000, reference: null }] }),
    settings
  );
  assert.equal(request.receipts[0].taxType, "NOT_VAT");
  assert.equal(request.totalVAT, 0);
  assert.equal(request.receipts[0].items[0].totalVAT, 0);
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
  assert.equal(free.totalVAT, 0);
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

test("зээлээр (credit) → B2C/B2B_INVOICE, зээлийн хэсэг PAY статус, бусад нь PAID", () => {
  const credit = { kind: "credit" as const, methodName: "Зээлээр", ebarimtCode: "INVOICE", baseAmount: 661_550, reference: null };
  const cash = { kind: "cash" as const, methodName: "Бэлэн", ebarimtCode: "CASH", baseAmount: 1_000_000, reference: null };
  const mixed = buildEbarimtReceipt(sale({ payments: [cash, credit] }), settings);
  assert.equal(mixed.type, "B2C_INVOICE");
  assert.deepEqual(
    mixed.payments.map((payment) => [payment.code, payment.status, payment.paidAmount]),
    [["CASH", "PAID", 1_000_000], ["INVOICE", "PAY", 661_550]]
  );
  const b2b = buildEbarimtReceipt(sale({ customerTin: "12345678901", payments: [{ ...credit, baseAmount: 1_661_550 }] }), settings);
  assert.equal(b2b.type, "B2B_INVOICE");
  assert.deepEqual(b2b.payments.map((payment) => payment.status), ["PAY"]);
  // Бүрэн төлөгдсөн → RECEIPT хэвээр; 0 дүнтэй зээлийн мөр төрлийг өөрчлөхгүй
  assert.equal(receiptTypeOf([cash, { ...credit, baseAmount: 0 }], null), "B2C_RECEIPT");
  assert.equal(receiptTypeOf([cash], "12345678901"), "B2B_RECEIPT");
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

test("хэсэгчилсэн буцаалтын засвар: inactiveId = сүүлийн ДДТД (DELETE + шинэ БИШ)", () => {
  const request = buildEbarimtReceipt(
    sale({ lines: [line({ itemName: "А", quantity: 1, lineTotal: 1100 })] }),
    settings,
    { inactiveId: "  123456789012345678901234567890123 " }
  );
  assert.equal(request.inactiveId, "123456789012345678901234567890123");
  // Энгийн баримтад талбар огт байхгүй (PosAPI-д хоосон утга явуулахгүй).
  const plain = buildEbarimtReceipt(sale({ lines: [line({ itemName: "А", quantity: 1, lineTotal: 1100 })] }), settings);
  assert.equal("inactiveId" in plain, false);
  assert.equal(buildEbarimtReceipt(sale({ lines: [line({ itemName: "А", quantity: 1, lineTotal: 1100 })] }), settings, { inactiveId: "  " }).inactiveId, undefined);
});

test("wire JSON: түлхүүр албан спекийнх — totalVAT (root/receipts/items), billIdSuffix заавал, camelCase totalVat ХЭЗЭЭ Ч үгүй", () => {
  const request = buildEbarimtReceipt(sale(), settings);
  const wire = JSON.stringify(request);
  assert.equal(wire.includes('"totalVat"'), false);
  assert.equal((wire.match(/"totalVAT":/g) ?? []).length, 1 + request.receipts.length + request.receipts[0].items.length);
  assert.equal(request.receipts[0].totalVAT, 151_050);
  assert.equal(request.receipts[0].items[0].totalVAT, 136_363.64);
  // billIdSuffix root түвшинд, зөвхөн цифр
  assert.equal(request.billIdSuffix, "090001");
  assert.match(wire, /"billIdSuffix":"090001"/);
});

test("billIdSuffixOf: өдөртөө давтагдашгүй, дахин илгээлтэд тогтвортой, засвар/буцаалт бүрд өөр", () => {
  // Нэг submission-ийн бүх оролдлогод ИЖИЛ (PosAPI давхардлыг үүгээр таньдаг — P0-3)
  assert.equal(billIdSuffixOf("POS-2609-0001"), billIdSuffixOf("POS-2609-0001"));
  assert.equal(billIdSuffixOf("POS-2609-0001", 0), "090001");
  // Ижил өдрийн өөр борлуулалт → өөр; сарын хил (9-р сарын хоцорсон + 10-р сарын шинэ) → өөр
  const sameDay = ["POS-2609-0001", "POS-2609-0002", "POS-2609-1234", "POS-2610-0001", "POS-2610-0002"].map((no) => billIdSuffixOf(no));
  assert.equal(new Set(sameDay).size, sameDay.length);
  // inactiveId засвар (edit ≥ 1) → эх баримтаас ӨӨР, засвар бүр өөр хоорондоо ч өөр
  assert.equal(billIdSuffixOf("POS-2609-0001", 1), "09000101");
  assert.equal(billIdSuffixOf("POS-2609-0001", 2), "09000102");
  assert.notEqual(billIdSuffixOf("POS-2609-0001", 1), billIdSuffixOf("POS-2609-0001"));
  // Засварын suffix өөр борлуулалтын эх suffix-тэй давхцахгүй (урт өөр)
  assert.notEqual(billIdSuffixOf("POS-2609-0001", 1), billIdSuffixOf("POS-2609-0101"));
  // RET- буцаалтын баримт (өөрөө илгээгдэхгүй ч) эх POS-той хэзээ ч давхцахгүй
  assert.equal(billIdSuffixOf("RET-2609-0001"), "9090001");
  assert.notEqual(billIdSuffixOf("RET-2609-0001"), billIdSuffixOf("POS-2609-0001"));
  // Зөвхөн цифр
  for (const value of [...sameDay, billIdSuffixOf("RET-2609-0007", 3)]) assert.match(value, /^\d+$/);
  // Танигдахгүй хэлбэр → бүх цифр (POS биш угтварт "9"); цифргүй → [EBARIMT_BILL_ID]; засварын дугаар мужаас гарвал шидэнэ
  assert.equal(billIdSuffixOf("  A/77-12 "), "97712");
  assert.equal(billIdSuffixOf("77-12"), "7712");
  assert.throws(() => billIdSuffixOf("POS-ABC"), /\[EBARIMT_BILL_ID\]/);
  assert.throws(() => billIdSuffixOf("POS-2609-0001", 100), /\[EBARIMT_BILL_ID\]/);
  assert.throws(() => billIdSuffixOf("POS-2609-0001", -1), /\[EBARIMT_BILL_ID\]/);
});

test("buildEbarimtReceipt: billIdSuffix — энгийн баримт edit 0, inactiveId засварт өгөөгүй бол 1, ил edit давамгайлна", () => {
  const one = sale({ lines: [line({ itemName: "А", quantity: 1, lineTotal: 1100 })] });
  const plain = buildEbarimtReceipt(one, settings);
  const edited = buildEbarimtReceipt(one, settings, { inactiveId: "1".repeat(33) });
  const explicit = buildEbarimtReceipt(one, settings, { inactiveId: "1".repeat(33), edit: 3 });
  assert.equal(plain.billIdSuffix, "090001");
  assert.equal(edited.billIdSuffix, "09000101");
  assert.equal(explicit.billIdSuffix, "09000103");
  // Дахин илгээлт (edit 0-тэй хоёр дахь send) — ижил утга буцна
  assert.equal(buildEbarimtReceipt(one, settings).billIdSuffix, plain.billIdSuffix);
  // Хоосон inactiveId = засвар БИШ → edit 0
  assert.equal(buildEbarimtReceipt(one, settings, { inactiveId: "  " }).billIdSuffix, "090001");
});

test("stripReceiptSecrets: сугалаа ба QR хадгалагдахгүй — дэд баримтаас ч; эх объект хөндөгдөхгүй", () => {
  const raw = {
    id: "1".repeat(33),
    status: "SUCCESS",
    lottery: "AB 12345678",
    qrData: "9999",
    date: "2026-09-20 12:00:00",
    receipts: [{ id: "2".repeat(33), lottery: "x", qrData: "y", taxType: "VAT_ABLE" }, null],
  };
  const stripped = stripReceiptSecrets(raw);
  assert.deepEqual(stripped, {
    id: "1".repeat(33),
    status: "SUCCESS",
    date: "2026-09-20 12:00:00",
    receipts: [{ id: "2".repeat(33), taxType: "VAT_ABLE" }, null],
  });
  assert.equal(raw.lottery, "AB 12345678", "эх хөндөгдөөгүй");
  assert.equal(JSON.stringify(stripped).includes("qrData"), false);
});

test("initialSaleEbarimtStatus — кассчины «илгээхгүй» сонголт, гар ДДТД, унтраалттай", () => {
  const base = { enabled: true, isVatPayer: true, manualId: null, skip: false };
  assert.deepEqual(initialSaleEbarimtStatus(base), { status: "pending", autoSend: true });
  assert.deepEqual(initialSaleEbarimtStatus({ ...base, skip: true }), { status: "skipped", autoSend: false });
  // Гар ДДТД бүхнээс давамгайлна — skip байсан ч manual.
  assert.deepEqual(initialSaleEbarimtStatus({ ...base, skip: true, manualId: "1234567890" }), { status: "manual", autoSend: false });
  // eBarimt унтраалттай / НӨАТ төлөгч бус → skip нөлөөгүй, null.
  assert.deepEqual(initialSaleEbarimtStatus({ ...base, enabled: false, skip: true }), { status: null, autoSend: false });
  assert.deepEqual(initialSaleEbarimtStatus({ ...base, isVatPayer: false }), { status: null, autoSend: false });
});

test("баркодын төрөл: барааны картаас, танигдахгүй бол UNDEFINED", async () => {
  const { barcodeTypeOf } = await import("../lib/ebarimt/receipt");
  assert.equal(barcodeTypeOf("gs1"), "GS1");
  assert.equal(barcodeTypeOf("ISBN"), "ISBN");
  assert.equal(barcodeTypeOf(null), "UNDEFINED");
  assert.equal(barcodeTypeOf("EAN13"), "UNDEFINED");
});

test("P2-1/P2-2: ТТД 12–14 орон (хувь хүн) ба 5 оронтой татварын код зөвшөөрөгдөнө", () => {
  assert.equal(buildEbarimtReceipt(sale({ customerTin: "123456789012" }), settings).customerTin, "123456789012");
  assert.equal(buildEbarimtReceipt(sale({ customerTin: "1234567890123" }), settings).type, "B2B_RECEIPT");
  assert.throws(() => buildEbarimtReceipt(sale({ customerTin: "1234567890" }), settings), /\[EBARIMT_SETTINGS\]/);
  assert.throws(() => buildEbarimtReceipt(sale({ customerTin: "123456789012345" }), settings), /\[EBARIMT_SETTINGS\]/);
  const free = buildEbarimtReceipt(
    sale({ lines: [line({ itemName: "Трактор", quantity: 1, lineTotal: 30_000, vatMode: "exempt", vatAmount: 0, taxProductCode: "43401" })], total: 30_000, payments: [{ kind: "cash", methodName: "Бэлэн", ebarimtCode: "CASH", baseAmount: 30_000, reference: null }] }),
    settings
  );
  assert.equal(free.receipts[0].items[0].taxProductCode, "43401");
});

test("НХАТ: totalCityTax мөр → дэд баримт → root нийлбэр; НХАТ-гүй мөрөнд 0", () => {
  const request = buildEbarimtReceipt(
    sale({
      total: 14_500,
      lines: [
        line({ itemName: "Пиво", quantity: 1, lineTotal: 11_200, vatAmount: 1_000, cityTaxAmount: 200 }),
        line({ itemName: "Талх", quantity: 1, lineTotal: 3_300, vatAmount: 300 }),
      ],
      payments: [{ kind: "cash", methodName: "Бэлэн", ebarimtCode: "CASH", baseAmount: 14_500, reference: null }],
    }),
    settings
  );
  const [beer, bread] = request.receipts[0].items;
  assert.equal(beer.totalCityTax, 200);
  assert.equal(bread.totalCityTax, 0);
  assert.equal(request.receipts[0].totalCityTax, 200);
  assert.equal(request.totalCityTax, 200);
  assert.equal(request.totalVAT, 1_300);
  assert.equal(request.totalAmount, 14_500);
});

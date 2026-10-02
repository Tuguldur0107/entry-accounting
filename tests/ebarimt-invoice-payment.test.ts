// Нэхэмжлэхийн ТӨЛӨЛТ → `invoiceId`-тай төлбөрийн баримт (lib/ebarimt/invoice-payment.ts) — ЦЭВЭР.
// Албан спек 3.0.1 §5 «Нэхэмжлэхийн төлбөр», docs/pos/05 Шат 3.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInvoicePaymentReceipt,
  invoicePaymentBillIdSuffix,
  invoicePaymentCodeOf,
} from "../lib/ebarimt/invoice-payment";
import { parsePosApiBankAccounts } from "../lib/ebarimt/posapi-info";
import type { EbarimtReceiptRequest } from "../lib/ebarimt/types";

const INVOICE_ID = "037900846788002097600000000000017";

/** ТЕГ-д очсон B2B нэхэмжлэх: үйлчилгээ 1 100 000 (НӨАТ 100 000) + НӨАТ-гүй ном 1 000 (2 ш). */
const invoice: EbarimtReceiptRequest = {
  totalAmount: 1_101_000,
  totalVAT: 100_000,
  totalCityTax: 0,
  billIdSuffix: "81234567",
  branchNo: "001",
  districtCode: "2301",
  merchantTin: "37900846788",
  posNo: "10001",
  type: "B2B_INVOICE",
  customerTin: "61200064714",
  receipts: [
    {
      taxType: "VAT_ABLE",
      merchantTin: "37900846788",
      totalAmount: 1_100_000,
      totalVAT: 100_000,
      totalCityTax: 0,
      bankAccountNo: "5000123456",
      iBan: "MN120005005000123456",
      items: [
        { name: "Зөвлөх үйлчилгээ", classificationCode: "8311100", measureUnit: "ш", qty: 1, unitPrice: 733_333.33, totalVAT: 66_666.67, totalCityTax: 0, totalAmount: 733_333.33 },
        { name: "Сургалт", classificationCode: "8549100", measureUnit: "ш", qty: 1, unitPrice: 366_666.67, totalVAT: 33_333.33, totalCityTax: 0, totalAmount: 366_666.67 },
      ],
    },
    {
      taxType: "VAT_FREE",
      merchantTin: "37900846788",
      totalAmount: 1_000,
      totalVAT: 0,
      totalCityTax: 0,
      bankAccountNo: "5000123456",
      items: [{ name: "Ном", classificationCode: "4761100", taxProductCode: "305", measureUnit: "ш", qty: 2, unitPrice: 500, totalVAT: 0, totalCityTax: 0, totalAmount: 1_000 }],
    },
  ],
  payments: [{ code: "BANK_TRANSFER", status: "PAID", paidAmount: 1_101_000 }],
};

const base = { invoiceRequest: invoice, invoiceId: INVOICE_ID, paymentCode: "BANK_TRANSFER" as const, billIdSuffix: "71234567" };

test("бүтэн төлөлт: нэхэмжлэхийн мөрүүд ЯГ ижил, B2B_RECEIPT + invoiceId, PAID, данс БАЙХГҮЙ", () => {
  const request = buildInvoicePaymentReceipt({ ...base, amount: 1_101_000 });
  assert.equal(request.type, "B2B_RECEIPT");
  assert.equal(request.invoiceId, INVOICE_ID);
  assert.equal(request.customerTin, "61200064714");
  assert.equal(request.inactiveId, undefined);
  assert.equal(request.totalAmount, 1_101_000);
  assert.equal(request.totalVAT, 100_000);
  assert.deepEqual(request.payments, [{ code: "BANK_TRANSFER", status: "PAID", paidAmount: 1_101_000 }]);
  assert.deepEqual(
    request.receipts.map((r) => r.items.map((i) => [i.totalAmount, i.totalVAT, i.qty, i.unitPrice])),
    invoice.receipts.map((r) => r.items.map((i) => [i.totalAmount, i.totalVAT, i.qty, i.unitPrice]))
  );
  assert.ok(request.receipts.every((r) => !("bankAccountNo" in r) && !("iBan" in r)), "төлбөрийн баримтад нэхэмжлэхийн данс орохгүй");
  assert.equal(request.billIdSuffix, "71234567");
});

test("хэсэгчилсэн төлөлт: хувиар, Σ = төлсөн дүн яг, НӨАТ харьцаагаар, сүүлийн мөр бөөрөнхийллийг шингээнэ", () => {
  const request = buildInvoicePaymentReceipt({ ...base, amount: 333_333.33 });
  const items = request.receipts.flatMap((r) => r.items);
  const sum = (field: "totalAmount" | "totalVAT") => Math.round(items.reduce((acc, item) => acc + item[field], 0) * 100) / 100;
  assert.equal(sum("totalAmount"), 333_333.33);
  assert.equal(request.totalAmount, 333_333.33);
  assert.equal(request.payments[0].paidAmount, 333_333.33);
  assert.equal(sum("totalVAT"), request.totalVAT);
  assert.ok(Math.abs(request.totalVAT - 100_000 * (333_333.33 / 1_101_000)) < 0.02);
  // Мөр бүрийн дүн = эх × хувь (±0.01), нэгж үнэ = дүн / тоо.
  for (const item of items) assert.equal(item.unitPrice, Math.round((item.totalAmount / item.qty) * 100) / 100);
  for (const receipt of request.receipts)
    assert.equal(receipt.totalAmount, Math.round(receipt.items.reduce((acc, item) => acc + item.totalAmount, 0) * 100) / 100);
});

test("B2C нэхэмжлэх → B2C_RECEIPT; эх нь RECEIPT бол / ДДТД-гүй / илүү / 0 төлөлт → ил алдаа", () => {
  const b2c = buildInvoicePaymentReceipt({
    ...base,
    invoiceRequest: { ...invoice, type: "B2C_INVOICE", customerTin: undefined, consumerNo: "10038071" },
    amount: 1_000,
  });
  assert.equal(b2c.type, "B2C_RECEIPT");
  assert.equal(b2c.consumerNo, "10038071");
  assert.throws(() => buildInvoicePaymentReceipt({ ...base, invoiceRequest: { ...invoice, type: "B2B_RECEIPT" }, amount: 10 }), /НЭХЭМЖЛЭХэд/);
  assert.throws(() => buildInvoicePaymentReceipt({ ...base, invoiceId: " ", amount: 10 }), /ДДТД/);
  assert.throws(() => buildInvoicePaymentReceipt({ ...base, amount: 1_101_000.5 }), /их/);
  assert.throws(() => buildInvoicePaymentReceipt({ ...base, amount: 0 }), /эерэг/);
});

test("төлбөрийн код эх сурвалжаас: касс → CASH, банк → BANK_TRANSFER, QPay линк → BANK_TRANSFER_QPAY", () => {
  assert.equal(invoicePaymentCodeOf({ accountType: "cash", externalRef: null }), "CASH");
  assert.equal(invoicePaymentCodeOf({ accountType: "bank", externalRef: "STMT-123" }), "BANK_TRANSFER");
  assert.equal(invoicePaymentCodeOf({ accountType: null, externalRef: null }), "BANK_TRANSFER");
  assert.equal(invoicePaymentCodeOf({ accountType: "bank", externalRef: "qpay-arap:abc" }), "BANK_TRANSFER_QPAY");
});

test("invoicePaymentBillIdSuffix: тогтмол «7» + 7 орон, settlement бүрд өөр", () => {
  const a = invoicePaymentBillIdSuffix("3f2a9c10-1111-4222-8333-444455556666");
  assert.match(a, /^7\d{7}$/);
  assert.equal(invoicePaymentBillIdSuffix("3f2a9c10-1111-4222-8333-444455556666"), a);
  assert.notEqual(invoicePaymentBillIdSuffix("00000002-1111-4222-8333-444455556666"), a);
  assert.throws(() => invoicePaymentBillIdSuffix("x"), /EBARIMT_BILL_ID/);
});

test("parsePosApiBankAccounts: албан хэлбэр, давхардал/хоосон дугаар алгасна, массив биш → []", () => {
  assert.deepEqual(
    parsePosApiBankAccounts([
      { id: 1, tin: "37900846788", bankAccountNo: "5000123456", bankAccountName: "Тест ХХК", bankId: 5, bankName: "Хаан банк", iBan: "MN120005005000123456" },
      { id: 2, bankAccountNo: "5000123456" },
      { id: 3, bankAccountNo: "" },
      { id: 4, bankAccountNo: 499012345, bankName: "Голомт" },
    ]),
    [
      { bankAccountNo: "5000123456", bankAccountName: "Тест ХХК", bankName: "Хаан банк", iBan: "MN120005005000123456" },
      { bankAccountNo: "499012345", bankAccountName: null, bankName: "Голомт", iBan: null },
    ]
  );
  assert.deepEqual(parsePosApiBankAccounts({ message: "error" }), []);
});

test("§8 F-6: төлөлтийн баримтын дэд баримт бүрд тохиргооны GPS байршил", () => {
  const location = { locationType: "GPS" as const, latitude: "47.918873", longitude: "106.917701" };
  const request = buildInvoicePaymentReceipt({ ...base, amount: 1_101_000, location });
  assert.ok(request.receipts.length > 0);
  for (const receipt of request.receipts) assert.deepEqual(receipt.data, { location: [location] });
  const plain = buildInvoicePaymentReceipt({ ...base, amount: 1_101_000 });
  assert.ok(plain.receipts.every((receipt) => receipt.data === undefined));
});

test("§8 F-10: B2B нэхэмжлэхийн өмнөх сарын төлөлт 1–7-нд reportMonth-тэй", () => {
  const request = buildInvoicePaymentReceipt({ ...base, amount: 1_101_000, backdate: { documentDate: "2026-09-29", todayUb: "2026-10-04" } });
  assert.equal(request.type, "B2B_RECEIPT");
  assert.equal(request.reportMonth, "2026-09-29");
  const late = buildInvoicePaymentReceipt({ ...base, amount: 1_101_000, backdate: { documentDate: "2026-09-29", todayUb: "2026-10-09" } });
  assert.equal(late.reportMonth, undefined);
});

test("ОАТ: нэхэмжлэхээр очсон stockQR төлөлтийн баримтад ДАХИН явахгүй", () => {
  const withStamp = {
    ...invoice,
    receipts: invoice.receipts.map((receipt, index) =>
      index === 1 ? { ...receipt, items: receipt.items.map((item) => ({ ...item, data: { stockQR: ["A17F974BE497F14CE0536F50A8C057A7"] } })) } : receipt
    ),
  };
  const request = buildInvoicePaymentReceipt({ ...base, invoiceRequest: withStamp, amount: 1_101_000 });
  assert.ok(request.receipts.flatMap((receipt) => receipt.items).every((item) => item.data === undefined));
});

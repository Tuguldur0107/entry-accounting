import test from "node:test";
import assert from "node:assert/strict";

import {
  arapBillIdSuffix,
  arapInvoiceToEbarimtInput,
  type ArapEbarimtConfig,
  type ArapEbarimtDocument,
  type ArapEbarimtLine,
} from "../lib/ebarimt/arap-receipt";
import { buildEbarimtReceipt } from "../lib/ebarimt/receipt";
import type { EbarimtSettingsInput } from "../lib/ebarimt/types";

const REVENUE = "01.00.51100000.000.000.000.000.000.000.000";
const REVENUE2 = "01.00.51200000.000.000.000.000.000.000.000";
const VAT = "01.00.31410000.000.000.000.000.000.000.000";

const config: ArapEbarimtConfig = {
  isVatPayer: true,
  outputVatAccount: "31410000",
  paymentCode: "INVOICE",
  defaultClassificationCode: "8311100",
  accountClassificationCodes: { "51200000": "6810000" },
};

const settings: EbarimtSettingsInput = {
  enabled: true,
  merchantTin: "37900846788",
  branchNo: "001",
  districtCode: "2301",
  posNo: "10001",
  posApiUrl: "http://localhost:7080",
  mode: "server",
};

function line(partial: Partial<ArapEbarimtLine>): ArapEbarimtLine {
  return { accountNumber: REVENUE, description: "Зөвлөх үйлчилгээ", amount: 1_000_000, quantity: null, item: null, ...partial };
}

function doc(partial: Partial<ArapEbarimtDocument> = {}): ArapEbarimtDocument {
  return {
    id: "3f2a9c10-1111-4222-8333-444455556666",
    documentNo: "AR-20260927-A1B2C3",
    documentType: "ar_invoice",
    currency: "MNT",
    description: "Есдүгээр сарын үйлчилгээ",
    lines: [line({}), line({ accountNumber: VAT, description: "НӨАТ", amount: 100_000 })],
    customer: { name: "Тест ХХК", baseKind: "organization", tin: "61200064714" },
    ...partial,
  };
}

test("B2B нэхэмжлэх: НӨАТ-ын мөр standard мөрт шингэж, төлбөр INVOICE/PAY, төрөл B2B_INVOICE", () => {
  const input = arapInvoiceToEbarimtInput(doc(), config);
  assert.equal(input.customerTin, "61200064714");
  assert.equal(input.total, 1_100_000);
  assert.deepEqual(input.lines.map((l) => [l.lineTotal, l.vatAmount, l.classificationCode, l.quantity]), [[1_100_000, 100_000, "8311100", 1]]);
  const request = buildEbarimtReceipt(input, settings, { billIdSuffix: arapBillIdSuffix(doc().id) });
  assert.equal(request.type, "B2B_INVOICE");
  assert.equal(request.totalVAT, 100_000);
  assert.deepEqual(request.payments.map((p) => [p.code, p.status, p.paidAmount]), [["INVOICE", "PAY", 1_100_000]]);
  assert.equal(request.billIdSuffix, arapBillIdSuffix(doc().id));
});

test("хувь хүн → B2C_INVOICE (ТТД-гүй); байгууллагын ТТД-гүй бол ил алдаа", () => {
  const b2c = arapInvoiceToEbarimtInput(doc({ customer: { name: "Бат", baseKind: "individual", tin: null } }), config);
  assert.equal(b2c.customerTin, null);
  assert.equal(buildEbarimtReceipt(b2c, settings, { billIdSuffix: "80000001" }).type, "B2C_INVOICE");
  assert.throws(() => arapInvoiceToEbarimtInput(doc({ customer: { name: "Тест ХХК", baseKind: "organization", tin: null } }), config), /ТТД/);
});

test("НӨАТ-ыг олон мөрт дүнгийн хувиар, үлдэгдэл сүүлийнх рүү; ангилал: бараа → данс → анхдагч", () => {
  const input = arapInvoiceToEbarimtInput(
    doc({
      lines: [
        line({ amount: 333.33, description: "А" }),
        line({ accountNumber: REVENUE2, amount: 666.67, description: "Б" }),
        line({
          amount: 500,
          quantity: 2,
          item: { name: "Ном", unit: "ш", barcode: null, barcodeType: null, vatMode: "exempt", classificationCode: "4761100", taxProductCode: "305" },
        }),
        line({ accountNumber: VAT, description: "НӨАТ", amount: 100 }),
      ],
    }),
    config
  );
  assert.deepEqual(input.lines.map((l) => l.vatAmount), [33.33, 66.67, 0]);
  assert.deepEqual(input.lines.map((l) => l.classificationCode), ["8311100", "6810000", "4761100"]);
  assert.deepEqual(input.lines.map((l) => l.vatMode), ["standard", "standard", "exempt"]);
  assert.equal(input.lines[2].quantity, 2);
  assert.equal(input.total, 1_600);
  const request = buildEbarimtReceipt(input, settings, { billIdSuffix: "80000001" });
  assert.deepEqual(request.receipts.map((r) => r.taxType).sort(), ["VAT_ABLE", "VAT_FREE"]);
});

test("НӨАТ төлөгч бус: НӨАТ 0, НӨАТ-ын мөр байвал алдаа", () => {
  const nonPayer = { ...config, isVatPayer: false };
  const input = arapInvoiceToEbarimtInput(doc({ lines: [line({})] }), nonPayer);
  assert.equal(input.lines[0].vatAmount, 0);
  assert.equal(input.total, 1_000_000);
  assert.throws(() => arapInvoiceToEbarimtInput(doc(), nonPayer), /НӨАТ төлөгч бус/);
});

test("ЗОХИОХГҮЙ: код, НӨАТ, валют, хасах мөр дутвал ил алдаа", () => {
  assert.throws(() => arapInvoiceToEbarimtInput(doc(), { ...config, paymentCode: " " }), /EBARIMT_UNMAPPED_PAYMENT/);
  assert.throws(() => arapInvoiceToEbarimtInput(doc({ lines: [line({})] }), config), /НӨАТ-ын мөр байхгүй/);
  assert.throws(() => arapInvoiceToEbarimtInput(doc({ currency: "USD" }), config), /валют/);
  assert.throws(() => arapInvoiceToEbarimtInput(doc({ documentType: "ar_credit_note" }), config), /кредит/);
  assert.throws(
    () => arapInvoiceToEbarimtInput(doc({ lines: [line({}), line({ amount: -50_000, description: "Хөнгөлөлт" }), line({ accountNumber: VAT, amount: 95_000 })] }), config),
    /хасах/
  );
  // Ангиллын код хаанаас ч олдохгүй → toItem [EBARIMT_UNMAPPED_ITEM]
  const noCode = arapInvoiceToEbarimtInput(doc(), { ...config, defaultClassificationCode: null });
  assert.throws(() => buildEbarimtReceipt(noCode, settings, { billIdSuffix: "80000001" }), /EBARIMT_UNMAPPED_ITEM/);
});

test("arapBillIdSuffix: тогтмол 8 орон «8…», засварт +2 орон, UUID бүрд өөр", () => {
  const a = arapBillIdSuffix("3f2a9c10-1111-4222-8333-444455556666");
  assert.match(a, /^8\d{7}$/);
  assert.equal(arapBillIdSuffix("3f2a9c10-1111-4222-8333-444455556666"), a);
  assert.equal(arapBillIdSuffix("3f2a9c10-1111-4222-8333-444455556666", 3), `${a}03`);
  assert.notEqual(arapBillIdSuffix("00000001-1111-4222-8333-444455556666"), a);
  assert.throws(() => arapBillIdSuffix("x"), /EBARIMT_BILL_ID/);
});

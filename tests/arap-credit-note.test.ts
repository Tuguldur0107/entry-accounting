// ENT-029 — кредит нэхэмжлэл / дебит нэхэмжлэхийн ЦЭВЭР логик.

import test from "node:test";
import assert from "node:assert/strict";

import {
  arapLedger,
  controlSide,
  creditDocumentTypeFor,
  documentNoPrefix,
  ledgerSign,
  lineMovementType,
  offsetPair,
  settlementCashType,
} from "../lib/arap/document-kind";
import {
  creditApplicationAmount,
  creditLineAccount,
  creditOverrunError,
  planCreditNote,
  replaceMainAccount,
  sumCreditedByLine,
  type CreditSourceLine,
} from "../lib/arap/credit-note";

const code = (main: string) => `000.000000.${main}.000.000.000.000.00.GL.00`;

test("баримтын төрөл: дэвтэр, хяналтын тал, мөнгөний чиглэл, хөдөлгөөн", () => {
  assert.equal(arapLedger("ar_credit_note"), "ar");
  assert.equal(arapLedger("ap_debit_note"), "ap");
  assert.equal(controlSide("ar_invoice"), "debit");
  assert.equal(controlSide("ar_credit_note"), "credit");
  assert.equal(controlSide("ap_bill"), "credit");
  assert.equal(controlSide("ap_debit_note"), "debit");
  // Кредит нэхэмжлэлийн илүүдлийг буцаан олгох = зарлага; дебит → орлого
  assert.equal(settlementCashType("ar_credit_note"), "payment");
  assert.equal(settlementCashType("ap_debit_note"), "receipt");
  assert.equal(lineMovementType("ar_credit_note"), "return_in");
  assert.equal(lineMovementType("ap_debit_note"), "return_out");
  assert.equal(lineMovementType("ar_invoice"), "issue");
  assert.equal(lineMovementType("ap_bill"), "receipt");
  assert.equal(ledgerSign("ar_credit_note"), -1);
  assert.equal(ledgerSign("ap_bill"), 1);
  assert.equal(documentNoPrefix("ar_credit_note"), "CN");
  assert.equal(documentNoPrefix("ap_debit_note"), "DN");
  assert.equal(creditDocumentTypeFor("ar_invoice"), "ar_credit_note");
  assert.equal(creditDocumentTypeFor("ar_credit_note"), null);
});

test("суутгалын хос: эсрэг талын хяналтын данстай баримтууд л", () => {
  const inv = { documentType: "ar_invoice" };
  const cn = { documentType: "ar_credit_note" };
  const bill = { documentType: "ap_bill" };
  assert.deepEqual(offsetPair(cn, inv), { debitSide: inv, creditSide: cn });
  assert.deepEqual(offsetPair(inv, bill), { debitSide: inv, creditSide: bill });
  assert.equal(offsetPair(inv, { documentType: "ap_debit_note" }), null);
  assert.equal(offsetPair(cn, bill), null);
});

test("D-CN-1: АР-ын орлогын мөр contra 51900001 руу, сегмент хэвээр; бусад эх данс", () => {
  const src = "101.000000.51100000.000.000.000.000.00.GL.00";
  assert.equal(
    creditLineAccount("ar_invoice", src),
    "101.000000.51900001.000.000.000.000.00.GL.00"
  );
  assert.equal(creditLineAccount("ar_invoice", code("13110000")), code("13110000"));
  assert.equal(creditLineAccount("ap_bill", code("14000099")), code("14000099"));
  assert.equal(replaceMainAccount("51100000", "51900001"), "51900001");
});

const vatAcc = code("31410000");
const sourceLines: CreditSourceLine[] = [
  { id: "a", accountNumber: code("51100000"), description: "Бараа А", amount: 1000, quantity: 10, itemId: "item-a", warehouseId: "wh", unitPrice: 100 },
  { id: "b", accountNumber: code("51100000"), description: "Үйлчилгээ", amount: 500, quantity: null, itemId: null, warehouseId: null, unitPrice: null },
  { id: "v", accountNumber: vatAcc, description: "НӨАТ 10%", amount: 150, quantity: null, itemId: null, warehouseId: null, unitPrice: null },
];
const isVatLine = (acc: string) => acc === vatAcc;

test("бүтэн буцаалт: бүх мөр + НӨАТ бүтнээрээ", () => {
  const plan = planCreditNote({
    sourceType: "ar_invoice",
    sourceStatus: "posted",
    sourceLines,
    credited: new Map(),
    isVatLine,
  });
  assert.equal(plan.total, 1650);
  const vat = plan.lines.find((l) => l.isVat)!;
  assert.equal(vat.amount, 150);
  const a = plan.lines.find((l) => l.sourceLineId === "a")!;
  assert.equal(a.quantity, 10);
  assert.equal(a.itemId, "item-a");
  assert.equal(a.accountNumber, code("51900001"));
});

test("хэсэгчилсэн: 3 ширхэг → 300 + НӨАТ хувиар 30", () => {
  const plan = planCreditNote({
    sourceType: "ar_invoice",
    sourceStatus: "partially_paid",
    sourceLines,
    credited: new Map(),
    request: [{ sourceLineId: "a", quantity: 3 }],
    isVatLine,
  });
  assert.deepEqual(
    plan.lines.map((l) => [l.sourceLineId, l.amount, l.quantity]),
    [["a", 300, 3], ["v", 30, null]]
  );
  assert.equal(plan.total, 330);
});

test("өмнөх буцаалтын үлдэгдлээс хэтрэхгүй; сүүлчийнх нь НӨАТ-ын үлдэгдлийг бүтэн авна", () => {
  const credited = sumCreditedByLine([
    { sourceLineId: "a", amount: 700, quantity: 7 },
    { sourceLineId: "b", amount: 500, quantity: null },
    { sourceLineId: "v", amount: 119.99, quantity: null },
  ]);
  assert.throws(
    () =>
      planCreditNote({
        sourceType: "ar_invoice",
        sourceStatus: "paid",
        sourceLines,
        credited,
        request: [{ sourceLineId: "a", quantity: 4 }],
        isVatLine,
      }),
    /CREDIT_QTY_EXCEEDS/
  );
  const plan = planCreditNote({
    sourceType: "ar_invoice",
    sourceStatus: "paid",
    sourceLines,
    credited,
    isVatLine,
  });
  assert.deepEqual(
    plan.lines.map((l) => [l.sourceLineId, l.amount]),
    [["a", 300], ["v", 30.01]]
  );
});

test("үнийн хөнгөлөлт: тоо 0 + дүн → бараагүй мөр (хөдөлгөөн үүсэхгүй)", () => {
  const plan = planCreditNote({
    sourceType: "ar_invoice",
    sourceStatus: "posted",
    sourceLines,
    credited: new Map(),
    request: [{ sourceLineId: "a", quantity: 0, amount: 100 }],
    isVatLine,
  });
  const a = plan.lines[0];
  assert.equal(a.itemId, null);
  assert.equal(a.quantity, null);
  assert.equal(a.amount, 100);
});

test("гажиг оролт: НӨАТ мөр сонгох, давхар, ноорог эх, хэтэрсэн дүн, бүрэн буцсан", () => {
  const base = { sourceType: "ar_invoice", sourceStatus: "posted", sourceLines, credited: new Map(), isVatLine };
  assert.throws(() => planCreditNote({ ...base, request: [{ sourceLineId: "v" }] }), /CREDIT_VAT_AUTO/);
  assert.throws(
    () => planCreditNote({ ...base, request: [{ sourceLineId: "b" }, { sourceLineId: "b" }] }),
    /CREDIT_LINE_DUPLICATE/
  );
  assert.throws(() => planCreditNote({ ...base, sourceStatus: "draft" }), /CREDIT_SOURCE_STATUS/);
  assert.throws(() => planCreditNote({ ...base, sourceType: "ar_credit_note" }), /CREDIT_SOURCE_TYPE/);
  assert.throws(
    () => planCreditNote({ ...base, request: [{ sourceLineId: "b", amount: 600 }] }),
    /CREDIT_AMOUNT_EXCEEDS/
  );
  assert.throws(() => planCreditNote({ ...base, request: [{ sourceLineId: "zzz" }] }), /CREDIT_LINE_NOT_FOUND/);
  const done = sumCreditedByLine(
    sourceLines.map((l) => ({ sourceLineId: l.id, amount: l.amount, quantity: l.quantity }))
  );
  assert.throws(() => planCreditNote({ ...base, credited: done }), /CREDIT_NOTHING_LEFT/);
});

test("АП дебит нэхэмжлэх: эх данс (клиринг) хэвээр, оролтын НӨАТ хувиар", () => {
  const inVat = code("13620000");
  const plan = planCreditNote({
    sourceType: "ap_bill",
    sourceStatus: "posted",
    sourceLines: [
      { id: "x", accountNumber: code("14000099"), description: "Бараа", amount: 2000, quantity: 20, itemId: "i", warehouseId: "w", unitPrice: 100 },
      { id: "t", accountNumber: inVat, description: "НӨАТ", amount: 200, quantity: null, itemId: null, warehouseId: null, unitPrice: null },
    ],
    credited: new Map(),
    request: [{ sourceLineId: "x", quantity: 5 }],
    isVatLine: (acc) => acc === inVat,
  });
  assert.deepEqual(
    plan.lines.map((l) => [l.accountNumber, l.amount]),
    [[code("14000099"), 500], [inVat, 50]]
  );
});

test("D-CN-3: эх нэхэмжлэхэд тооцох дүн = min(кредит, нээлттэй үлдэгдэл)", () => {
  assert.equal(creditApplicationAmount(330, { totalAmount: 1650, paidAmount: 0, status: "posted" }), 330);
  assert.equal(creditApplicationAmount(330, { totalAmount: 1650, paidAmount: 1500, status: "partially_paid" }), 150);
  assert.equal(creditApplicationAmount(330, { totalAmount: 1650, paidAmount: 1650, status: "paid" }), 0);
});

test("батлах мөчийн давхар шалгалт: бусад кредиттэй нийлээд хэтэрвэл зөрчил", () => {
  const others = sumCreditedByLine([{ sourceLineId: "a", amount: 800, quantity: 8 }]);
  assert.equal(
    creditOverrunError(sourceLines, others, [{ sourceLineId: "a", amount: 200, quantity: 2 }]),
    null
  );
  assert.match(
    creditOverrunError(sourceLines, others, [{ sourceLineId: "a", amount: 300, quantity: 3 }])!,
    /CREDIT_AMOUNT_EXCEEDS/
  );
  assert.match(
    creditOverrunError(sourceLines, others, [{ sourceLineId: "a", amount: 150, quantity: 3 }])!,
    /CREDIT_QTY_EXCEEDS/
  );
  assert.match(
    creditOverrunError(sourceLines, new Map(), [{ sourceLineId: null, amount: 1, quantity: null }])!,
    /CREDIT_LINE_NOT_FOUND/
  );
});

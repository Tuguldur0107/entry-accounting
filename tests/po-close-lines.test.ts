// PO хаалтын журналын мөрүүд — ЦЭВЭР тест (DB-гүй).
// docs/procurement §3.3 ⑥ ба §4-ийн тоон жишээгээр (ханшийн гарз 1,240,000).

import test from "node:test";
import assert from "node:assert/strict";

import { buildPoCloseLines } from "../lib/procurement/close-lines";

const ACCOUNTS = {
  invClearing: "14000099",
  apClearing: "31000099",
  fxGain: "51800001",
  fxLoss: "87000003",
};

/** Сегментийн бүтэн кодыг эмуляц — зөвхөн дамжуулалтыг шалгана. */
const buildCode = (main: string) => `000.000000.${main}.CO`;

function build(
  invClearingBalance: number,
  apClearingBalance: number,
  description = "[PO-2026-001] PO хаалт"
) {
  return buildPoCloseLines({
    purchaseOrderId: "po-1",
    invClearingBalance,
    apClearingBalance,
    accounts: ACCOUNTS,
    buildCode,
    description,
  });
}

test("хоёр түр дансыг тэгшитгэж ханшийн гарзыг тусдаа мөрөөр бичнэ", () => {
  // §4: бараа мат. түр данс Cr 229,095,000; өглөгийн түр данс Dr 230,335,000.
  const lines = build(-229_095_000, 230_335_000);
  assert.equal(lines.length, 3);

  assert.deepEqual(lines[0], {
    accountNumber: buildCode("14000099"),
    debit: "229095000",
    credit: "0",
    description: "[PO-2026-001] PO хаалт",
    sortOrder: 0,
    businessObjectType: "purchase_order",
    businessObjectId: "po-1",
  });
  assert.deepEqual(lines[1], {
    accountNumber: buildCode("31000099"),
    debit: "0",
    credit: "230335000",
    description: "[PO-2026-001] PO хаалт",
    sortOrder: 1,
    businessObjectType: "purchase_order",
    businessObjectId: "po-1",
  });
  assert.deepEqual(lines[2], {
    accountNumber: buildCode("87000003"),
    debit: "1240000",
    credit: "0",
    description: "Ханшийн гарз: [PO-2026-001] PO хаалт",
    sortOrder: 2,
    businessObjectType: "purchase_order",
    businessObjectId: "po-1",
  });

  // Журнал тэнцэнэ: ΣDr = ΣCr.
  const debit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.credit), 0);
  assert.equal(debit, credit);
  assert.equal(debit, 230_335_000);
});

test("нэхэмжлэх бага байвал ханшийн ОЛЗ кредитлэгдэнэ", () => {
  const lines = build(-100_000_000, 99_400_000);
  assert.equal(lines.length, 3);
  assert.equal(lines[2].accountNumber, buildCode("51800001"));
  assert.equal(lines[2].debit, "0");
  assert.equal(lines[2].credit, "600000");
  assert.match(lines[2].description, /Ханшийн олз/);
  const debit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.credit), 0);
  assert.equal(debit, credit);
});

test("зөрүүгүй (MNT) захиалгад ханшийн мөр гарахгүй", () => {
  const lines = build(-10_000_000, 10_000_000);
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((line) => line.accountNumber),
    [buildCode("14000099"), buildCode("31000099")]
  );
});

test("1 төгрөгийн бөөрөнхийллийн зөрүү ханшийн мөр үүсгэнэ, 0.005 үүсгэхгүй", () => {
  assert.equal(build(-10_000_000, 10_000_001).length, 3);
  assert.equal(build(-10_000_000, 10_000_000.005).length, 2);
});

test("нэхэмжлэх бичигдээгүй (өглөгийн түр данс хоосон) бол ШИДНЭ", () => {
  // Хуурамч ханшийн ОЛЗ-оос хамгаалах цорын ганц GL-давхаргын хаалт:
  // ноорог нэхэмжлэх журнал бичдэггүй тул apDebit = 0 хэвээр үлддэг.
  assert.throws(() => build(-5_000_000, 0), /нэхэмжлэх батлагдаагүй/);
});

test("хүлээн авалт бичигдээгүй (бараа мат. түр данс хоосон) бол ШИДНЭ", () => {
  assert.throws(() => build(0, 5_000_000), /хүлээн авалт батлагдаагүй/);
});

test("зөрүү нь дүнгийн 25%-иас давбал ханшийн зөрүү гэж бичихгүй", () => {
  // 10 сая vs 4 сая — 60% зөрүү нь ханшийн хэлбэлзэл байх боломжгүй.
  assert.throws(() => build(-10_000_000, 4_000_000), /зөрүү хэт их/);
  // 10% зөрүү нь боломжтой (ханш огнооны хооронд өөрчлөгдсөн).
  assert.equal(build(-10_000_000, 11_000_000).length, 3);
});

test("чиглэл буруу үлдэгдэл (бараа мат. түр данс Dr) бол ШИДНЭ", () => {
  assert.throws(() => build(5_000_000, 5_000_000), /чиглэл буруу/);
});

test("чиглэл буруу үлдэгдэл (өглөгийн түр данс Cr) бол ШИДНЭ", () => {
  assert.throws(() => build(-5_000_000, -5_000_000), /чиглэл буруу/);
});

test("хоёр түр данс 0 бол хаах юм байхгүй тул ШИДНЭ", () => {
  assert.throws(() => build(0, 0), /Хаах үлдэгдэл алга/);
});

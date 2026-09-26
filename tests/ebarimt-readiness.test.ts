import test from "node:test";
import assert from "node:assert/strict";

import {
  READINESS_SAMPLE_LIMIT,
  ebarimtReadiness,
  effectiveClassificationCode,
  type ReadinessItem,
} from "../lib/ebarimt/readiness";

function item(partial: Partial<ReadinessItem> & Pick<ReadinessItem, "name">): ReadinessItem {
  return {
    categoryCode: null,
    ebarimtClassificationCode: "4711000",
    ebarimtTaxProductCode: null,
    vatMode: "standard",
    ...partial,
  };
}

const CASH = { name: "Бэлэн (₮)", ebarimtCode: "CASH" };

test("бүх код бүрэн → бэлэн", () => {
  const result = ebarimtReadiness({
    items: [item({ name: "Кока-Кола" })],
    categories: [],
    paymentMethods: [CASH],
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.problems, []);
  assert.equal(result.items.count, 0);
});

test("барааны код бүлгээсээ ӨВЛӨНӨ (queue.prepare-тай ижил дүрэм)", () => {
  const result = ebarimtReadiness({
    items: [item({ name: "Талх", categoryCode: "BAKERY", ebarimtClassificationCode: null })],
    categories: [{ code: "BAKERY", name: "Талх нарийн боов", ebarimtClassificationCode: "1905900" }],
    paymentMethods: [CASH],
  });
  assert.equal(result.ready, true);
});

test("бүлэг нь ч кодгүй бол бараа дутуу гэж тоологдоно", () => {
  const result = ebarimtReadiness({
    items: [item({ name: "Талх", categoryCode: "BAKERY", ebarimtClassificationCode: null })],
    categories: [{ code: "BAKERY", name: "Талх", ebarimtClassificationCode: null }],
    paymentMethods: [CASH],
  });
  assert.equal(result.ready, false);
  assert.equal(result.items.count, 1);
  assert.deepEqual(result.items.sample, ["Талх"]);
  assert.match(result.problems[0], /ангилалын код/);
});

test("гажиг урттай код хүчингүй (7 орон биш)", () => {
  const result = ebarimtReadiness({
    items: [item({ name: "Сүү", ebarimtClassificationCode: "471100" })],
    categories: [],
    paymentMethods: [CASH],
  });
  assert.equal(result.items.count, 1);
});

test("НӨАТ-гүй / 0% бараанд татварын бүтээгдэхүүний код ЗААВАЛ", () => {
  const result = ebarimtReadiness({
    items: [
      item({ name: "Эм", vatMode: "exempt" }),
      item({ name: "Экспорт", vatMode: "zero", ebarimtTaxProductCode: "101" }),
      item({ name: "Ус", vatMode: "standard" }),
    ],
    categories: [],
    paymentMethods: [CASH],
  });
  assert.equal(result.taxProduct.count, 1);
  assert.deepEqual(result.taxProduct.sample, ["Эм"]);
  assert.equal(result.items.count, 0, "ангилалын код тусдаа тоологдоно");
});

test("НӨАТ төлөгч бус байгууллага: бүх мөр NOT_VAT — татварын бүтээгдэхүүний код шаардахгүй", () => {
  const result = ebarimtReadiness({
    items: [item({ name: "Эм", vatMode: "exempt" }), item({ name: "Экспорт", vatMode: "zero" })],
    categories: [],
    paymentMethods: [CASH],
    isVatPayer: false,
  });
  assert.equal(result.taxProduct.count, 0);
  assert.equal(result.ready, true);
});

test("төлбөрийн хэлбэрийн код дутуу", () => {
  const result = ebarimtReadiness({
    items: [],
    categories: [],
    paymentMethods: [CASH, { name: "Зээлээр", ebarimtCode: null }, { name: "Карт", ebarimtCode: "  " }],
  });
  assert.equal(result.payments.count, 2);
  assert.deepEqual(result.payments.sample, ["Зээлээр", "Карт"]);
  assert.equal(result.ready, false);
});

test("жишээ нэрс хязгаартай, үлдсэн нь тоогоор", () => {
  const items = Array.from({ length: READINESS_SAMPLE_LIMIT + 3 }, (_, index) =>
    item({ name: `Бараа ${index + 1}`, ebarimtClassificationCode: null })
  );
  const result = ebarimtReadiness({ items, categories: [], paymentMethods: [CASH] });
  assert.equal(result.items.count, READINESS_SAMPLE_LIMIT + 3);
  assert.equal(result.items.sample.length, READINESS_SAMPLE_LIMIT);
  assert.match(result.problems[0], /\+3/);
});

test("effectiveClassificationCode — өөрийн код бүлгийнхийг ДАРНА", () => {
  const categories = new Map([["BAKERY", "1905900"]]);
  assert.equal(
    effectiveClassificationCode({ categoryCode: "BAKERY", ebarimtClassificationCode: "2202100" }, categories),
    "2202100"
  );
  assert.equal(
    effectiveClassificationCode({ categoryCode: "BAKERY", ebarimtClassificationCode: "  " }, categories),
    "1905900"
  );
  assert.equal(effectiveClassificationCode({ categoryCode: null, ebarimtClassificationCode: null }, categories), null);
});

test("бараа / хэлбэр огт байхгүй бол бэлэн (шалгах юм алга)", () => {
  const result = ebarimtReadiness({ items: [], categories: [], paymentMethods: [] });
  assert.equal(result.ready, true);
});

test("олон түвшинтэй ангилал: хоосон ангилал ЭЦЭГ рүү өгсөж өвлөнө", () => {
  const result = ebarimtReadiness({
    items: [
      { name: "Тараг", categoryCode: "TARAG", ebarimtClassificationCode: null, ebarimtTaxProductCode: null, vatMode: "standard" },
      { name: "Шампунь", categoryCode: "HOME", ebarimtClassificationCode: null, ebarimtTaxProductCode: null, vatMode: "standard" },
    ],
    categories: [
      { id: "f", code: "FOOD", name: "Хүнс", parentId: null, ebarimtClassificationCode: "2399990" },
      { id: "d", code: "DAIRY", name: "Сүү", parentId: "f", ebarimtClassificationCode: null },
      { id: "t", code: "TARAG", name: "Тараг", parentId: "d", ebarimtClassificationCode: null },
      { id: "h", code: "HOME", name: "Ахуй", parentId: null, ebarimtClassificationCode: null },
    ],
    paymentMethods: [],
  });
  // Тараг → Сүү → Хүнс (2399990) өвлөнө; Ахуйд код байхгүй — ЗОХИОХГҮЙ
  assert.equal(result.items.count, 1);
  assert.deepEqual(result.items.sample, ["Шампунь"]);
});

test("P1-4: албан жагсаалтад байхгүй төлбөрийн код → warnings (блоклохгүй), ready хэвээр", () => {
  const readiness = ebarimtReadiness({
    items: [],
    categories: [],
    paymentMethods: [
      { name: "Бэлэн", ebarimtCode: "CASH" },
      { name: "QPay", ebarimtCode: "bank_transfer_qpay" },
      { name: "Зээлээр", ebarimtCode: "INVOICE" },
    ],
  });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.problems.length, 0);
  assert.equal(readiness.unknownPaymentCodes.count, 1);
  assert.deepEqual(readiness.unknownPaymentCodes.sample, ["Зээлээр (INVOICE)"]);
  assert.equal(readiness.warnings.length, 1);
  assert.match(readiness.warnings[0], /BANK_TRANSFER_QPAY/);
  assert.match(readiness.warnings[0], /Зээлээр \(INVOICE\)/);
});

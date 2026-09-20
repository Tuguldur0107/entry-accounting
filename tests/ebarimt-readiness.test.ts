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

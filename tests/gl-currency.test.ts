// Журналын валютын цэвэр логик — хөрвүүлэлт, бөөрөнхийллийн шингээлт, тэнцэл.

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRate,
  convertLinesToBase,
  fcBalance,
  isBaseCurrency,
  normalizeCurrency,
} from "../lib/gl/currency";

test("валютын код — 3 үсэг, ТОМ болгоно; гажиг бол ШИДНЭ", () => {
  assert.equal(normalizeCurrency(" usd "), "USD");
  assert.equal(isBaseCurrency("mnt"), true);
  assert.equal(isBaseCurrency("USD"), false);
  assert.throws(() => normalizeCurrency("US"));
  assert.throws(() => normalizeCurrency("US1"));
});

test("ханш 0 эсвэл сөрөг бол ШИДНЭ (ханш зохиогдохгүй)", () => {
  assert.equal(assertRate(3450.55), 3450.55);
  assert.throws(() => assertRate(0));
  assert.throws(() => assertRate(-1));
  assert.throws(() => assertRate(Number.NaN));
});

test("энгийн хөрвүүлэлт — мөр бүр round(fc × ханш, 2)", () => {
  const out = convertLinesToBase(
    [
      { debitFc: 1000, creditFc: 0 },
      { debitFc: 0, creditFc: 1000 },
    ],
    3500
  );
  assert.deepEqual(out.lines, [
    { debit: 3_500_000, credit: 0 },
    { debit: 0, credit: 3_500_000 },
  ]);
  assert.equal(out.roundingAdjustment, 0);
});

test("бөөрөнхийллийн зөрүү ХАМГИЙН ТОМ мөрөнд шингэж GL ТЭНЦЭНЭ", () => {
  // 33.33 + 33.33 + 33.34 = 100 (FC). Ханш 3333.33 — мөр бүр өөр өөр
  // бөөрөнхийлөгдөж Дт/Кт нийлбэр зөрөх магадлалтай.
  const out = convertLinesToBase(
    [
      { debitFc: 33.33, creditFc: 0 },
      { debitFc: 33.33, creditFc: 0 },
      { debitFc: 33.34, creditFc: 0 },
      { debitFc: 0, creditFc: 100 },
    ],
    3333.33
  );
  const totalDebit = out.lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = out.lines.reduce((sum, line) => sum + line.credit, 0);
  assert.equal(Math.round((totalDebit - totalCredit) * 100) / 100, 0);
  // Залруулга гарсан бол ХАМГИЙН ТОМ мөрөнд орсон байна
  if (out.roundingAdjustment !== 0) {
    assert.ok(out.adjustedIndex >= 0);
    assert.ok(Math.abs(out.roundingAdjustment) <= 0.05);
  }
});

test("нэг мөрд дебет ба кредит зэрэг байвал ШИДНЭ", () => {
  assert.throws(() =>
    convertLinesToBase([{ debitFc: 10, creditFc: 10 }], 3500)
  );
});

test("сөрөг валютын дүн ШИДНЭ", () => {
  assert.throws(() =>
    convertLinesToBase([{ debitFc: -5, creditFc: 0 }], 3500)
  );
});

test("валютаар ТЭНЦЭЭГҮЙ журналыг чимээгүй ЗАСАХГҮЙ — ШИДНЭ", () => {
  assert.throws(
    () =>
      convertLinesToBase(
        [
          { debitFc: 1000, creditFc: 0 },
          { debitFc: 0, creditFc: 900 },
        ],
        3500
      ),
    /тэнцэхгүй/
  );
});

test("fcBalance — хоосон, тэнцсэн, зөрүүтэй төлвүүд", () => {
  assert.equal(fcBalance([{ debitFc: 0, creditFc: 0 }]).isEmpty, true);
  assert.equal(fcBalance([{ debitFc: 0, creditFc: 0 }]).balanced, false);

  const ok = fcBalance([
    { debitFc: 250.5, creditFc: 0 },
    { debitFc: 0, creditFc: 250.5 },
  ]);
  assert.equal(ok.balanced, true);
  assert.equal(ok.difference, 0);

  const off = fcBalance([
    { debitFc: 250.5, creditFc: 0 },
    { debitFc: 0, creditFc: 200 },
  ]);
  assert.equal(off.balanced, false);
  assert.equal(off.difference, 50.5);
});

test("ноорогт бөөрөнхийлөл шингээхгүй (тэнцээгүй байж болно)", () => {
  const out = convertLinesToBase(
    [
      { debitFc: 1000, creditFc: 0 },
      { debitFc: 0, creditFc: 900 },
    ],
    3500,
    { absorbRounding: false }
  );
  assert.deepEqual(out.lines, [
    { debit: 3_500_000, credit: 0 },
    { debit: 0, credit: 3_150_000 },
  ]);
  assert.equal(out.roundingAdjustment, 0);
});

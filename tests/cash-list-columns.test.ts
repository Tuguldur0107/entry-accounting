import test from "node:test";
import assert from "node:assert/strict";

import {
  cashAccountGlLabel,
  cashDebitCredit,
  matchCounterpartyByName,
  normalizeCounterpartyName,
} from "../lib/cash/list-columns";

// ── Дт/Кт задаргаа ────────────────────────────────────────────────────────

test("орлого: мөнгөн данс дебетлэгдэнэ — MNT баримтад валютын багана хоосон", () => {
  const split = cashDebitCredit({
    documentType: "receipt",
    amount: 1_800_000,
    baseAmount: 1_800_000,
    currency: "MNT",
    exchangeRate: 1,
  });
  assert.deepEqual(split, {
    debitBase: 1_800_000,
    creditBase: 0,
    debitFx: null,
    creditFx: null,
  });
});

test("зарлага валютаар: кредит MNT суурь + кредит валютын дүн", () => {
  const split = cashDebitCredit({
    documentType: "payment",
    amount: 100,
    baseAmount: 355_000,
    currency: "USD",
    exchangeRate: 3550,
  });
  assert.equal(split.debitBase, 0);
  assert.equal(split.creditBase, 355_000);
  assert.equal(split.debitFx, null);
  assert.equal(split.creditFx, 100);
});

test("ханшгүй валютын ноорог (GL-ээс): MNT суурь харагдана, валютын дүн null", () => {
  const split = cashDebitCredit({
    documentType: "receipt",
    amount: 0,
    baseAmount: 500_000,
    currency: "USD",
    exchangeRate: 0,
  });
  assert.equal(split.debitBase, 500_000);
  assert.equal(split.debitFx, null);
});

test("шилжүүлэг: хүлээн авах данс Дт, гаргах данс Кт — хоёулаа", () => {
  const split = cashDebitCredit({
    documentType: "transfer",
    amount: 250,
    baseAmount: 887_500,
    currency: "USD",
    exchangeRate: 3550,
  });
  assert.equal(split.debitBase, 887_500);
  assert.equal(split.creditBase, 887_500);
  assert.equal(split.debitFx, 250);
  assert.equal(split.creditFx, 250);
});

// ── Дансны код ────────────────────────────────────────────────────────────

test("дансны код: орлого хүлээн авах, зарлага гаргах, шилжүүлэг хоёуланг заана", () => {
  const from = "11000001";
  const to = "11210000";
  assert.equal(
    cashAccountGlLabel({ documentType: "receipt", fromGlNumber: null, toGlNumber: to }),
    to
  );
  assert.equal(
    cashAccountGlLabel({ documentType: "payment", fromGlNumber: from, toGlNumber: null }),
    from
  );
  assert.equal(
    cashAccountGlLabel({ documentType: "transfer", fromGlNumber: from, toGlNumber: to }),
    `${from} → ${to}`
  );
});

// ── Харилцагчийн автомат холбоос ──────────────────────────────────────────

const LIST = [
  { id: "a", name: "Мөнхгэрэл ХХК" },
  { id: "b", name: "Голомт банк" },
  { id: "c", name: "АРАБ ТРЕЙД" },
  { id: "d", name: "Араб трейд" },
];

test("нэр нормчлол: зай, том/жижиг үсэг ялгахгүй", () => {
  assert.equal(normalizeCounterpartyName("  Мөнхгэрэл   ХХК "), "мөнхгэрэл ххк");
  assert.equal(normalizeCounterpartyName(null), "");
});

test("ЯГ таарсан нэр (кириллийн том/жижиг үсэг үл харгалзан) холбогдоно", () => {
  assert.equal(matchCounterpartyByName("мөнхгэрэл ххк", LIST)?.id, "a");
  assert.equal(matchCounterpartyByName("Голомт  банк", LIST)?.id, "b");
});

test("хэсэгчилсэн / хоосон нэр холбогдохгүй — таамаглахгүй", () => {
  assert.equal(matchCounterpartyByName("Мөнхгэрэл", LIST), null);
  assert.equal(matchCounterpartyByName("", LIST), null);
  assert.equal(matchCounterpartyByName(undefined, LIST), null);
});

test("олон бүртгэл таарвал (үсгийн хэмжээгээр л ялгаатай) холбохгүй", () => {
  assert.equal(matchCounterpartyByName("араб трейд", LIST), null);
});

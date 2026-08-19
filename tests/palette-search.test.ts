import test from "node:test";
import assert from "node:assert/strict";

import {
  REFERENCE_MIN_QUERY,
  searchReference,
  type ReferenceData,
} from "../lib/reference/palette-search";

const DATA: ReferenceData = {
  accounts: [
    { number: "11000001", name: "Харилцах данс" },
    { number: "11210000", name: "Касс" },
    { number: "51100000", name: "Борлуулалтын орлого" },
  ],
  counterparties: [
    { id: "cp-1", name: "Хос Бэст ХХК", counterpartyType: "customer" },
    { id: "cp-2", name: "Түмэн Импекс", counterpartyType: "supplier" },
    { id: "cp-3", name: "Бэстэн Трейд", counterpartyType: "both" },
  ],
  items: [
    { id: "it-1", code: "A-100", name: "Цемент" },
    { id: "it-2", code: "B-200", name: "Арматур" },
  ],
};

test("богино query-д хоосон буцаана", () => {
  assert.equal(searchReference(DATA, "").length, 0);
  assert.equal(searchReference(DATA, "х").length, 0);
  assert.ok(REFERENCE_MIN_QUERY >= 2);
});

test("дансыг дугаар болон нэрээр, том жижиг үсэг ялгалгүй олно", () => {
  const byNumber = searchReference(DATA, "1121");
  assert.deepEqual(
    byNumber.filter((hit) => hit.kind === "account").map((hit) => hit.id),
    ["11210000"]
  );
  const byName = searchReference(DATA, "БОРЛУУЛАЛТ");
  assert.deepEqual(
    byName.filter((hit) => hit.kind === "account").map((hit) => hit.id),
    ["51100000"]
  );
});

test("эхэлж таарсан нь агуулж таарснаас түрүүлнэ", () => {
  const hits = searchReference(DATA, "бэст")
    .filter((hit) => hit.kind === "counterparty")
    .map((hit) => hit.label);
  // "Бэстэн Трейд" (startsWith) нь "Хос Бэст ХХК"-ээс (includes) өмнө.
  assert.deepEqual(hits, ["Бэстэн Трейд", "Хос Бэст ХХК"]);
});

test("харилцагчийн төрөл routing-д хадгалагдана", () => {
  const [supplier] = searchReference(DATA, "түмэн").filter(
    (hit) => hit.kind === "counterparty"
  );
  assert.equal(supplier.counterpartyType, "supplier");
});

test("барааг кодоор олно, бүлэг бүр 5-аас илүүгүй", () => {
  const byCode = searchReference(DATA, "b-2");
  assert.deepEqual(
    byCode.filter((hit) => hit.kind === "item").map((hit) => hit.id),
    ["it-2"]
  );
  const many: ReferenceData = {
    accounts: Array.from({ length: 12 }, (_, index) => ({
      number: `1100000${index}`,
      name: `Данс ${index}`,
    })),
    counterparties: [],
    items: [],
  };
  assert.equal(searchReference(many, "данс").length, 5);
});

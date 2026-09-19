import test from "node:test";
import assert from "node:assert/strict";

import { parseMatrix } from "../lib/excel/import-spec";
import { inventoryItemsSpec, type InventoryItemImport } from "../lib/excel/specs";

const HEADER = [
  "Код",
  "Нэр",
  "Хэмжих нэгж",
  "Борлуулах үнэ",
  "Доод үнэ",
  "Баркод",
  "НӨАТ",
  "Бүлэг",
  "eBarimt ангилал",
  "Татварын код",
  "Идэвхтэй",
];

const spec = inventoryItemsSpec({ categoryCodes: new Set(["FOOD", "OFFICE"]) });

test("inventoryItemsSpec: зөв мөр бүх талбартайгаа уншигдана", () => {
  const result = parseMatrix(
    [
      HEADER,
      [
        "BM-001",
        "Цаас А4",
        "боодол",
        "15000",
        "13500",
        "8651234567890",
        "10%",
        "OFFICE",
        "1234567",
        "",
        "Тийм",
      ],
    ],
    spec
  );
  assert.deepEqual(result.headerErrors, []);
  assert.equal(result.validCount, 1);
  assert.deepEqual(result.rows[0].value satisfies InventoryItemImport | null, {
    code: "BM-001",
    name: "Цаас А4",
    unit: "боодол",
    salesPrice: 15_000,
    minSalesPrice: 13_500,
    barcode: "8651234567890",
    vatMode: "standard",
    categoryCode: "OFFICE",
    ebarimtClassificationCode: "1234567",
    ebarimtTaxProductCode: null,
    isActive: true,
  });
});

test("inventoryItemsSpec: хоосон нэгж/НӨАТ/идэвх default авна, сонголтот талбар null", () => {
  const result = parseMatrix([HEADER, ["BM-002", "Үзэг", "", "", "", "", "", "", "", "", ""]], spec);
  assert.equal(result.validCount, 1);
  const value = result.rows[0].value!;
  assert.equal(value.unit, "ш");
  assert.equal(value.vatMode, "standard");
  assert.equal(value.isActive, true);
  assert.equal(value.salesPrice, null);
  assert.equal(value.minSalesPrice, null);
  assert.equal(value.barcode, null);
  assert.equal(value.categoryCode, null);
  assert.equal(value.ebarimtClassificationCode, null);
  assert.equal(value.ebarimtTaxProductCode, null);
});

test("inventoryItemsSpec: eBarimt ангилал 7 орон, татварын код 3 орон байна", () => {
  const bad = parseMatrix(
    [HEADER, ["BM-010", "Ном", "ш", "", "", "", "Чөлөөлөгдсөн", "", "12345", "12", ""]],
    spec
  );
  assert.equal(bad.errorCount, 1);
  assert.ok(bad.rows[0].errors.some((error) => error.includes("eBarimt ангилал")));
  assert.ok(bad.rows[0].errors.some((error) => error.includes("Татварын код")));

  const ok = parseMatrix(
    [HEADER, ["BM-011", "Ном", "ш", "", "", "", "Чөлөөлөгдсөн", "", "7654321", "101", ""]],
    spec
  );
  assert.equal(ok.validCount, 1);
  assert.equal(ok.rows[0].value!.ebarimtClassificationCode, "7654321");
  assert.equal(ok.rows[0].value!.ebarimtTaxProductCode, "101");
});

test("inventoryItemsSpec: код дутуу мөр алдаатай", () => {
  const result = parseMatrix([HEADER, ["", "Нэргүй код", "ш", "", "", "", "", "", "", "", ""]], spec);
  assert.equal(result.errorCount, 1);
  assert.ok(result.rows[0].errors.some((error) => error.includes("Код")));
  assert.equal(result.rows[0].value, null);
});

test("inventoryItemsSpec: НӨАТ-ийн буруу шошго алдаа өгнө, англи түлхүүр ч болно", () => {
  const bad = parseMatrix([HEADER, ["BM-003", "Сүү", "л", "", "", "", "20%", "", "", "", ""]], spec);
  assert.equal(bad.errorCount, 1);
  assert.ok(bad.rows[0].errors.some((error) => error.includes("НӨАТ")));

  const ok = parseMatrix(
    [
      HEADER,
      ["BM-004", "Талх", "ш", "", "", "", "exempt", "FOOD", "", "", ""],
      ["BM-005", "Экспорт", "ш", "", "", "", "0%", "", "", "", ""],
    ],
    spec
  );
  assert.equal(ok.validCount, 2);
  assert.equal(ok.rows[0].value!.vatMode, "exempt");
  assert.equal(ok.rows[1].value!.vatMode, "zero");
});

test("inventoryItemsSpec: бүртгэлгүй бүлэг алдаа өгнө", () => {
  const result = parseMatrix([HEADER, ["BM-006", "Жүүс", "ш", "", "", "", "", "DRINKS", "", "", ""]], spec);
  assert.equal(result.errorCount, 1);
  assert.ok(result.rows[0].errors.some((error) => error.includes("DRINKS")));
});

test("inventoryItemsSpec: дүн ₮ ба таслалтай уншигдана, доод үнэ > үнэ бол алдаа", () => {
  const result = parseMatrix(
    [
      HEADER,
      ["BM-007", "Зөөврийн компьютер", "ш", "1,650,000₮", "1,500,000 ₮", "", "", "", "", "", ""],
      ["BM-008", "Хямд", "ш", "1000", "2000", "", "", "", "", "", ""],
    ],
    spec
  );
  assert.equal(result.rows[0].errors.length, 0);
  assert.equal(result.rows[0].value!.salesPrice, 1_650_000);
  assert.equal(result.rows[0].value!.minSalesPrice, 1_500_000);
  assert.ok(result.rows[1].errors.some((error) => error.includes("Доод үнэ")));
});

test("inventoryItemsSpec: заавал багана дутвал толгойн алдаа", () => {
  const result = parseMatrix([["Код", "Хэмжих нэгж"], ["BM-009", "ш"]], spec);
  assert.ok(result.headerErrors.some((error) => error.includes("Нэр")));
  assert.equal(result.rows.length, 0);
});

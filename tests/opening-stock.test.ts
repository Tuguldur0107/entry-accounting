// SIM2-007 / ENT-003: нээлтийн барааны үлдэгдэл өртөгтэй — ЦЭВЭР логик.
import test from "node:test";
import assert from "node:assert/strict";

import { openingStockSpec } from "../lib/excel/specs";
import { parseMatrix } from "../lib/excel/import-spec";
import { openingStockDateProblem, planOpeningStock } from "../lib/inventory/opening-stock";

test("planOpeningStock: дүн = тоо × нэгж өртөг, нийлбэр", () => {
  const plan = planOpeningStock([
    { itemCode: "IMP-099", warehouseCode: "WH-01", quantity: 25, unitCost: 105040 },
    { itemCode: "IMP-099", warehouseCode: "WH-03", quantity: 8, unitCost: 101810 },
    { itemCode: "IMP-001", warehouseCode: "WH-01", quantity: 3, unitCost: 333.333 },
  ]);
  assert.ok(plan.ok);
  assert.deepEqual(plan.lines.map((line) => line.amount), [2_626_000, 814_480, 1000]);
  assert.equal(plan.totalAmount, 3_441_480);
});

test("planOpeningStock: ижил бараа × агуулах давхардвал, 0 өртөг, 0 тоо — татгалзана", () => {
  const plan = planOpeningStock([
    { itemCode: "IMP-036", warehouseCode: "WH-01", quantity: 26, unitCost: 1000 },
    { itemCode: "imp-036", warehouseCode: "wh-01", quantity: 26, unitCost: 1200 },
    { itemCode: "IMP-037", warehouseCode: "WH-01", quantity: 5, unitCost: 0 },
    { itemCode: "IMP-038", warehouseCode: "WH-01", quantity: 0, unitCost: 10 },
    { itemCode: "", warehouseCode: "WH-01", quantity: 1, unitCost: 10 },
  ]);
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.match(plan.errors.join("\n"), /2-р мөр: .*1-р мөртэй давхардсан/);
  assert.match(plan.errors.join("\n"), /3-р мөр: нэгж өртөг 0-ээс их/);
  assert.match(plan.errors.join("\n"), /4-р мөр: тоо хэмжээ 0-ээс их/);
  assert.match(plan.errors.join("\n"), /5-р мөр: барааны код хоосон/);
  assert.deepEqual(planOpeningStock([]), { ok: false, errors: ["Мөр алга"] });
});

test("openingStockDateProblem (D-OS-2): бусад гүйлгээнээс хожуу бол татгалзана, ижил өдөр болно", () => {
  assert.equal(openingStockDateProblem("2024-12-31", null), null);
  assert.equal(openingStockDateProblem("2024-12-31", "2025-01-02"), null);
  assert.equal(openingStockDateProblem("2025-01-02", "2025-01-02"), null);
  assert.match(openingStockDateProblem("2025-01-10", "2025-01-02") ?? "", /OPENING_AFTER_ACTIVITY/);
});

test("openingStockSpec: баганыг нэрээр, код/тоо/өртгийг шалгана", () => {
  const spec = openingStockSpec({ itemCodes: new Set(["IMP-099"]), warehouseCodes: new Set(["WH-01"]) });
  const result = parseMatrix([
    ["Нэгж өртөг", "Барааны код", "Агуулахын код", "Тоо", "Огноо"],
    ["105,040₮", "IMP-099", "WH-01", "25", "2024.12.31"],
    ["0", "IMP-404", "WH-09", "-1", "2024-13-01"],
  ], spec);
  assert.deepEqual(result.headerErrors, []);
  assert.deepEqual(result.rows[0].value, {
    date: "2024-12-31",
    itemCode: "IMP-099",
    warehouseCode: "WH-01",
    quantity: 25,
    unitCost: 105040,
  });
  assert.equal(result.rows[1].value, null);
  assert.equal(result.rows[1].errors.length, 5);
});

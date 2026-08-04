import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAmountCell,
  parseDateCell,
  parseMatrix,
} from "../lib/excel/import-spec";
import {
  arapLinesSpec,
  groupVoucherRows,
  journalLinesSpec,
  journalVouchersSpec,
  type ArapLineContext,
} from "../lib/excel/specs";

// ── Туслах контекст ────────────────────────────────────────────────────────

const ACTIVE_SEG_IDS = [3];
const DEFAULTS: Record<number, string> = {};

const accountContext = {
  accountsByMain: new Map([
    ["11000001", "Харилцах данс"],
    ["72100000", "Цалингийн зардал"],
    ["14000099", "Клиринг"],
  ]),
  activeSegIds: ACTIVE_SEG_IDS,
  defaultSegments: DEFAULTS,
};

// Шинэ стандарт: бүх сегмент бөглөгдөнө — бичигдээгүй нь оронгийн тоогоор 0.
const FULL_11000001 = "000.000000.11000001.00.0000.000.0000.0000.GL.0";

// ── parseAmountCell / parseDateCell ────────────────────────────────────────

test("parseAmountCell: ₮, зай, таслал тэвчинэ", () => {
  assert.equal(parseAmountCell("1,500,000"), 1_500_000);
  assert.equal(parseAmountCell("₮ 2 500 000"), 2_500_000);
  assert.equal(parseAmountCell("123.45"), 123.45);
  assert.equal(parseAmountCell(""), null);
  assert.equal(parseAmountCell("abc"), undefined);
});

test("parseDateCell: тусгаарлагч тэвчээд худал огноог няцаана", () => {
  assert.equal(parseDateCell("2026-07-15"), "2026-07-15");
  assert.equal(parseDateCell("2026.7.5"), "2026-07-05");
  assert.equal(parseDateCell("2026/07/15"), "2026-07-15");
  assert.equal(parseDateCell("2026-02-31"), null);
  assert.equal(parseDateCell("15-07-2026"), null);
  assert.equal(parseDateCell(""), null);
});

// ── parseMatrix — толгойн таарц, мөрийн алдаа ──────────────────────────────

test("parseMatrix: багана НЭРЭЭР танигдана — даралал, том/жижиг, * хамаагүй", () => {
  const spec = journalLinesSpec(accountContext);
  const result = parseMatrix(
    [
      ["Тайлбар", " ДАНС* ", "Кредит", "Дебет", "Илүү багана"],
      ["түрээс", "11000001", "", "1500000", "юу ч"],
    ],
    spec
  );
  assert.deepEqual(result.headerErrors, []);
  assert.equal(result.validCount, 1);
  const row = result.rows[0];
  assert.equal(row.errors.length, 0);
  assert.equal(row.value?.debit, 1_500_000);
  assert.equal(row.value?.account, FULL_11000001);
});

test("parseMatrix: заавал багана дутвал headerError — юу ч орохгүй", () => {
  const spec = journalLinesSpec(accountContext);
  const result = parseMatrix([["Дебет", "Кредит"], ["100", ""]], spec);
  assert.equal(result.headerErrors.length, 1);
  assert.match(result.headerErrors[0], /Данс/);
  assert.equal(result.rows.length, 0);
});

test("parseMatrix: хоосон мөр алгасагдаж, мөрийн дугаар Excel-ийнхтэй таарна", () => {
  const spec = journalLinesSpec(accountContext);
  const result = parseMatrix(
    [
      ["Данс", "Дебет", "Кредит", "Тайлбар"],
      ["", "", "", ""],
      ["99999999", "100", "", ""],
    ],
    spec
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].rowNumber, 3);
  assert.equal(result.errorCount, 1);
  assert.match(result.rows[0].errors[0], /жагсаалтад алга/);
});

// ── Журналын мөрийн спек ───────────────────────────────────────────────────

test("journalLinesSpec: Дебет⊕Кредит mutex, сөрөг дүн, хоосон дүн", () => {
  const spec = journalLinesSpec(accountContext);
  const both = spec.parseRow({
    account: "11000001",
    debit: "100",
    credit: "50",
    description: "",
  });
  assert.ok("errors" in both && both.errors.some((e) => /зэрэг/.test(e)));

  const neither = spec.parseRow({
    account: "11000001",
    debit: "",
    credit: "",
    description: "",
  });
  assert.ok("errors" in neither);

  const negative = spec.parseRow({
    account: "11000001",
    debit: "-5",
    credit: "",
    description: "",
  });
  assert.ok("errors" in negative && negative.errors.some((e) => /сөрөг/.test(e)));

  const ok = spec.parseRow({
    account: "72100000",
    debit: "",
    credit: "2,000",
    description: "цалин",
  });
  assert.ok("value" in ok);
  if ("value" in ok) assert.equal(ok.value.credit, 2000);
});

test("journalLinesSpec: бүтэн 10-part код хэвээр өнгөрнө", () => {
  const spec = journalLinesSpec(accountContext);
  const parsed = spec.parseRow({
    account: FULL_11000001,
    debit: "10",
    credit: "",
    description: "",
  });
  assert.ok("value" in parsed);
  if ("value" in parsed) assert.equal(parsed.value.account, FULL_11000001);
});

// ── АР/АП мөрийн спек ──────────────────────────────────────────────────────

const arapContext: ArapLineContext = {
  ...accountContext,
  itemsByCode: new Map([["ITEM-001", { id: "item-1", name: "Цемент" }]]),
  warehousesByCode: new Map([["WH-01", { id: "wh-1", name: "Төв агуулах" }]]),
};

test("arapLinesSpec: бараагүй мөр — данс + дүн хангалттай", () => {
  const spec = arapLinesSpec(arapContext);
  const parsed = spec.parseRow({
    account: "72100000",
    amount: "500000",
    description: "үйлчилгээ",
    itemCode: "",
    quantity: "",
    warehouseCode: "",
  });
  assert.ok("value" in parsed);
  if ("value" in parsed) {
    assert.equal(parsed.value.itemId, null);
    assert.equal(parsed.value.amount, 500_000);
  }
});

test("arapLinesSpec: бараатай мөр — тоо, агуулах заавал; код бүртгэлээс таарна", () => {
  const spec = arapLinesSpec(arapContext);
  const ok = spec.parseRow({
    account: "14000099",
    amount: "2500000",
    description: "",
    itemCode: "ITEM-001",
    quantity: "100",
    warehouseCode: "WH-01",
  });
  assert.ok("value" in ok);
  if ("value" in ok) {
    assert.equal(ok.value.itemId, "item-1");
    assert.equal(ok.value.warehouseId, "wh-1");
    assert.equal(ok.value.quantity, 100);
  }

  const missingQty = spec.parseRow({
    account: "14000099",
    amount: "2500000",
    description: "",
    itemCode: "ITEM-001",
    quantity: "",
    warehouseCode: "WH-01",
  });
  assert.ok("errors" in missingQty && missingQty.errors.some((e) => /Тоо/.test(e)));

  const badItem = spec.parseRow({
    account: "14000099",
    amount: "10",
    description: "",
    itemCode: "NO-SUCH",
    quantity: "1",
    warehouseCode: "WH-01",
  });
  assert.ok("errors" in badItem && badItem.errors.some((e) => /бүртгэлд алга/.test(e)));
});

test("arapLinesSpec: 0 болон хоосон дүн няцаагдана", () => {
  const spec = arapLinesSpec(arapContext);
  const zero = spec.parseRow({
    account: "72100000",
    amount: "0",
    description: "",
    itemCode: "",
    quantity: "",
    warehouseCode: "",
  });
  assert.ok("errors" in zero);
  const empty = spec.parseRow({
    account: "72100000",
    amount: "",
    description: "",
    itemCode: "",
    quantity: "",
    warehouseCode: "",
  });
  assert.ok("errors" in empty);
});

// ── Багц журнал — бүлэглэлт ────────────────────────────────────────────────

test("journalVouchersSpec + groupVoucherRows: Баримт №-оор бүлэглэж журнал болгоно", () => {
  const spec = journalVouchersSpec(accountContext);
  const result = parseMatrix(
    [
      ["Баримт №", "Огноо", "Гүйлгээний утга", "Данс", "Дебет", "Кредит", "Мөрийн тайлбар"],
      ["JE-1", "2026-07-15", "Түрээс", "72100000", "100", "", "зардал"],
      ["JE-1", "2026-07-15", "", "11000001", "", "100", "банк"],
      ["JE-2", "2026-07-20", "Ганц мөр", "11000001", "50", "", ""],
    ],
    spec
  );
  assert.equal(result.validCount, 3);

  const grouped = groupVoucherRows(
    result.rows.filter((row) => row.errors.length === 0).map((row) => row.value!)
  );
  assert.equal(grouped.length, 2);

  const je1 = grouped.find((entry) => entry.voucherKey === "JE-1")!;
  assert.deepEqual(je1.errors, []);
  assert.equal(je1.description, "Түрээс");
  assert.equal(je1.lines.length, 2);
  assert.equal(je1.date, "2026-07-15");

  // Ганц мөртэй баримт — баримтын түвшний алдаа
  const je2 = grouped.find((entry) => entry.voucherKey === "JE-2")!;
  assert.ok(je2.errors.some((e) => /2 мөр/.test(e)));
});

test("groupVoucherRows: нэг баримтад олон огноо — алдаа", () => {
  const grouped = groupVoucherRows([
    {
      voucherKey: "JE-X",
      date: "2026-07-01",
      voucherDescription: "",
      account: FULL_11000001,
      debit: 10,
      credit: 0,
      lineDescription: "",
    },
    {
      voucherKey: "JE-X",
      date: "2026-07-02",
      voucherDescription: "",
      account: FULL_11000001,
      debit: 0,
      credit: 10,
      lineDescription: "",
    },
  ]);
  assert.equal(grouped.length, 1);
  assert.ok(grouped[0].errors.some((e) => /огноо/.test(e)));
});

test("journalVouchersSpec: огноо буруу бол мөр алдаатай", () => {
  const spec = journalVouchersSpec(accountContext);
  const parsed = spec.parseRow({
    voucherKey: "JE-1",
    date: "2026-13-01",
    voucherDescription: "",
    account: "11000001",
    debit: "10",
    credit: "",
    description: "",
  });
  assert.ok("errors" in parsed && parsed.errors.some((e) => /Огноо/.test(e)));
});

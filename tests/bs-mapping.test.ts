import assert from "node:assert/strict";
import { test } from "node:test";

import { STANDARD_ACCOUNTS } from "../lib/constants/standard-accounts";
import {
  defaultBsLineKeysOf,
  resolveBsLines,
  UNCLASSIFIED_BS_LABEL,
} from "../lib/reports/bs-resolve";

const balanceAccounts = STANDARD_ACCOUNTS.filter((a) => /^[1-4]/.test(a.number));

test("ENT-072: стандарт төлөвлөгөөний 1–4 ангиллын данс бүр ЯГ НЭГ балансын мөрөнд", () => {
  const problems = balanceAccounts
    .map((a) => ({ number: a.number, lines: defaultBsLineKeysOf(a.number) }))
    .filter((row) => row.lines.length !== 1);
  assert.deepEqual(problems, []);
});

test("313 урьдчилгаа, 31000004–06 татвар — зохих мөрөнд", () => {
  assert.deepEqual(defaultBsLineKeysOf("31300001"), ["other-current-liabilities"]);
  for (const n of ["31000004", "31000005", "31000006"])
    assert.deepEqual(defaultBsLineKeysOf(n), ["tax-payable"]);
});

test("хоосон override (нуусан/нэр солисон мөр) дансаа алдахгүй", () => {
  const lines = resolveBsLines([{ number: "11000001" }], [
    { lineKey: "cash", accountNumbers: "", customLabel: "Мөнгө", customGroup: null, isHidden: true, sortOrder: 0 },
  ]);
  const cash = lines.find((l) => l.key === "cash")!;
  assert.deepEqual(cash.accountNumbers, ["11000001"]);
  assert.equal(cash.label, "Мөнгө");
  assert.equal(cash.isHidden, true);
});

test("аль ч мөрөнд ороогүй данс «Ангилагдаагүй» мөрөнд ил гарна (баланс алдагдахгүй)", () => {
  const lines = resolveBsLines(
    [{ number: "15000001" }, { number: "30500001" }, { number: "51100000" }],
    []
  );
  const extra = lines.filter((l) => l.isUnclassified);
  assert.deepEqual(
    extra.map((l) => [l.group, l.accountNumbers, l.label]),
    [
      ["current-assets", ["15000001"], UNCLASSIFIED_BS_LABEL],
      ["current-liabilities", ["30500001"], UNCLASSIFIED_BS_LABEL],
    ]
  );
});

test("override-оор өөр мөрөнд орсон данс «ангилагдаагүй» болохгүй", () => {
  const lines = resolveBsLines([{ number: "15000001" }], [
    { lineKey: "inventory", accountNumbers: "15000001", customLabel: null, customGroup: null, isHidden: false, sortOrder: 0 },
  ]);
  assert.equal(lines.filter((l) => l.isUnclassified).length, 0);
});

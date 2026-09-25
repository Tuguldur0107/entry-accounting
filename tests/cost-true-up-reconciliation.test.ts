import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInventoryReconciliationRows,
  postedEntryAmount,
  type ReconciliationGlLine,
} from "../lib/costing/reconciliation-math";

const INVENTORY = "14000001";
const COGS = "61100000";

// 2026-09-24 пилот дээр илэрсэн: POS-ийн урьдчилсан COGS 7,641.08₮ (Dr COGS /
// Cr нөөц) сар хаалтад −4,694.36₮-ийн cogs_true_up залруулгаар засагдана.
// Залруулга ТЭМДЭГТЭЙ хадгалагдаж, сөрөг тул батлахад Дт/Кт солигдож (Dr нөөц /
// Cr COGS) абсолют дүнгээр GL-д бичигддэг. Дэд дэвтрийн нийлбэр хадгалсан
// хосоор ТЭМДЭГТЭЙ дүнг нэмбэл нөөц −4,694.36 болж GL-ээс яг 2× зөрдөг байв.
const provisional = { entryType: "issue_cogs", amount: "7641.08" };
const trueUp = { entryType: "cogs_true_up", amount: "-4694.36" };

test("postedEntryAmount: cogs_true_up абсолют, бусад төрөл хэвээр", () => {
  assert.equal(postedEntryAmount(trueUp), 4694.36);
  assert.equal(postedEntryAmount({ entryType: "cogs_true_up", amount: 120 }), 120);
  assert.equal(postedEntryAmount(provisional), 7641.08);
  assert.equal(postedEntryAmount({ entryType: "receipt_capitalize", amount: "280000" }), 280000);
});

test("сөрөг залруулга батлагдсаны дараа дэд дэвтэр GL-тэй тэнцнэ", () => {
  // Хадгалсан хос: урьдчилсан → Dr COGS / Cr нөөц; сөрөг залруулга → Dr нөөц / Cr COGS.
  const posted = [
    { ...provisional, debit: COGS, credit: INVENTORY },
    { ...trueUp, debit: INVENTORY, credit: COGS },
  ];
  const subledger: [string, number][] = [];
  for (const entry of posted) {
    const effect = postedEntryAmount(entry);
    subledger.push([entry.debit, effect], [entry.credit, -effect]);
  }
  const glLines: ReconciliationGlLine[] = [
    { accountNumber: COGS, delta: 7641.08, linked: true, poClose: false },
    { accountNumber: INVENTORY, delta: -7641.08, linked: true, poClose: false },
    { accountNumber: INVENTORY, delta: 4694.36, linked: true, poClose: false },
    { accountNumber: COGS, delta: -4694.36, linked: true, poClose: false },
  ];
  const rows = buildInventoryReconciliationRows({ subledger, glLines });
  const inventory = rows.find((row) => row.accountNumber === INVENTORY);
  assert.ok(inventory, "нөөцийн мөр байх ёстой");
  assert.equal(inventory.subledgerAmount, -2946.72);
  assert.equal(inventory.glAmount, -2946.72);
  assert.equal(inventory.difference, 0);
});

test("регресс: тэмдэгтэй дүнг хадгалсан хосоор нэмбэл 2× зөрүү гарна", () => {
  const naive: [string, number][] = [
    [COGS, 7641.08],
    [INVENTORY, -7641.08],
    [INVENTORY, -4694.36], // буруу: Dr нөөц дээр −4,694.36
    [COGS, 4694.36],
  ];
  const glLines: ReconciliationGlLine[] = [
    { accountNumber: INVENTORY, delta: -7641.08, linked: true, poClose: false },
    { accountNumber: INVENTORY, delta: 4694.36, linked: true, poClose: false },
  ];
  const rows = buildInventoryReconciliationRows({ subledger: naive, glLines });
  const inventory = rows.find((row) => row.accountNumber === INVENTORY);
  assert.ok(inventory);
  assert.equal(Math.abs(inventory.difference), 9388.72);
});

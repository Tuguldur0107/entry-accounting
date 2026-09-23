import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInventoryReconciliationRows,
  type ReconciliationGlLine,
} from "../lib/costing/reconciliation-math";

const INVENTORY = "14000001";
const CLEARING = "14000099";

// Хангамжийн бодит урсгал: 2,410,000₮-ийн хүлээн авалт капиталжиж
// (Dr нөөц / Cr түр данс — өртгийн бичилт), дараа нь PO хаалт түр дансыг
// тэгшитгэнэ (Dr түр данс / Cr өглөгийн түр данс — өртгийн бичилт БИШ).
const receiptSubledger: [string, number][] = [
  [INVENTORY, 2_410_000],
  [CLEARING, -2_410_000],
];
const receiptGl: ReconciliationGlLine[] = [
  { accountNumber: INVENTORY, delta: 2_410_000, linked: true, poClose: false },
  { accountNumber: CLEARING, delta: -2_410_000, linked: true, poClose: false },
];
const poCloseGl: ReconciliationGlLine[] = [
  { accountNumber: CLEARING, delta: 2_410_000, linked: false, poClose: true },
];

test("PO хаалтын журнал зөрүү үүсгэхгүй, тусдаа баганаар ил гарна", () => {
  const rows = buildInventoryReconciliationRows({
    subledger: receiptSubledger,
    glLines: [...receiptGl, ...poCloseGl],
  });
  const clearing = rows.find((row) => row.accountNumber === CLEARING);
  assert.ok(clearing);
  assert.equal(clearing.subledgerAmount, -2_410_000);
  assert.equal(clearing.glAmount, 0);
  assert.equal(clearing.poCloseAmount, 2_410_000);
  assert.equal(clearing.difference, 0);
  // Хаалтын мөр «гараар бичсэн» гэж тоологдохгүй.
  assert.equal(clearing.unlinkedGlLines, 0);
  assert.equal(clearing.unlinkedGlAmount, 0);
});

test("хаалт хийгдээгүй байхад түр данс тэнцүү хэвээр", () => {
  const rows = buildInventoryReconciliationRows({
    subledger: receiptSubledger,
    glLines: receiptGl,
  });
  for (const row of rows) {
    assert.equal(row.difference, 0);
    assert.equal(row.poCloseAmount, 0);
  }
});

test("гараар бичсэн GL мөр ЖИНХЭНЭ зөрүү болж үлдэнэ", () => {
  const rows = buildInventoryReconciliationRows({
    subledger: receiptSubledger,
    glLines: [
      ...receiptGl,
      ...poCloseGl,
      { accountNumber: INVENTORY, delta: 50_000, linked: false, poClose: false },
    ],
  });
  const inventory = rows.find((row) => row.accountNumber === INVENTORY);
  assert.ok(inventory);
  assert.equal(inventory.glAmount, 2_460_000);
  assert.equal(inventory.difference, -50_000);
  assert.equal(inventory.unlinkedGlLines, 1);
  assert.equal(inventory.unlinkedGlAmount, 50_000);
});

test("зөвхөн дэд дэвтрийн данс харьцуулагдана, нэр онооно", () => {
  const rows = buildInventoryReconciliationRows({
    subledger: [[INVENTORY, 100]],
    glLines: [
      { accountNumber: INVENTORY, delta: 100, linked: true, poClose: false },
      { accountNumber: "31000001", delta: -100, linked: false, poClose: false },
    ],
    accountName: new Map([[INVENTORY, "Барааны нөөц"]]),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].accountName, "Барааны нөөц");
});

test("бөөрөнхийлөлт 2 орон хүртэл", () => {
  const rows = buildInventoryReconciliationRows({
    subledger: [[INVENTORY, 100.005]],
    glLines: [
      { accountNumber: INVENTORY, delta: 100.004, linked: true, poClose: false },
    ],
  });
  assert.equal(rows[0].subledgerAmount, 100.01);
  assert.equal(rows[0].glAmount, 100);
  assert.equal(rows[0].difference, 0.01);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanStockQrList,
  duplicateStockQrAcrossLines,
  normalizeStockQr,
  remainingStockQr,
  stockQrProblem,
  stockQrRequired,
  takeReturnedStockQr,
} from "../lib/pos/stock-qr";
import { addStockQr, addToCart, cartStockQrProblem, removeStockQr, setLineQuantity, type CartRow } from "../lib/pos/checkout-state";

const QR1 = "A17F974BE497F14CE0536F50A8C057A7";
const QR2 = "A17F974BE495F14CE0536F50A8C057A7";
const QR3 = "BF6B1FBA86FB4C41ADDBB01C09C024F5";

test("ОАТ QR: цэвэрлэгээ — зай хасна, агуулгыг өөрчлөхгүй, богино/удирдлагын тэмдэгт татгалзана", () => {
  assert.equal(normalizeStockQr(` ${QR1}\n`), QR1);
  assert.equal(normalizeStockQr("abc12345xyz"), "abc12345xyz", "жижиг үсэг хэвээр");
  assert.equal(normalizeStockQr("1234"), null);
  assert.equal(normalizeStockQr("ABCDEFGH\u0007"), null);
  assert.equal(normalizeStockQr(""), null);
  assert.deepEqual(cleanStockQrList([QR1, ` ${QR1} `, "x", QR2]), [QR1, QR2]);
});

test("ОАТ QR: шаардлага — eBarimt олгох борлуулалтад л", () => {
  assert.equal(stockQrRequired({ ebarimtEnabled: true, nonVat: false, manualEbarimtId: null }), true);
  assert.equal(stockQrRequired({ ebarimtEnabled: false, nonVat: false, manualEbarimtId: null }), false);
  assert.equal(stockQrRequired({ ebarimtEnabled: true, nonVat: true, manualEbarimtId: null }), false);
  assert.equal(stockQrRequired({ ebarimtEnabled: true, nonVat: false, manualEbarimtId: "1".repeat(33) }), false);
});

test("ОАТ QR: мөрийн шалгалт — бүхэл тоо, QR тоо = ширхэг, давхардалгүй", () => {
  const base = { name: "Архи", exciseStamped: true };
  assert.equal(stockQrProblem({ ...base, quantity: 2, stockQr: [QR1, QR2] }), null);
  assert.match(stockQrProblem({ ...base, quantity: 2, stockQr: [QR1] })!, /1\/2/);
  assert.match(stockQrProblem({ ...base, quantity: 1.5, stockQr: [QR1] })!, /бүхэл/);
  assert.match(stockQrProblem({ ...base, quantity: 2, stockQr: [QR1, QR1] })!, /давхардсан/);
  assert.equal(stockQrProblem({ name: "Талх", exciseStamped: false, quantity: 3, stockQr: [] }), null);
  assert.equal(duplicateStockQrAcrossLines([{ stockQr: [QR1] }, { stockQr: [QR2, QR1] }]), QR1);
  assert.equal(duplicateStockQrAcrossLines([{ stockQr: [QR1] }, { stockQr: [QR2] }]), null);
});

test("ОАТ QR: хэсэгчилсэн буцаалт — үлдсэнээс сүүлээс нь, өмнөх буцаалтыг хасна", () => {
  const sold = [QR1, QR2, QR3];
  assert.deepEqual(takeReturnedStockQr(sold, 1), [QR3]);
  const remaining = remainingStockQr(sold, [[QR3]]);
  assert.deepEqual(remaining, [QR1, QR2]);
  assert.deepEqual(takeReturnedStockQr(remaining, 2), [QR1, QR2]);
  assert.deepEqual(takeReturnedStockQr([], 2), [], "тэмдэггүй хуучин борлуулалт");
  assert.deepEqual(takeReturnedStockQr(sold, 10), sold);
});

test("Касс: тэмдэгтэй бараа нэмэхэд QR жагсаалт; давхар/хэтэрсэн QR татгалзана; тоо багасвал таслагдана", () => {
  let key = 0;
  const added = addToCart([], { id: "i1", code: "A1", name: "Архи", unit: "ш", salesPrice: 30_000, exciseStamped: true }, () => `k${++key}`, 2)!;
  let cart: CartRow[] = added.cart;
  assert.equal(cart[0].exciseStamped, true);
  assert.deepEqual(cart[0].stockQr, []);
  assert.match(cartStockQrProblem(cart, true)!, /0\/2/);
  assert.equal(cartStockQrProblem(cart, false), null, "eBarimt-гүй бол хаахгүй");

  const first = addStockQr(cart, added.key, QR1);
  assert.ok("cart" in first);
  cart = first.cart;
  const dup = addStockQr(cart, added.key, ` ${QR1}`);
  assert.ok("error" in dup && /аль хэдийн/.test(dup.error));
  const second = addStockQr(cart, added.key, QR2);
  assert.ok("cart" in second);
  cart = second.cart;
  assert.equal(cartStockQrProblem(cart, true), null);
  const extra = addStockQr(cart, added.key, QR3);
  assert.ok("error" in extra && /бүгд уншигдсан/.test(extra.error));

  cart = setLineQuantity(cart, added.key, 1);
  assert.deepEqual(cart[0].stockQr, [QR1]);
  cart = removeStockQr(cart, added.key, QR1);
  assert.deepEqual(cart[0].stockQr, []);

  // Тэмдэггүй бараанд талбар нэмэгдэхгүй.
  const plain = addToCart([], { id: "i2", code: "B1", name: "Талх", unit: "ш", salesPrice: 1_000 }, () => "p1")!;
  assert.equal(plain.cart[0].exciseStamped, undefined);
  assert.equal(cartStockQrProblem(plain.cart, true), null);
});

// Кассын дэлгэцийн UI дүрмүүдийг статикаар сахиулна (DB, React шаардахгүй).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync("components/pos/pos-checkout-view.tsx", "utf8");
const panel = readFileSync("components/pos/checkout/product-panel.tsx", "utf8");

test("агуулах ээлжид түгжээтэй: кассын толгойд агуулах сонгогч байхгүй", () => {
  assert.doesNotMatch(view, /onWarehouseChange|setWarehouseChoice/, "ээлжийн дундуур агуулах солих зам буцаж орж ирсэн");
  assert.match(view, /shift\?\.warehouseId/, "агуулах ээлжээс уншигдах ёстой");
});

test("үнэгүй бараа «Үнэ тохируулаагүй» гэж харагдана («үнэгүй» = төлбөргүй гэж андуурагдана)", () => {
  assert.match(panel, /"Үнэ тохируулаагүй"/);
  assert.doesNotMatch(panel, /"үнэгүй"/);
});

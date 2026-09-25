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

const payment = readFileSync("components/pos/payment-dialog.tsx", "utf8");
const receiptPreview = readFileSync("components/pos/receipt-preview.tsx", "utf8");

test("төлбөрийн диалог «Бэлэн = төлөх дүн» мөртэй нээгдэнэ (бөөрөнхийлсөн)", () => {
  assert.match(payment, /useState<PaymentRow\[\]>\(\(\) =>/);
  assert.match(payment, /kind === "cash"/);
  assert.match(payment, /roundToCashUnit\(total, cashRoundingUnit\)\.rounded/);
});

test("төлбөрийн хэлбэр ижил хэмжээтэй том товч; хөндөөгүй бэлэн мөр өөр хэлбэрээр солигдоно", () => {
  assert.match(payment, /grid grid-cols-2 gap-2 sm:grid-cols-3/);
  assert.match(payment, /current\.length === 1 && current\[0\]\.auto/);
  assert.doesNotMatch(payment, /\+10,000|bumpCash/, "дэвсгэртийн хурдан товч хасагдсан — дүнг гараар");
});

test("баримт автоматаар хэвлэгдэнэ, хэвлээгүй хаавал сугалаа/QR-ийн анхааруулга", () => {
  assert.match(receiptPreview, /autoPrint/);
  assert.match(receiptPreview, /Баримт хэвлээгүй байна/);
  assert.match(view, /autoPrint=\{autoPrint\}/, "кассын дэлгэц автомат хэвлэлтийг дамжуулна");
});

test("сүлжээ тасарвал ил мэдэгдэж, төлбөр хаагдана", () => {
  assert.match(view, /navigator\.onLine/);
  assert.match(view, /Интернэт холболт тасарсан/);
  assert.match(view, /const canPay = [^;]*online/);
});

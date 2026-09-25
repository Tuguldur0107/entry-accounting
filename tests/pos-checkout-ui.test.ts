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
  assert.match(view, /const canPay =\s[^;]*online/);
});

const vatBar = readFileSync("components/pos/checkout/vat-receipt-bar.tsx", "utf8");
const salePanel = readFileSync("components/panel/pos-sale-panel.tsx", "utf8");
const salesList = readFileSync("components/pos/sales-list-view.tsx", "utf8");

test("«НӨАТ» мөр: анхдагч асаалттай, Хувь хүн/ААН, ТТД шууд (үндсэн) эсвэл 7 оронтой регистрээр нэр татна", () => {
  assert.match(view, /useState\(true\);\s*\n\s*const \[nonVatReason/, "НӨАТ анхдагч асаалттай");
  assert.match(view, /<VatReceiptBar/);
  assert.match(view, /lookupEbarimtTin\(lookupRegNo\)/, "регистр бичигдмэгц ТЕГ-ийн лавлах");
  assert.match(view, /const canPay =[^;]*!buyerProblem[^;]*!nonVatProblem/);
  assert.match(vatBar, /Хувь хүн/);
  assert.match(vatBar, /ААН/);
  assert.match(vatBar, /Байгууллагын ТТД \(11 орон\) эсвэл регистр \(7 орон\)/);
  assert.match(view, /needsOrgLookup\(/, "ТТД шууд оруулсан үед ч нэрийг ТЕГ-ээс лавлана");
  assert.match(vatBar, /Шалтгаан \(заавал\)/);
  assert.doesNotMatch(payment, /lookupEbarimtTin/, "худалдан авагчийн давхар сонголт төлбөрийн диалогт байхгүй");
});

test("НӨАТ-гүй борлуулалт жагсаалт, панельд ил; eBarimt засах/илгээх нуугдана", () => {
  assert.match(salesList, /headerName: "НӨАТ баримт"/);
  assert.match(salesList, /value: "non_vat"/);
  assert.match(salePanel, /sale\.nonVat \? \(/);
});

test("QR (eBarimt баримт, QPay/нэхэмжлэх) useMemo-гоор кэшлэгдэхгүй — сан ачаалагдахаас өмнөх null үлдэж QR зурагддаггүй байв", () => {
  const qrCode = readFileSync("components/ui/qr-code.tsx", "utf8");
  assert.doesNotMatch(receiptPreview, /useMemo\(\(\) => buildQrPath/, "ReceiptQr дахин useMemo-гоор кэшлэж байна");
  assert.doesNotMatch(qrCode, /useMemo\(\(\) => buildPath/, "QrCode дахин useMemo-гоор кэшлэж байна");
  // Сугалаа/QR нэг л удаа хэвлэгддэг — сан урьдчилан ачаалагдаж, автомат хэвлэлт QR-ийг хүлээнэ
  assert.match(receiptPreview, /void ensureQrFactory\(\);/);
  assert.match(receiptPreview, /if \(hasQr\) await ensureQrFactory\(\);/);
});

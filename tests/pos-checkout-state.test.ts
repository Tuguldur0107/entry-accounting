import test from "node:test";
import assert from "node:assert/strict";

import {
  addToCart,
  adjustLineQuantity,
  cartQuantityByItem,
  filterCheckoutItems,
  MAX_PARKED_TICKETS,
  parkTicket,
  parseDiscountPercentInput,
  parseParkedTickets,
  parseQuantityInput,
  parseStoredCart,
  resolveScan,
  setLineDiscountAmount,
  setLineDiscountPercent,
  setLineQuantity,
  type CartRow,
  type ParkedTicket,
} from "../lib/pos/checkout-state";

const cola = { id: "i-cola", code: "CL-01", name: "Кола 0.5л", unit: "ш", barcode: "4870001", categoryCode: "DRINK", salesPrice: 2500 };
const bread = { id: "i-bread", code: "BR-01", name: "Талх", unit: "ш", barcode: null, categoryCode: "FOOD", salesPrice: 1800 };
const noPrice = { id: "i-np", code: "NP-01", name: "Үнэгүй бараа", unit: "ш", barcode: null, categoryCode: null, salesPrice: null };
const items = [cola, bread, noPrice];

function keyGen() {
  let n = 0;
  return () => `L${++n}`;
}

test("addToCart: ижил бараа тоог нэмэгдүүлнэ, үнэгүй бараа нэмэгдэхгүй", () => {
  const next = keyGen();
  const first = addToCart([], cola, next)!;
  const second = addToCart(first.cart, cola, next)!;
  assert.equal(second.cart.length, 1);
  assert.equal(second.cart[0].quantity, 2);
  assert.equal(second.key, "L1");
  assert.equal(addToCart(second.cart, noPrice, next), null);
  const third = addToCart(second.cart, bread, next, 3)!;
  assert.equal(third.cart.length, 2);
  assert.equal(third.cart[1].quantity, 3);
});

test("addToCart: хөнгөлөлттэй мөрд нэгтгэхгүй — шинэ мөр", () => {
  const next = keyGen();
  let cart = addToCart([], cola, next)!.cart;
  cart = setLineDiscountPercent(cart, "L1", 10);
  cart = addToCart(cart, cola, next)!.cart;
  assert.equal(cart.length, 2);
  assert.equal(cart[1].manualDiscountPercent, null);
  assert.equal(cart[1].unitPrice, 2500);
});

test("касс үнэ засахгүй: жинлэдэг бараанд зөвхөн тоо (жин) бичигдэнэ, үнэ барааных", () => {
  const next = keyGen();
  // Жинлэдэг бараа: кг-ийн үнэ = борлуулах үнэ, жин = тоо хэмжээ
  const meat = { id: "i-meat", code: "MT-01", name: "Үхрийн мах", unit: "кг", barcode: null, categoryCode: null, salesPrice: 18000 };
  let cart = addToCart([], meat, next)!.cart;
  cart = setLineQuantity(cart, "L1", parseQuantityInput("1,35")!);
  assert.equal(cart[0].quantity, 1.35);
  assert.equal(cart[0].unitPrice, 18000);
});

test("parseStoredCart: хуучин паркийн гараар зассан үнэ барааны үнэ рүү буцна", () => {
  const raw = {
    cart: [{ key: "L1", itemId: "i-cola", quantity: 1, unitPrice: 2000, priceOverridden: true, salesPrice: 2500 }],
  };
  const parsed = parseStoredCart(raw, new Set(["i-cola"]))!;
  assert.equal(parsed.cart[0].unitPrice, 2500);
  assert.equal("priceOverridden" in parsed.cart[0], false);
});

test("тоо 0 → мөр хасагдана; −/+ засварлана", () => {
  const next = keyGen();
  let cart = addToCart([], cola, next)!.cart;
  cart = adjustLineQuantity(cart, "L1", 2);
  assert.equal(cart[0].quantity, 3);
  cart = setLineQuantity(cart, "L1", 0);
  assert.equal(cart.length, 0);
  assert.deepEqual(setLineQuantity(cart, "L9", 5), []);
});

test("хөнгөлөлт: % ба ₮ харилцан бие биеэ арилгана, 100-аас их хүчингүй", () => {
  const next = keyGen();
  let cart = addToCart([], cola, next)!.cart;
  cart = setLineDiscountPercent(cart, "L1", 10);
  assert.equal(cart[0].manualDiscountPercent, 10);
  cart = setLineDiscountAmount(cart, "L1", 300);
  assert.equal(cart[0].manualDiscountPercent, null);
  assert.equal(cart[0].manualDiscountAmount, 300);
  const unchanged = setLineDiscountPercent(cart, "L1", 150);
  assert.equal(unchanged, cart);
  cart = setLineDiscountPercent(cart, "L1", 0);
  assert.equal(cart[0].manualDiscountPercent, null);
  assert.equal(cart[0].manualDiscountAmount, 300, "0% нь дүнгийн хөнгөлөлтийг арилгахгүй");
});

test("parseQuantityInput: таслал/цэг, хоосон ба гажиг → null, 0 → мөр хасах", () => {
  assert.equal(parseQuantityInput("3"), 3);
  assert.equal(parseQuantityInput(" 1,5 "), 1.5);
  assert.equal(parseQuantityInput("0.25"), 0.25);
  assert.equal(parseQuantityInput(".5"), 0.5);
  assert.equal(parseQuantityInput("2."), 2);
  assert.equal(parseQuantityInput("1.23456"), 1.2346);
  assert.equal(parseQuantityInput("0"), 0);
  assert.equal(parseQuantityInput(""), null);
  assert.equal(parseQuantityInput("-2"), null);
  assert.equal(parseQuantityInput("abc"), null);
  assert.equal(parseQuantityInput("1.2.3"), null);
  assert.equal(parseQuantityInput("1e3"), null);
  assert.equal(parseQuantityInput("2000000"), null);
});

test("parseDiscountPercentInput: хоосон/0 → арилгах, 0–100, гажиг → undefined", () => {
  assert.equal(parseDiscountPercentInput(""), null);
  assert.equal(parseDiscountPercentInput("0"), null);
  assert.equal(parseDiscountPercentInput("15"), 15);
  assert.equal(parseDiscountPercentInput("7,5"), 7.5);
  assert.equal(parseDiscountPercentInput("150"), undefined);
  assert.equal(parseDiscountPercentInput("-1"), undefined);
  assert.equal(parseDiscountPercentInput("x"), undefined);
});

test("filterCheckoutItems: бүлэг + хайлт, яг таарсан код эхэнд", () => {
  assert.deepEqual(filterCheckoutItems(items, "", "DRINK").map((i) => i.id), ["i-cola"]);
  assert.deepEqual(filterCheckoutItems(items, "", null).length, 3);
  const more = [...items, { ...cola, id: "i-cola2", code: "CL-010", barcode: "4870002" }];
  const hits = filterCheckoutItems(more, "cl-01", null);
  assert.equal(hits[0].id, "i-cola", "яг таарсан код эхэнд");
  assert.equal(hits[1].id, "i-cola2");
  assert.deepEqual(filterCheckoutItems(items, "талх", "DRINK"), [], "бүлгийн гадна хайхгүй");
});

test("resolveScan: barcode → код → эхний илэрц; бүлгийн шүүлтээс үл хамаарна", () => {
  assert.equal(resolveScan(items, "4870001")?.id, "i-cola");
  assert.equal(resolveScan(items, "br-01")?.id, "i-bread");
  assert.equal(resolveScan(items, "Тал")?.id, "i-bread");
  assert.equal(resolveScan(items, "zzz"), null);
  assert.equal(resolveScan(items, "  "), null);
});

test("parseStoredCart: гажиг мөр, устсан бараа хасагдана; хоосон бол null", () => {
  const known = new Set(["i-cola"]);
  const raw = {
    cart: [
      { key: "L1", itemId: "i-cola", code: "CL-01", name: "Кола", unit: "ш", quantity: 2, unitPrice: 2500, salesPrice: 2500, manualDiscountPercent: 150 },
      { key: "L2", itemId: "i-gone", quantity: 1, unitPrice: 100 },
      { key: "L3", itemId: "i-cola", quantity: 0, unitPrice: 2500 },
      "junk",
    ],
    couponCodes: ["PROMO", 5],
    receiptDiscountMode: "amount",
    receiptDiscountValue: "500",
    customerId: "c1",
  };
  const parsed = parseStoredCart(raw, known)!;
  assert.equal(parsed.cart.length, 1);
  assert.equal(parsed.cart[0].manualDiscountPercent, null, "буруу хувь хаягдана");
  assert.deepEqual(parsed.couponCodes, ["PROMO"]);
  assert.equal(parsed.receiptDiscountMode, "amount");
  assert.equal(parseStoredCart({ cart: [] }, known), null);
  assert.equal(parseStoredCart("nope", known), null);
});

test("парк: эхэнд нэмэгдэж, ижил id солигдож, MAX хязгаарлагдана", () => {
  const known = new Set(["i-cola"]);
  const row: CartRow = { key: "L1", itemId: "i-cola", code: "CL-01", name: "Кола", unit: "ш", quantity: 1, unitPrice: 2500, manualDiscountPercent: null, manualDiscountAmount: null };
  const make = (id: string): ParkedTicket => ({ id, parkedAt: "2026-09-19T10:00:00Z", label: "", cart: [row], couponCodes: [], receiptDiscountMode: "percent", receiptDiscountValue: "", customerId: "", lineCount: 1, total: 2500 });
  let list: ParkedTicket[] = [];
  for (let i = 0; i < MAX_PARKED_TICKETS + 3; i++) list = parkTicket(list, make(`p${i}`));
  assert.equal(list.length, MAX_PARKED_TICKETS);
  assert.equal(list[0].id, `p${MAX_PARKED_TICKETS + 2}`);
  list = parkTicket(list, { ...make(list[3].id), label: "дахин" });
  assert.equal(list[0].label, "дахин");
  assert.equal(list.filter((t) => t.id === list[0].id).length, 1);
  const parsed = parseParkedTickets(JSON.parse(JSON.stringify(list)), known);
  assert.equal(parsed.length, MAX_PARKED_TICKETS);
  assert.equal(parsed[0].total, 2500);
  assert.deepEqual(parseParkedTickets([{ id: "x", cart: [] }], known), []);
});

test("cartQuantityByItem: мөрүүд бараагаар нэгтгэгдэнэ", () => {
  const next = keyGen();
  let cart = addToCart([], cola, next)!.cart;
  cart = setLineDiscountPercent(cart, "L1", 5);
  cart = addToCart(cart, cola, next, 2)!.cart;
  assert.equal(cartQuantityByItem(cart).get("i-cola"), 3);
});

test("ангиллын chip дэд ангиллын барааг ч харуулна (categoryPath)", async () => {
  const { filterCheckoutItems } = await import("../lib/pos/checkout-state");
  const items = [
    { id: "1", code: "T1", name: "Тараг", unit: "ш", salesPrice: 1, categoryCode: "TARAG", categoryPath: ["TARAG", "DAIRY", "FOOD"] },
    { id: "2", code: "S1", name: "Саван", unit: "ш", salesPrice: 1, categoryCode: "HOME", categoryPath: ["HOME"] },
  ];
  assert.deepEqual(filterCheckoutItems(items, "", "FOOD").map((item) => item.id), ["1"]);
  assert.deepEqual(filterCheckoutItems(items, "", "DAIRY").map((item) => item.id), ["1"]);
  assert.deepEqual(filterCheckoutItems(items, "", "HOME").map((item) => item.id), ["2"]);
});

test("мөрийн дүн шууд: хуучин санал ижил мөрд хүчинтэй, өөрчлөгдсөн мөрд ойролцоо дүн", async () => {
  const { resolveLineAmounts, estimateLineTotal } = await import("../lib/pos/checkout-state");
  const row: CartRow = { key: "L1", itemId: "i-cola", code: "CL-01", name: "Кола", unit: "ш", quantity: 2, unitPrice: 2500, manualDiscountPercent: null, manualDiscountAmount: null };
  const quoted = { itemId: "i-cola", quantity: 2, manualDiscountPercent: null, manualDiscountAmount: null, discountAmount: 500, lineTotal: 4500 };
  // Шинэ санал — серверийнх (автомат хөнгөлөлт орсон)
  assert.deepEqual(resolveLineAmounts(row, quoted, true), { lineTotal: 4500, discountAmount: 500, estimated: false });
  // Хуучин санал, мөр өөрчлөгдөөгүй — хэвээр (анивчихгүй)
  assert.equal(resolveLineAmounts(row, quoted, false).lineTotal, 4500);
  // Тоо өөрчлөгдсөн → ойролцоо дүн шууд
  const bumped = { ...row, quantity: 3 };
  assert.deepEqual(resolveLineAmounts(bumped, quoted, false), { lineTotal: 7500, discountAmount: 0, estimated: true });
  // Индекс шилжиж өөр бараа таарвал хэрэглэхгүй
  assert.equal(resolveLineAmounts({ ...row, itemId: "i-bread" }, quoted, false).estimated, true);
  // Гар хөнгөлөлт: хувь ба дүн
  assert.equal(estimateLineTotal({ ...row, manualDiscountPercent: 10 }), 4500);
  assert.equal(estimateLineTotal({ ...row, manualDiscountAmount: 6000 }), 0, "сөрөг болохгүй");
  assert.equal(resolveLineAmounts({ ...row, manualDiscountPercent: 10 }, quoted, false).estimated, true, "хөнгөлөлт өөрчлөгдвөл хуучин санал хүчингүй");
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  allocateReceiptDiscount,
  applyDiscounts,
  approvalAuditNote,
  ruleWindowMatches,
} from "../lib/pos/discounts";
import type { CartContext, CartLine, DiscountRule } from "../lib/pos/types";

function rule(partial: Partial<DiscountRule> & Pick<DiscountRule, "id" | "ruleType">): DiscountRule {
  return {
    code: partial.id.toUpperCase(),
    name: partial.id,
    scope: "all",
    scopeRef: null,
    valueType: "percent",
    value: 0,
    minQty: null,
    minAmount: null,
    buyQty: null,
    getQty: null,
    tiers: null,
    dateFrom: null,
    dateTo: null,
    timeFrom: null,
    timeTo: null,
    weekdays: null,
    couponCode: null,
    maxUsesTotal: null,
    maxUsesPerCustomer: null,
    usedCount: 0,
    stackable: false,
    priority: 100,
    requiresApproval: false,
    isActive: true,
    ...partial,
  };
}

function line(partial: Partial<CartLine> & Pick<CartLine, "key" | "itemId" | "quantity" | "unitPrice">): CartLine {
  return {
    itemCode: partial.itemId,
    itemName: partial.itemId,
    unit: "ш",
    categoryCode: null,
    vatMode: "standard",
    minSalesPrice: null,
    ...partial,
  };
}

const ctx: CartContext = {
  customerGroup: null,
  couponCodes: [],
  date: "2026-09-19",
  time: "10:30",
  weekday: 6,
  discountStacking: "best_single",
  maxManualDiscountPercent: 10,
  maxTotalDiscountPercent: 50,
};

// Санал §6-ийн жишээ: LT-01 1 × 1,650,000; MN-01 4 × 33,000; 3+1 эхлээд, дараа VIP 5%.
const proposalCart = [
  line({ key: "a", itemId: "LT-01", quantity: 1, unitPrice: 1_650_000 }),
  line({ key: "b", itemId: "MN-01", quantity: 4, unitPrice: 33_000 }),
];

test("дүрэмгүй сагс: хөнгөлөлт 0, subtotal = gross", () => {
  const result = applyDiscounts(proposalCart, [], ctx);
  assert.equal(result.grossAmount, 1_782_000);
  assert.equal(result.discountTotal, 0);
  assert.equal(result.subtotal, 1_782_000);
  assert.deepEqual(result.approvalReasons, []);
});

test("санал §6: 3+1 (MN-01) → VIP 5% = Σ 120,450, төлөх 1,661,550", () => {
  const rules = [
    rule({ id: "bogo", ruleType: "buy_x_get_y", scope: "item", scopeRef: "MN-01", buyQty: 3, getQty: 1 }),
    rule({ id: "vip", ruleType: "customer_group", scope: "customer_group", scopeRef: "VIP", value: 5 }),
  ];
  const result = applyDiscounts(proposalCart, rules, { ...ctx, customerGroup: "VIP" });
  assert.equal(result.discountTotal, 120_450);
  assert.equal(result.subtotal, 1_661_550);
  const mn = result.lines.find((entry) => entry.itemId === "MN-01")!;
  // 33,000 үнэгүй + (132,000 − 33,000) × 5% = 4,950
  assert.equal(mn.discountAmount, 37_950);
  assert.equal(mn.discountDetail.length, 2);
  const lt = result.lines.find((entry) => entry.itemId === "LT-01")!;
  assert.equal(lt.discountAmount, 82_500);
  assert.deepEqual(result.appliedRuleIds.sort(), ["bogo", "vip"]);
});

test("VIP бүлэггүй харилцагчид customer_group дүрэм ажиллахгүй", () => {
  const rules = [rule({ id: "vip", ruleType: "customer_group", scope: "customer_group", scopeRef: "VIP", value: 5 })];
  const result = applyDiscounts(proposalCart, rules, ctx);
  assert.equal(result.discountTotal, 0);
});

test("best_single: stackable=false дүрмүүдээс хамгийн ихийг л, stackable нэмэгдэнэ", () => {
  const rules = [
    rule({ id: "p5", ruleType: "line_percent", value: 5 }),
    rule({ id: "p10", ruleType: "line_percent", value: 10 }),
    rule({ id: "s2", ruleType: "line_percent", value: 2, stackable: true }),
  ];
  const cart = [line({ key: "a", itemId: "X", quantity: 1, unitPrice: 100_000 })];
  const result = applyDiscounts(cart, rules, ctx);
  // 10% (10,000) + дараа нь үлдэгдэл 90,000 × 2% = 1,800
  assert.equal(result.discountTotal, 11_800);
  assert.deepEqual(result.appliedRuleIds.sort(), ["p10", "s2"]);
});

test("cumulative: бүх мөрийн дүрэм priority дарааллаар үлдэгдэл дээр", () => {
  const rules = [
    rule({ id: "p10", ruleType: "line_percent", value: 10, priority: 1 }),
    rule({ id: "p5", ruleType: "line_percent", value: 5, priority: 2 }),
  ];
  const cart = [line({ key: "a", itemId: "X", quantity: 1, unitPrice: 100_000 })];
  const result = applyDiscounts(cart, rules, { ...ctx, discountStacking: "cumulative" });
  assert.equal(result.discountTotal, 14_500);
});

test("fixed_price урамшууллын үнэ + хугацааны цонх", () => {
  const rules = [
    rule({
      id: "promo",
      ruleType: "fixed_price",
      scope: "item",
      scopeRef: "X",
      valueType: "fixed_price",
      value: 80_000,
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    }),
  ];
  const cart = [line({ key: "a", itemId: "X", quantity: 2, unitPrice: 100_000 })];
  assert.equal(applyDiscounts(cart, rules, ctx).discountTotal, 40_000);
  assert.equal(applyDiscounts(cart, rules, { ...ctx, date: "2026-10-01" }).discountTotal, 0);
});

test("qty_tier: 10+ ширхэгт 5%, 50+ ширхэгт 10%", () => {
  const rules = [
    rule({
      id: "tier",
      ruleType: "qty_tier",
      tiers: [
        { minQty: 10, percent: 5 },
        { minQty: 50, percent: 10 },
      ],
    }),
  ];
  assert.equal(
    applyDiscounts([line({ key: "a", itemId: "X", quantity: 9, unitPrice: 1_000 })], rules, ctx).discountTotal,
    0
  );
  assert.equal(
    applyDiscounts([line({ key: "a", itemId: "X", quantity: 10, unitPrice: 1_000 })], rules, ctx).discountTotal,
    500
  );
  assert.equal(
    applyDiscounts([line({ key: "a", itemId: "X", quantity: 60, unitPrice: 1_000 })], rules, ctx).discountTotal,
    6_000
  );
});

test("сагсны босго: ≥ 500,000 → 3% баримтын түвшинд pro-rata, бөөрөнхийлөл том мөрөнд", () => {
  const rules = [rule({ id: "basket", ruleType: "basket_threshold", minAmount: 500_000, value: 3 })];
  const cart = [
    line({ key: "a", itemId: "A", quantity: 1, unitPrice: 333_333 }),
    line({ key: "b", itemId: "B", quantity: 1, unitPrice: 333_333 }),
  ];
  const result = applyDiscounts(cart, rules, ctx);
  assert.equal(result.discountTotal, 19_999.98); // 666,666 × 3% — цент хадгална
  assert.equal(result.receiptDiscounts.length, 1);
  const sum = result.lines.reduce((total, entry) => total + entry.discountAmount, 0);
  assert.equal(Math.round(sum * 100) / 100, 19_999.98);
  const below = applyDiscounts([cart[0]], rules, ctx);
  assert.equal(below.discountTotal, 0);
});

test("купон: код таарвал л; буруу код → approvalReasons", () => {
  const rules = [rule({ id: "cp", ruleType: "coupon", couponCode: "SEPT10", valueType: "amount", value: 10_000 })];
  const cart = [line({ key: "a", itemId: "X", quantity: 1, unitPrice: 100_000 })];
  const ok = applyDiscounts(cart, rules, { ...ctx, couponCodes: ["sept10"] });
  assert.equal(ok.discountTotal, 10_000);
  assert.equal(ok.receiptDiscounts[0]?.kind, "coupon");
  const bad = applyDiscounts(cart, rules, { ...ctx, couponCodes: ["NOPE"] });
  assert.equal(bad.discountTotal, 0);
  assert.ok(bad.approvalReasons.some((reason) => reason.includes("NOPE")));
  const spent = applyDiscounts(cart, [{ ...rules[0], maxUsesTotal: 1, usedCount: 1 }], {
    ...ctx,
    couponCodes: ["SEPT10"],
  });
  assert.equal(spent.discountTotal, 0);
});

test("гар хөнгөлөлт: хязгаараас хэтэрвэл менежерийн зөвшөөрөл; доод үнэ", () => {
  const cart = [
    line({ key: "a", itemId: "X", quantity: 1, unitPrice: 100_000, manualDiscountPercent: 15, minSalesPrice: 90_000 }),
  ];
  const result = applyDiscounts(cart, [], ctx);
  assert.equal(result.discountTotal, 15_000);
  assert.ok(result.approvalReasons.some((reason) => reason.includes("15.0%")));
  assert.ok(result.approvalReasons.some((reason) => reason.includes("доод үнэ")));
  const fine = applyDiscounts(
    [line({ key: "a", itemId: "X", quantity: 1, unitPrice: 100_000, manualDiscountAmount: 5_000 })],
    [],
    ctx
  );
  assert.equal(fine.discountTotal, 5_000);
  assert.deepEqual(fine.approvalReasons, []);
});

test("хөнгөлөлт мөрийн дүнгээс хэтрэхгүй; нийт тааз", () => {
  const rules = [rule({ id: "big", ruleType: "line_amount", valueType: "amount", value: 500_000 })];
  const cart = [line({ key: "a", itemId: "X", quantity: 1, unitPrice: 100_000 })];
  const result = applyDiscounts(cart, rules, ctx);
  assert.equal(result.discountTotal, 100_000);
  assert.equal(result.subtotal, 0);
  assert.ok(result.approvalReasons.some((reason) => reason.includes("таазаас")));
});

test("цагийн цонх: шөнө дамнасан 22:00–02:00, гараг", () => {
  const window = { dateFrom: null, dateTo: null, timeFrom: "22:00", timeTo: "02:00", weekdays: "6,7" };
  assert.equal(ruleWindowMatches(window, { date: "2026-09-19", time: "23:30", weekday: 6 }), true);
  assert.equal(ruleWindowMatches(window, { date: "2026-09-19", time: "01:00", weekday: 7 }), true);
  assert.equal(ruleWindowMatches(window, { date: "2026-09-19", time: "12:00", weekday: 6 }), false);
  assert.equal(ruleWindowMatches(window, { date: "2026-09-19", time: "23:30", weekday: 2 }), false);
});

test("allocateReceiptDiscount: суурьаас хэтрэхгүй, нийлбэр яг таарна", () => {
  const lines = applyDiscounts(
    [
      line({ key: "a", itemId: "A", quantity: 3, unitPrice: 10_000 }),
      line({ key: "b", itemId: "B", quantity: 1, unitPrice: 5_000 }),
    ],
    [],
    ctx
  ).lines;
  const applied = allocateReceiptDiscount(lines, 1_000, { ruleId: null, ruleCode: null, kind: "receipt" });
  assert.equal(applied, 1_000);
  assert.equal(lines[0].discountAmount + lines[1].discountAmount, 1_000);
  const capped = allocateReceiptDiscount(lines, 1_000_000, { ruleId: null, ruleCode: null, kind: "receipt" });
  assert.equal(capped, 34_000);
});

test("Аудит: менежерийн зөвшөөрлийн аудитын тэмдэглэл", () => {
  assert.equal(approvalAuditNote([]), "");
  assert.equal(
    approvalAuditNote(["15% нь 10%-иас их"]),
    " — менежерийн зөвшөөрөл (pos:post эрхээр): 15% нь 10%-иас их"
  );
  assert.match(approvalAuditNote(["a", "b"], "ai"), /AI\/MCP-ийн managerApproval-аар\): a; b$/);
});

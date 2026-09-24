// Хөнгөлөлтийн хөдөлгөгч — ЦЭВЭР (DB-гүй, тесттэй): docs/pos/00-proposal.md §3.5.
//
// Дараалал: fixed_price → мөрийн дүрмүүд (line_percent / line_amount /
// qty_tier / time_window) → buy_x_get_y → customer_group → coupon →
// basket_threshold (баримтын түвшин, pro-rata) → гар хөнгөлөлт (мөр, баримт).
//
// Давхцах бодлого (pos_settings.discountStacking):
//   best_single — stackable=false дүрмүүдээс мөр бүрд ХАМГИЙН ИХ нэгийг л,
//                 дээр нь stackable дүрмүүд нэмэгдэнэ
//   cumulative  — бүгд дарааллаараа (priority) үлдэгдэл дүн дээр нэмэгдэнэ
//
// Хөнгөлөлт ХЭЗЭЭ Ч мөрийн дүнгээс хэтрэхгүй; НӨАТ хөнгөлөлтийн ДАРААХ
// дүнгээс задарна (sale-math.ts). Менежерийн зөвшөөрөл шаардах нөхцөлийг
// approvalReasons-д буцаана — хөдөлгөгч өөрөө хориглохгүй, action шийднэ.

import { roundMoney as round2 } from "@/lib/arap/accounting";
import type {
  CartContext,
  CartLine,
  DiscountDetail,
  DiscountResult,
  DiscountRule,
  PricedLine,
  ReceiptDiscount,
} from "./types";

/** Мөрийн (баримтын биш) дүрмийн төрлүүд. */
const LINE_RULE_TYPES = new Set([
  "line_percent",
  "line_amount",
  "qty_tier",
  "time_window",
]);

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Огноо / цаг / гарагийн цонх — бүх дүрэмд НӨХЦӨЛ болж үйлчилнэ. */
export function ruleWindowMatches(
  rule: Pick<DiscountRule, "dateFrom" | "dateTo" | "timeFrom" | "timeTo" | "weekdays">,
  ctx: Pick<CartContext, "date" | "time" | "weekday">
): boolean {
  if (rule.dateFrom && ctx.date < rule.dateFrom) return false;
  if (rule.dateTo && ctx.date > rule.dateTo) return false;
  if (rule.timeFrom && rule.timeTo) {
    // Шөнө дамнасан цонх (22:00–02:00) мөн дэмжинэ.
    const inWindow =
      rule.timeFrom <= rule.timeTo
        ? ctx.time >= rule.timeFrom && ctx.time <= rule.timeTo
        : ctx.time >= rule.timeFrom || ctx.time <= rule.timeTo;
    if (!inWindow) return false;
  } else if (rule.timeFrom && ctx.time < rule.timeFrom) return false;
  else if (rule.timeTo && ctx.time > rule.timeTo) return false;
  if (rule.weekdays?.trim()) {
    const days = rule.weekdays
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((day) => Number.isInteger(day));
    if (days.length > 0 && !days.includes(ctx.weekday)) return false;
  }
  return true;
}

/** Дүрэм тухайн мөрөнд хамаарах эсэх (scope). */
export function ruleAppliesToLine(
  rule: Pick<DiscountRule, "scope" | "scopeRef">,
  line: Pick<CartLine, "itemId" | "categoryCode" | "categoryPath">,
  customerGroup: string | null
): boolean {
  switch (rule.scope) {
    case "all":
      return true;
    case "category":
      // Олон түвшинтэй ангилал: эцэг ангиллын дүрэм дэд ангиллын бараанд ч.
      if (!rule.scopeRef) return false;
      return line.categoryPath
        ? line.categoryPath.includes(rule.scopeRef)
        : line.categoryCode === rule.scopeRef;
    case "item":
      return !!rule.scopeRef && line.itemId === rule.scopeRef;
    case "customer_group":
      return !!rule.scopeRef && customerGroup === rule.scopeRef;
    default:
      return false;
  }
}

/** Хэрэглээний тоо дуусаагүй эсэх (купон, урамшуулал). */
function usesRemain(rule: DiscountRule): boolean {
  if (rule.maxUsesTotal != null && rule.usedCount >= rule.maxUsesTotal) return false;
  return true;
}

/** Тухайн мөрөнд НЭГ дүрмийн өгөх хөнгөлөлт (одоогийн үлдэгдэл дүн дээр). */
function lineRuleDiscount(
  rule: DiscountRule,
  line: CartLine,
  remaining: number
): number {
  const gross = round2(line.quantity * line.unitPrice);
  if (rule.minQty != null && line.quantity < rule.minQty) return 0;
  if (rule.minAmount != null && gross < rule.minAmount) return 0;
  switch (rule.ruleType) {
    case "fixed_price": {
      const price = rule.valueType === "fixed_price" || rule.valueType === "amount" ? rule.value : line.unitPrice;
      if (!(price >= 0) || price >= line.unitPrice) return 0;
      return round2((line.unitPrice - price) * line.quantity);
    }
    case "qty_tier": {
      const tiers = [...(rule.tiers ?? [])]
        .filter((tier) => Number.isFinite(tier.minQty))
        .sort((a, b) => a.minQty - b.minQty);
      const tier = [...tiers].reverse().find((entry) => line.quantity >= entry.minQty);
      if (!tier) return 0;
      if (tier.price != null && tier.price < line.unitPrice)
        return round2((line.unitPrice - tier.price) * line.quantity);
      if (tier.percent != null && tier.percent > 0)
        return round2((remaining * tier.percent) / 100);
      return 0;
    }
    case "line_percent":
    case "time_window":
    case "customer_group":
    case "coupon":
    case "line_amount": {
      if (rule.valueType === "percent")
        return round2((remaining * clamp(rule.value, 0, 100)) / 100);
      if (rule.valueType === "fixed_price") {
        if (rule.value >= line.unitPrice) return 0;
        return round2((line.unitPrice - rule.value) * line.quantity);
      }
      // amount — нэгж тутамд ₮
      return round2(rule.value * line.quantity);
    }
    default:
      return 0;
  }
}

/** Мөрийн хөнгөлөлтийг дүнгээс хэтрүүлэхгүй нэмнэ. */
function addLineDiscount(
  line: PricedLine,
  amount: number,
  detail: Omit<DiscountDetail, "amount">
) {
  const room = round2(line.lineGross - line.discountAmount);
  const applied = round2(clamp(amount, 0, room));
  if (applied <= 0) return 0;
  line.discountAmount = round2(line.discountAmount + applied);
  line.discountDetail.push({ ...detail, amount: applied });
  return applied;
}

/**
 * Баримтын түвшний дүнг мөрүүдэд ҮЛДЭГДЭЛ дүнгийн жингээр хуваарилна;
 * бөөрөнхийллийг хамгийн том мөр шингээнэ (applyInclusiveVatToLines-тэй ижил).
 */
export function allocateReceiptDiscount(
  lines: PricedLine[],
  amount: number,
  detail: Omit<DiscountDetail, "amount">
): number {
  const remaining = lines.map((line) => round2(line.lineGross - line.discountAmount));
  const base = remaining.reduce((sum, value) => sum + value, 0);
  if (!(amount > 0) || !(base > 0)) return 0;
  const target = round2(Math.min(amount, base));
  const shares = remaining.map((value) => round2((target * value) / base));
  const drift = round2(target - shares.reduce((sum, value) => sum + value, 0));
  if (Math.abs(drift) >= 0.01) {
    let largest = 0;
    remaining.forEach((value, index) => {
      if (value > remaining[largest]) largest = index;
    });
    shares[largest] = round2(shares[largest] + drift);
  }
  let applied = 0;
  lines.forEach((line, index) => {
    applied += addLineDiscount(line, shares[index], detail);
  });
  return round2(applied);
}

/**
 * Хөнгөлөлтийн бүх дүрмийг сагсанд хэрэглэнэ. Оролтын мөрүүд ӨӨРЧЛӨГДӨХГҮЙ.
 */
export function applyDiscounts(
  cart: CartLine[],
  rules: DiscountRule[],
  ctx: CartContext
): DiscountResult {
  const lines: PricedLine[] = cart.map((line) => ({
    ...line,
    lineGross: round2(line.quantity * line.unitPrice),
    discountAmount: 0,
    discountDetail: [],
    lineTotal: 0,
  }));
  const approvalReasons: string[] = [];
  const appliedRuleIds = new Set<string>();
  const receiptDiscounts: ReceiptDiscount[] = [];
  const grossAmount = round2(lines.reduce((sum, line) => sum + line.lineGross, 0));

  const active = rules
    .filter((rule) => rule.isActive && usesRemain(rule) && ruleWindowMatches(rule, ctx))
    .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));

  const coupons = new Set(ctx.couponCodes.map((code) => code.trim().toUpperCase()).filter(Boolean));
  const couponRules = active.filter(
    (rule) =>
      rule.ruleType === "coupon" &&
      rule.couponCode &&
      coupons.has(rule.couponCode.trim().toUpperCase())
  );
  const unknownCoupons = [...coupons].filter(
    (code) => !couponRules.some((rule) => rule.couponCode!.trim().toUpperCase() === code)
  );
  for (const code of unknownCoupons)
    approvalReasons.push(`"${code}" купон хүчингүй эсвэл хугацаа дууссан`);

  const noteApplied = (rule: DiscountRule) => {
    appliedRuleIds.add(rule.id);
    if (rule.requiresApproval)
      approvalReasons.push(`"${rule.name}" дүрэм менежерийн зөвшөөрөл шаарддаг`);
  };

  // ① Урамшууллын үнэ — үнийг дарна (бусад дүрэм үүний ДАРААХ дүн дээр).
  for (const line of lines) {
    const candidates = active
      .filter((rule) => rule.ruleType === "fixed_price" && ruleAppliesToLine(rule, line, ctx.customerGroup))
      .map((rule) => ({ rule, amount: lineRuleDiscount(rule, line, line.lineGross) }))
      .filter((entry) => entry.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    const best = candidates[0];
    if (!best) continue;
    const applied = addLineDiscount(line, best.amount, {
      ruleId: best.rule.id,
      ruleCode: best.rule.code,
      kind: "auto",
    });
    if (applied > 0) noteApplied(best.rule);
  }

  // ② Мөрийн дүрмүүд — stacking бодлогоор.
  for (const line of lines) {
    const applicable = active.filter(
      (rule) => LINE_RULE_TYPES.has(rule.ruleType) && ruleAppliesToLine(rule, line, ctx.customerGroup)
    );
    if (applicable.length === 0) continue;
    if (ctx.discountStacking === "cumulative") {
      for (const rule of applicable) {
        const remaining = round2(line.lineGross - line.discountAmount);
        const applied = addLineDiscount(line, lineRuleDiscount(rule, line, remaining), {
          ruleId: rule.id,
          ruleCode: rule.code,
          kind: "auto",
        });
        if (applied > 0) noteApplied(rule);
      }
      continue;
    }
    const remaining = round2(line.lineGross - line.discountAmount);
    const exclusive = applicable
      .filter((rule) => !rule.stackable)
      .map((rule) => ({ rule, amount: lineRuleDiscount(rule, line, remaining) }))
      .filter((entry) => entry.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    if (exclusive[0]) {
      const applied = addLineDiscount(line, exclusive[0].amount, {
        ruleId: exclusive[0].rule.id,
        ruleCode: exclusive[0].rule.code,
        kind: "auto",
      });
      if (applied > 0) noteApplied(exclusive[0].rule);
    }
    for (const rule of applicable.filter((entry) => entry.stackable)) {
      const left = round2(line.lineGross - line.discountAmount);
      const applied = addLineDiscount(line, lineRuleDiscount(rule, line, left), {
        ruleId: rule.id,
        ruleCode: rule.code,
        kind: "auto",
      });
      if (applied > 0) noteApplied(rule);
    }
  }

  // ③ N авбал M үнэгүй — бараа бүрийн нийт тоогоор; үнэгүй нэгжийн үнэ =
  //    тухайн барааны хамгийн ХЯМД мөрийн нэгж үнэ (хэрэглэгчид ашигтай).
  for (const rule of active.filter((entry) => entry.ruleType === "buy_x_get_y")) {
    const buy = rule.buyQty ?? 0;
    const get = rule.getQty ?? 0;
    if (!(buy > 0) || !(get > 0)) continue;
    const byItem = new Map<string, PricedLine[]>();
    for (const line of lines)
      if (ruleAppliesToLine(rule, line, ctx.customerGroup))
        byItem.set(line.itemId, [...(byItem.get(line.itemId) ?? []), line]);
    for (const group of byItem.values()) {
      const totalQty = group.reduce((sum, line) => sum + line.quantity, 0);
      const freeUnits = Math.floor(totalQty / (buy + get)) * get;
      if (freeUnits <= 0) continue;
      const cheapest = [...group].sort((a, b) => a.unitPrice - b.unitPrice)[0];
      // Үнэгүй нэгж тухайн мөрийн хөнгөлөлтийн дараах нэгж үнээр.
      const unitAfter = cheapest.quantity > 0
        ? (cheapest.lineGross - cheapest.discountAmount) / cheapest.quantity
        : 0;
      const applied = addLineDiscount(cheapest, round2(unitAfter * Math.min(freeUnits, cheapest.quantity)), {
        ruleId: rule.id,
        ruleCode: rule.code,
        kind: "auto",
      });
      if (applied > 0) noteApplied(rule);
    }
  }

  // ④ Харилцагчийн бүлэг.
  if (ctx.customerGroup) {
    for (const rule of active.filter((entry) => entry.ruleType === "customer_group")) {
      for (const line of lines) {
        if (!ruleAppliesToLine(rule, line, ctx.customerGroup)) continue;
        const remaining = round2(line.lineGross - line.discountAmount);
        const applied = addLineDiscount(line, lineRuleDiscount(rule, line, remaining), {
          ruleId: rule.id,
          ruleCode: rule.code,
          kind: "auto",
        });
        if (applied > 0) noteApplied(rule);
      }
    }
  }

  // ⑤ Купон — scope-той бол мөрөөр, бүх бараа бол баримтын түвшинд pro-rata.
  for (const rule of couponRules) {
    if (rule.scope === "all" && rule.valueType !== "fixed_price") {
      const base = round2(lines.reduce((sum, line) => sum + line.lineGross - line.discountAmount, 0));
      if (rule.minAmount != null && base < rule.minAmount) {
        approvalReasons.push(`"${rule.couponCode}" купон ${rule.minAmount.toLocaleString("en-US")}₮-өөс дээш худалдан авалтад хүчинтэй`);
        continue;
      }
      const amount = rule.valueType === "percent" ? round2((base * rule.value) / 100) : rule.value;
      const applied = allocateReceiptDiscount(lines, amount, {
        ruleId: rule.id,
        ruleCode: rule.code,
        kind: "coupon",
      });
      if (applied > 0) {
        receiptDiscounts.push({ ruleId: rule.id, ruleCode: rule.code, kind: "coupon", amount: applied });
        noteApplied(rule);
      }
      continue;
    }
    for (const line of lines) {
      if (!ruleAppliesToLine(rule, line, ctx.customerGroup)) continue;
      const remaining = round2(line.lineGross - line.discountAmount);
      const applied = addLineDiscount(line, lineRuleDiscount(rule, line, remaining), {
        ruleId: rule.id,
        ruleCode: rule.code,
        kind: "coupon",
      });
      if (applied > 0) noteApplied(rule);
    }
  }

  // ⑥ Сагсны босго — баримтын түвшин.
  for (const rule of active.filter((entry) => entry.ruleType === "basket_threshold")) {
    const base = round2(lines.reduce((sum, line) => sum + line.lineGross - line.discountAmount, 0));
    if (rule.minAmount != null && base < rule.minAmount) continue;
    const amount = rule.valueType === "percent" ? round2((base * rule.value) / 100) : rule.value;
    const applied = allocateReceiptDiscount(lines, amount, {
      ruleId: rule.id,
      ruleCode: rule.code,
      kind: "auto",
    });
    if (applied > 0) {
      receiptDiscounts.push({ ruleId: rule.id, ruleCode: rule.code, kind: "auto", amount: applied });
      noteApplied(rule);
    }
  }

  // ⑦ Гар хөнгөлөлт — мөр.
  for (const line of lines) {
    const percent = line.manualDiscountPercent ?? null;
    const amount = line.manualDiscountAmount ?? null;
    if (!(percent && percent > 0) && !(amount && amount > 0)) continue;
    const remaining = round2(line.lineGross - line.discountAmount);
    const wanted = percent && percent > 0 ? round2((remaining * percent) / 100) : amount!;
    const applied = addLineDiscount(line, wanted, { ruleId: null, ruleCode: null, kind: "manual" });
    if (applied <= 0) continue;
    const effectivePercent = line.lineGross > 0 ? (applied / line.lineGross) * 100 : 0;
    if (effectivePercent > ctx.maxManualDiscountPercent + 1e-9)
      approvalReasons.push(
        `${line.itemName}: гар хөнгөлөлт ${effectivePercent.toFixed(1)}% нь зөвшөөрөгдсөн ${ctx.maxManualDiscountPercent}%-иас их`
      );
  }

  // ⑧ Гар хөнгөлөлт — баримт.
  {
    const percent = ctx.receiptDiscountPercent ?? null;
    const amount = ctx.receiptDiscountAmount ?? null;
    if ((percent && percent > 0) || (amount && amount > 0)) {
      const base = round2(lines.reduce((sum, line) => sum + line.lineGross - line.discountAmount, 0));
      const wanted = percent && percent > 0 ? round2((base * percent) / 100) : amount!;
      const applied = allocateReceiptDiscount(lines, wanted, {
        ruleId: null,
        ruleCode: null,
        kind: "receipt",
      });
      if (applied > 0) {
        receiptDiscounts.push({ ruleId: null, ruleCode: null, kind: "receipt", amount: applied });
        const effectivePercent = grossAmount > 0 ? (applied / grossAmount) * 100 : 0;
        if (effectivePercent > ctx.maxManualDiscountPercent + 1e-9)
          approvalReasons.push(
            `Баримтын гар хөнгөлөлт ${effectivePercent.toFixed(1)}% нь зөвшөөрөгдсөн ${ctx.maxManualDiscountPercent}%-иас их`
          );
      }
    }
  }

  // Эцсийн дүн, доод үнэ, нийт хөнгөлөлтийн тааз.
  for (const line of lines) {
    line.lineTotal = round2(line.lineGross - line.discountAmount);
    if (line.minSalesPrice != null && line.quantity > 0) {
      const unitAfter = line.lineTotal / line.quantity;
      if (unitAfter + 1e-9 < line.minSalesPrice)
        approvalReasons.push(
          `${line.itemName}: хөнгөлөлтийн дараах үнэ ${round2(unitAfter).toLocaleString("en-US")}₮ нь доод үнэ ${line.minSalesPrice.toLocaleString("en-US")}₮-өөс бага`
        );
    }
  }
  const discountTotal = round2(lines.reduce((sum, line) => sum + line.discountAmount, 0));
  if (grossAmount > 0 && (discountTotal / grossAmount) * 100 > ctx.maxTotalDiscountPercent + 1e-9)
    approvalReasons.push(
      `Нийт хөнгөлөлт ${((discountTotal / grossAmount) * 100).toFixed(1)}% нь таазаас (${ctx.maxTotalDiscountPercent}%) их`
    );

  return {
    lines,
    receiptDiscounts,
    appliedRuleIds: [...appliedRuleIds],
    approvalReasons: [...new Set(approvalReasons)],
    grossAmount,
    discountTotal,
    subtotal: round2(grossAmount - discountTotal),
  };
}

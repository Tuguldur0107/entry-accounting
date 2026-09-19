// Төлбөрийн тооцоо — ЦЭВЭР (тесттэй): docs/pos/00-proposal.md §3.4.
// Холимог төлбөр, хариулт, бэлэн бөөрөнхийлөл, зээлийн лимит, урьдчилгаа /
// бэлгийн карт / кредитийн үлдэгдэл, валютын ханш.

import { roundMoney as round2 } from "@/lib/arap/accounting";
import { roundToCashUnit } from "./sale-math";
import type {
  PaymentContext,
  PaymentInput,
  PaymentMethodView,
  PaymentPlan,
  ResolvedPayment,
} from "./types";

const EPS = 0.005;

/**
 * Төлбөрийн мөрүүдийг хэлбэрийн дүрмээр шалгаж MNT дүн, хариулт,
 * бөөрөнхийллийг тооцно. `total` = борлуулалтын бөөрөнхийлөлгүй төлөх дүн.
 * Алдаа гарсан ч бүх мөрийг шалгаж errors-д цуглуулна (UI нэг дор харуулна).
 */
export function planPayments(
  inputs: PaymentInput[],
  methods: PaymentMethodView[],
  total: number,
  ctx: PaymentContext
): PaymentPlan {
  const errors: string[] = [];
  const byId = new Map(methods.map((method) => [method.id, method]));
  const payments: ResolvedPayment[] = [];

  for (const input of inputs) {
    const method = byId.get(input.paymentMethodId);
    if (!method) {
      errors.push("Төлбөрийн хэлбэр олдсонгүй");
      continue;
    }
    if (!method.isActive) {
      errors.push(`"${method.name}" хэлбэр идэвхгүй байна`);
      continue;
    }
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`"${method.name}": дүн 0-ээс их байна`);
      continue;
    }
    if (method.requiresReference && !input.reference?.trim())
      errors.push(`"${method.name}": лавлах дугаар (слип, гүйлгээний утга) заавал`);

    let exchangeRate = 1;
    const currency = method.currency || "MNT";
    if (method.kind === "cash_fx" || currency !== "MNT") {
      const rate = ctx.fxRates[currency];
      if (!(rate > 0)) {
        errors.push(`${currency} валютын ханш ээлжид тохируулаагүй байна`);
        continue;
      }
      exchangeRate = rate;
    }
    const baseAmount = round2(amount * exchangeRate);

    switch (method.kind) {
      case "credit":
        if (ctx.isWalkIn) errors.push("Зээлээр борлуулахад харилцагч заавал сонгоно");
        else if (
          ctx.creditLimit != null &&
          ctx.openReceivable + baseAmount > ctx.creditLimit + EPS
        )
          errors.push(
            `[CREDIT_LIMIT] Зээлийн лимит ${ctx.creditLimit.toLocaleString("en-US")}₮ (нээлттэй авлага ${ctx.openReceivable.toLocaleString("en-US")}₮) хэтэрнэ`
          );
        break;
      case "advance":
        if (ctx.isWalkIn) errors.push("Урьдчилгаа ашиглахад харилцагч заавал сонгоно");
        else if (baseAmount > ctx.advanceBalance + EPS)
          errors.push(
            `Урьдчилгааны үлдэгдэл ${ctx.advanceBalance.toLocaleString("en-US")}₮ хүрэлцэхгүй`
          );
        break;
      case "gift_card": {
        const code = input.giftCardCode?.trim();
        if (!code) errors.push("Бэлгийн картын код оруулна уу");
        else {
          const balance = ctx.giftCardBalances[code];
          if (balance == null) errors.push(`"${code}" бэлгийн карт олдсонгүй`);
          else if (baseAmount > balance + EPS)
            errors.push(`"${code}" картын үлдэгдэл ${balance.toLocaleString("en-US")}₮ хүрэлцэхгүй`);
        }
        break;
      }
      case "store_credit": {
        if (ctx.isWalkIn) errors.push("Дэлгүүрийн кредит ашиглахад харилцагч заавал сонгоно");
        const id = input.storeCreditId?.trim();
        if (!id) errors.push("Дэлгүүрийн кредит сонгоно уу");
        else {
          const balance = ctx.storeCreditBalances[id];
          if (balance == null) errors.push("Дэлгүүрийн кредит олдсонгүй");
          else if (baseAmount > balance + EPS)
            errors.push(`Кредитийн үлдэгдэл ${balance.toLocaleString("en-US")}₮ хүрэлцэхгүй`);
        }
        break;
      }
      default:
        break;
    }

    payments.push({
      ...input,
      method,
      currency,
      exchangeRate,
      baseAmount,
      changeGiven: 0,
    });
  }

  // Бөөрөнхийлөл — бэлэн (MNT) хэлбэрээр төлөх ХЭСЭГТ л: cashDue = total − Σ бусад.
  const cashPayments = payments.filter((payment) => payment.method.kind === "cash");
  const nonCashBase = round2(
    payments
      .filter((payment) => payment.method.kind !== "cash")
      .reduce((sum, payment) => sum + payment.baseAmount, 0)
  );
  let roundingAmount = 0;
  if (cashPayments.length > 0 && ctx.cashRoundingUnit > 0) {
    const cashDue = round2(total - nonCashBase);
    if (cashDue > 0) roundingAmount = roundToCashUnit(cashDue, ctx.cashRoundingUnit).diff;
  }
  const payable = round2(total + roundingAmount);

  const paidBase = round2(payments.reduce((sum, payment) => sum + payment.baseAmount, 0));
  let change = 0;
  if (payments.length > 0) {
    if (paidBase + EPS < payable)
      errors.push(
        `Төлбөр дутуу: ${paidBase.toLocaleString("en-US")}₮ / ${payable.toLocaleString("en-US")}₮`
      );
    else if (paidBase > payable + EPS) {
      change = round2(paidBase - payable);
      const changeHost = payments.find((payment) => payment.method.allowsChange);
      if (!changeHost)
        errors.push(
          `Илүү төлбөр ${change.toLocaleString("en-US")}₮ — хариулт зөвхөн бэлэн хэлбэрт өгнө`
        );
      else if (change > changeHost.baseAmount + EPS)
        errors.push("Хариулт бэлэн төлбөрөөс их байж болохгүй");
      else changeHost.changeGiven = change;
    }
  } else errors.push("Дор хаяж нэг төлбөрийн хэлбэр сонгоно уу");

  return { payments, paidBase, change, roundingAmount, payable, errors };
}

/**
 * Буцаалтын буцаан олголт — эх хэлбэрээр (allowsRefund) эсвэл бэлэн/кредит.
 * Σ = буцаах дүн байх ёстой (хариулт байхгүй).
 */
export function planRefund(
  inputs: PaymentInput[],
  methods: PaymentMethodView[],
  refundTotal: number,
  fxRates: Record<string, number>
): { payments: ResolvedPayment[]; errors: string[] } {
  const errors: string[] = [];
  const byId = new Map(methods.map((method) => [method.id, method]));
  const payments: ResolvedPayment[] = [];
  for (const input of inputs) {
    const method = byId.get(input.paymentMethodId);
    if (!method) {
      errors.push("Төлбөрийн хэлбэр олдсонгүй");
      continue;
    }
    if (!method.allowsRefund) {
      errors.push(`"${method.name}" хэлбэрээр буцаан олгох боломжгүй`);
      continue;
    }
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`"${method.name}": дүн 0-ээс их байна`);
      continue;
    }
    const currency = method.currency || "MNT";
    let exchangeRate = 1;
    if (currency !== "MNT") {
      const rate = fxRates[currency];
      if (!(rate > 0)) {
        errors.push(`${currency} валютын ханш ээлжид тохируулаагүй байна`);
        continue;
      }
      exchangeRate = rate;
    }
    payments.push({
      ...input,
      method,
      currency,
      exchangeRate,
      baseAmount: round2(amount * exchangeRate),
      changeGiven: 0,
    });
  }
  const sum = round2(payments.reduce((total, payment) => total + payment.baseAmount, 0));
  if (payments.length > 0 && Math.abs(sum - refundTotal) > EPS)
    errors.push(
      `Буцаан олголтын нийлбэр ${sum.toLocaleString("en-US")}₮ нь буцаах дүн ${refundTotal.toLocaleString("en-US")}₮-тэй таарахгүй`
    );
  if (payments.length === 0) errors.push("Буцаан олгох хэлбэр сонгоно уу");
  return { payments, errors };
}

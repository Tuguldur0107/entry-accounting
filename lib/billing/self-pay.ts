// Багцаа QPay-ээр ӨӨРӨӨ төлөх — ЦЭВЭР дүрэм (DB-гүй, CLIENT-SAFE, тесттэй).
// docs/billing/00-proposal.md §6a (2026-09-25 шийдвэр):
//   • өөрөө төлөх багц: skills («AI нягтлан»), standard, platform
//     (enterprise = хэлэлцээрээр, trial/dedicated төлөгддөггүй)
//   • хугацаа 1 / 3 / 6 / 12 сар, хөнгөлөлтгүй — дүн = суудал × үнэ × сар
//   • хугацаа дуусахад grace: skills 3, бусад 14 хоног (plans.ts graceDaysFor)
// Үнэ ЗОХИОХГҮЙ: resolveSeatPrice null (хэлэлцээрээр) бол төлөх боломжгүй.
// Идэвхтэй хугацаанд багц / суудал СОЛИХГҮЙ (пропорц тооцоо зохиохгүй) —
// зөвхөн ижил нөхцлөөр сунгана; өөрчлөлт Console-оор.

import type { Entitlements } from "@/lib/billing/entitlements";
import { PLAN_LABELS, PLANS, type PlanId, type SubscriptionStatus } from "@/lib/billing/plans";
import { resolveSeatPrice, type PlanPriceMap } from "@/lib/billing/pricing";

export const SELF_PAY_PLANS = ["skills", "standard", "platform"] as const;
export type SelfPayPlanId = (typeof SELF_PAY_PLANS)[number];

export const BILLING_MONTH_OPTIONS = [1, 3, 6, 12] as const;
/** Нэг төлбөрийн суудлын дээд тоо — гажиг оролтын хамгаалалт. */
export const MAX_SELF_PAY_SEATS = 500;

/** billing_payments.status */
export const BILLING_PAYMENT_STATUSES = ["open", "paid", "cancelled", "expired", "failed"] as const;
export type BillingPaymentStatus = (typeof BILLING_PAYMENT_STATUSES)[number];
export const BILLING_PAYMENT_STATUS_LABELS: Record<BillingPaymentStatus, string> = {
  open: "Төлбөр хүлээж байна",
  paid: "Төлөгдсөн",
  cancelled: "Цуцалсан",
  expired: "Хугацаа дууссан",
  failed: "Алдаатай",
};

/** QR-ийн хүчинтэй хугацаа — банкны апп нээж төлөхөд хангалттай (мин). */
export const BILLING_PAYMENT_TTL_MINUTES = 30;
/** Диалог төлөвөө Entry DB-ээс унших давтамж (QPay-руу polling ҮГҮЙ). */
export const BILLING_PAYMENT_POLL_MS = 3_000;

/** Төлбөрийн харагдац (plain, client-safe) — DB давхарга payment-store.ts бүтээнэ. */
export type BillingPaymentView = {
  id: string;
  status: BillingPaymentStatus;
  planId: string;
  planLabel: string;
  seats: number;
  months: number;
  pricePerSeatMnt: number;
  amount: number;
  qpayInvoiceId: string | null;
  qrText: string | null;
  qrImage: string | null;
  urls: { name: string; logo: string; link: string }[];
  expiresAt: string;
  paidAt: string | null;
  periodEnd: string | null;
  lastError: string | null;
  createdAt: string;
};

export function isSelfPayPlan(value: unknown): value is SelfPayPlanId {
  return typeof value === "string" && (SELF_PAY_PLANS as readonly string[]).includes(value);
}

/** Байгууллагын одоогийн subscription мөр (байхгүй бол null — мөргүй trial). */
export type SelfPaySubscription = {
  planId: string;
  status: string;
  seats: number | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  pricePerSeatMnt: number | null;
};

export type SelfPayPlanOption = { planId: SelfPayPlanId; label: string; pricePerSeatMnt: number };

export type SelfPayOptions =
  | { allowed: false; reason: string }
  | {
      allowed: true;
      plans: SelfPayPlanOption[];
      /** Суудлын доод тоо (одоо ашиглаж буйгаас доошгүй). */
      seatsMin: number;
      /** Сунгалт / skills — суудал солигдохгүй. */
      seatsFixed: number | null;
      defaultSeats: number;
      /** Идэвхтэй хугацааг ижил нөхцлөөр сунгаж байна уу. */
      renewal: boolean;
    };

/**
 * Энэ байгууллага одоо юуг, ямар нөхцлөөр төлж болох вэ. Шалтгаан нь UI-д
 * ИЛ гарна (товч идэвхгүй + тайлбар).
 */
export function selfPayOptions(input: {
  ent: Entitlements;
  subscription: SelfPaySubscription | null;
  seatsUsed: number;
  prices: PlanPriceMap;
  now: Date;
}): SelfPayOptions {
  const { ent, subscription: sub, seatsUsed, prices, now } = input;
  if (ent.mode !== "saas") return { allowed: false, reason: "Тусдаа сервист багцын төлбөр лицензээр явагдана." };
  const planId = ent.planId;
  const storedStatus = (sub?.status ?? "trialing") as SubscriptionStatus;
  if (storedStatus === "suspended")
    return { allowed: false, reason: "Багц түр зогсоосон байна — support@entry.mn-тэй холбогдоно уу." };
  if (planId === "enterprise" || planId === "dedicated")
    return { allowed: false, reason: `${PLAN_LABELS[planId]} багцын төлбөр гэрээгээр — support@entry.mn.` };

  // Тухайн байгууллагын тусгай үнэ зөвхөн ОДООГИЙН багцад хамаарна.
  const priceFor = (id: SelfPayPlanId) =>
    resolveSeatPrice(id, id === planId ? sub?.pricePerSeatMnt : null, prices);
  const optionFor = (id: SelfPayPlanId): SelfPayPlanOption | null => {
    const price = priceFor(id);
    return price !== null && price > 0 ? { planId: id, label: PLAN_LABELS[id], pricePerSeatMnt: price } : null;
  };
  const noPrice = { allowed: false as const, reason: "Багцын үнэ тогтоогоогүй (хэлэлцээрээр) — support@entry.mn." };

  if (planId === "skills") {
    const option = optionFor("skills");
    if (!option) return noPrice;
    return { allowed: true, plans: [option], seatsMin: 1, seatsFixed: 1, defaultSeats: 1, renewal: storedStatus === "active" };
  }

  const minSeats = Math.max(1, seatsUsed);
  const periodRunning =
    storedStatus === "active" && !!sub?.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime();
  if ((planId === "standard" || planId === "platform") && periodRunning) {
    // Идэвхтэй хугацаанд — ижил багц, ижил суудлаар л сунгана.
    const option = optionFor(planId);
    if (!option) return noPrice;
    const seats = Math.max(sub?.seats ?? PLANS[planId].limits.seats ?? 1, 1);
    if (seats < seatsUsed)
      return {
        allowed: false,
        reason: `Ашиглаж буй суудал (${seatsUsed}) төлсөн суудлаас (${seats}) их — суудал нэмэхээр support@entry.mn-тэй холбогдоно уу.`,
      };
    return { allowed: true, plans: [option], seatsMin: seats, seatsFixed: seats, defaultSeats: seats, renewal: true };
  }

  // Туршилт, хугацаа дууссан, хоцорсон, цуцалсан — Standard / Platform сонгоно.
  const plans = (["standard", "platform"] as const)
    .map(optionFor)
    .filter((option): option is SelfPayPlanOption => option !== null);
  if (plans.length === 0) return noPrice;
  const current = sub?.seats ?? null;
  const defaultSeats = Math.min(MAX_SELF_PAY_SEATS, Math.max(minSeats, current ?? minSeats));
  // Одоогийн багцыг эхэнд — сонгогч түүгээр эхэлнэ.
  plans.sort((a, b) => Number(b.planId === planId) - Number(a.planId === planId));
  return { allowed: true, plans, seatsMin: minSeats, seatsFixed: null, defaultSeats, renewal: false };
}

export type BillingPaymentPlan = {
  planId: SelfPayPlanId;
  seats: number;
  months: number;
  pricePerSeatMnt: number;
  amount: number;
};

/** Хэрэглэгчийн сонголтыг шалгаж дүнг бодно — буруу бол монгол текстээр ШИДНЭ. */
export function planBillingPayment(
  options: SelfPayOptions,
  input: { planId: unknown; seats: unknown; months: unknown }
): BillingPaymentPlan {
  if (!options.allowed) throw new Error(options.reason);
  const option = options.plans.find((plan) => plan.planId === input.planId);
  if (!option) throw new Error("Энэ багцыг одоо сонгох боломжгүй");
  const months = Number(input.months);
  if (!(BILLING_MONTH_OPTIONS as readonly number[]).includes(months))
    throw new Error(`Хугацаа ${BILLING_MONTH_OPTIONS.join(" / ")} сарын аль нэг байна`);
  const seats = options.seatsFixed ?? Number(input.seats);
  if (!Number.isInteger(seats) || seats < options.seatsMin || seats > MAX_SELF_PAY_SEATS)
    throw new Error(`Суудал ${options.seatsMin}–${MAX_SELF_PAY_SEATS} хооронд бүхэл тоо байна`);
  return {
    planId: option.planId,
    seats,
    months,
    pricePerSeatMnt: option.pricePerSeatMnt,
    amount: Math.round(seats * option.pricePerSeatMnt * months),
  };
}

/** Сар нэмэх — сарын сүүлийн өдрийг хавчина (1/31 + 1 сар = 2/28|29). UTC. */
export function addMonths(date: Date, months: number): Date {
  const out = new Date(date.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

/**
 * Төлөгдсөн төлбөрөөр subscription-ийн шинэ төлөв. Хугацаа нь ОДООГИЙН эрхийн
 * эцсээс үргэлжилнэ — хэрэглэгч эрт төлсөндөө хохирохгүй:
 *   туршилт → туршилтын эцсээс; ижил багцын идэвхтэй / хоцорсон хугацаа →
 *   currentPeriodEnd-ээс; бусад (багц солих, удаан хоцорсон) → одооноос.
 * Аль ч тохиолдолд эхлэл ≥ одоо (өнгөрсөн хугацааг нөхөж төлүүлэхгүй).
 */
export function applyPaidSubscription(input: {
  subscription: SelfPaySubscription | null;
  /** Одоогийн бодит багц (мөргүй trial = "trial"). */
  currentPlanId: PlanId;
  payment: { planId: SelfPayPlanId; seats: number; months: number };
  now: Date;
}): { planId: SelfPayPlanId; status: "active"; seats: number; periodStart: Date; currentPeriodEnd: Date } {
  const { subscription: sub, currentPlanId, payment, now } = input;
  let anchor: Date | null = null;
  if (sub?.status === "trialing" || !sub) anchor = sub?.trialEndsAt ?? null;
  else if (payment.planId === currentPlanId && sub.status !== "cancelled") anchor = sub.currentPeriodEnd;
  const periodStart = anchor && anchor.getTime() > now.getTime() ? anchor : now;
  return {
    planId: payment.planId,
    status: "active",
    seats: payment.seats,
    periodStart,
    currentPeriodEnd: addMonths(periodStart, payment.months),
  };
}

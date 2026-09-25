// Багцаа QPay-ээр өөрөө төлөх — цэвэр дүрэм (lib/billing/self-pay.ts) ба
// төлсөн хугацаа дууссан `active`-ийн grace (lib/billing/entitlements.ts).
// Шийдвэр 2026-09-25: skills/standard/platform, 1/3/6/12 сар хөнгөлөлтгүй,
// skills grace 3 хоног, бусад 14.
import assert from "node:assert/strict";
import test from "node:test";

import { resolveEntitlements, type SubscriptionRecord } from "../lib/billing/entitlements";
import { GRACE_DAYS, SKILLS_GRACE_DAYS, graceDaysFor } from "../lib/billing/plans";
import { DEFAULT_PLAN_PRICES } from "../lib/billing/pricing";
import {
  addMonths,
  applyPaidSubscription,
  planBillingPayment,
  selfPayOptions,
  type SelfPaySubscription,
} from "../lib/billing/self-pay";

const NOW = new Date("2026-09-25T10:00:00Z");
const DAY = 86_400_000;
const daysFrom = (n: number) => new Date(NOW.getTime() + n * DAY);

function sub(patch: Partial<SelfPaySubscription> = {}): SelfPaySubscription {
  return { planId: "standard", status: "active", seats: 2, currentPeriodEnd: null, trialEndsAt: null, pricePerSeatMnt: null, ...patch };
}

function record(s: SelfPaySubscription): SubscriptionRecord {
  return { planId: s.planId, status: s.status, seats: s.seats, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd, overrides: null };
}

function optionsFor(s: SelfPaySubscription | null, seatsUsed = 1) {
  const ent = resolveEntitlements({ mode: "saas", subscription: s ? record(s) : null, orgCreatedAt: daysFrom(-3), now: NOW });
  return selfPayOptions({ ent, subscription: s, seatsUsed, prices: DEFAULT_PLAN_PRICES, now: NOW });
}

test("skills — нэг суудал, 29,000₮ × сар; хугацаа 1/3/6/12-оос өөр бол татгалзана", () => {
  const options = optionsFor(sub({ planId: "skills", status: "trialing", seats: null, trialEndsAt: daysFrom(1) }));
  assert.ok(options.allowed);
  if (!options.allowed) return;
  assert.equal(options.seatsFixed, 1);
  assert.deepEqual(options.plans.map((plan) => plan.planId), ["skills"]);
  const plan = planBillingPayment(options, { planId: "skills", seats: 99, months: 3 });
  assert.equal(plan.seats, 1, "skills-д суудал солигдохгүй");
  assert.equal(plan.amount, 87_000);
  assert.throws(() => planBillingPayment(options, { planId: "skills", seats: 1, months: 2 }), /1 \/ 3 \/ 6 \/ 12/);
  assert.throws(() => planBillingPayment(options, { planId: "standard", seats: 1, months: 1 }), /сонгох боломжгүй/);
});

test("trial байгууллага — Standard / Platform сонгоно, суудал ≥ ашиглаж буй", () => {
  const options = optionsFor(null, 3);
  assert.ok(options.allowed);
  if (!options.allowed) return;
  assert.deepEqual(options.plans.map((plan) => plan.planId).sort(), ["platform", "standard"]);
  assert.equal(options.seatsMin, 3);
  assert.equal(options.seatsFixed, null);
  assert.throws(() => planBillingPayment(options, { planId: "standard", seats: 2, months: 1 }), /Суудал 3/);
  const plan = planBillingPayment(options, { planId: "platform", seats: 4, months: 12 });
  assert.equal(plan.amount, 4 * 100_000 * 12);
});

test("идэвхтэй хугацаанд — ижил багц, ижил суудлаар л сунгана (пропорц зохиохгүй)", () => {
  const options = optionsFor(sub({ seats: 3, currentPeriodEnd: daysFrom(10) }), 2);
  assert.ok(options.allowed);
  if (!options.allowed) return;
  assert.equal(options.renewal, true);
  assert.equal(options.seatsFixed, 3);
  assert.deepEqual(options.plans.map((plan) => plan.planId), ["standard"]);
});

test("ашиглаж буй суудал төлсөнөөс их бол сунгалт хаалттай — шалтгаан ил", () => {
  const options = optionsFor(sub({ seats: 2, currentPeriodEnd: daysFrom(10) }), 4);
  assert.equal(options.allowed, false);
  if (options.allowed) return;
  assert.match(options.reason, /суудал/);
});

test("enterprise, suspended, үнэгүй (null) — өөрөө төлөх боломжгүй", () => {
  assert.equal(optionsFor(sub({ planId: "enterprise" })).allowed, false);
  assert.equal(optionsFor(sub({ status: "suspended" })).allowed, false);
  const ent = resolveEntitlements({ mode: "saas", subscription: record(sub({ planId: "skills" })), orgCreatedAt: NOW, now: NOW });
  const noPrice = selfPayOptions({
    ent,
    subscription: sub({ planId: "skills" }),
    seatsUsed: 1,
    prices: { ...DEFAULT_PLAN_PRICES, skills: null },
    now: NOW,
  });
  assert.equal(noPrice.allowed, false, "үнэ ЗОХИОХГҮЙ — хэлэлцээрээр бол төлөхгүй");
});

test("байгууллагын тусгай үнэ зөвхөн ОДООГИЙН багцад", () => {
  const options = optionsFor(sub({ planId: "standard", status: "trialing", pricePerSeatMnt: 70_000, trialEndsAt: daysFrom(5) }));
  assert.ok(options.allowed);
  if (!options.allowed) return;
  const byPlan = Object.fromEntries(options.plans.map((plan) => [plan.planId, plan.pricePerSeatMnt]));
  assert.equal(byPlan.standard, 70_000);
  assert.equal(byPlan.platform, 100_000);
});

test("addMonths — сарын сүүлийн өдрийг хавчина", () => {
  assert.equal(addMonths(new Date("2026-01-31T05:00:00Z"), 1).toISOString(), "2026-02-28T05:00:00.000Z");
  assert.equal(addMonths(new Date("2028-01-31T00:00:00Z"), 1).toISOString(), "2028-02-29T00:00:00.000Z");
  assert.equal(addMonths(new Date("2026-11-15T00:00:00Z"), 3).toISOString(), "2027-02-15T00:00:00.000Z");
});

test("төлбөр — туршилтын үлдсэн хугацаа, идэвхтэй хугацаанаас ҮРГЭЛЖИЛНЭ (эрт төлсөндөө хохирохгүй)", () => {
  const trial = applyPaidSubscription({
    subscription: sub({ planId: "skills", status: "trialing", trialEndsAt: daysFrom(1) }),
    currentPlanId: "skills",
    payment: { planId: "skills", seats: 1, months: 1 },
    now: NOW,
  });
  assert.equal(trial.periodStart.toISOString(), daysFrom(1).toISOString());
  assert.equal(trial.status, "active");

  const renewal = applyPaidSubscription({
    subscription: sub({ currentPeriodEnd: daysFrom(10) }),
    currentPlanId: "standard",
    payment: { planId: "standard", seats: 2, months: 3 },
    now: NOW,
  });
  assert.equal(renewal.currentPeriodEnd.toISOString(), addMonths(daysFrom(10), 3).toISOString());
});

test("төлбөр — хоцорсон / багц солисон бол ОДООНООС (өнгөрсөнийг нөхүүлэхгүй)", () => {
  const lapsed = applyPaidSubscription({
    subscription: sub({ currentPeriodEnd: daysFrom(-5) }),
    currentPlanId: "standard",
    payment: { planId: "standard", seats: 2, months: 1 },
    now: NOW,
  });
  assert.equal(lapsed.periodStart.toISOString(), NOW.toISOString());

  const switched = applyPaidSubscription({
    subscription: sub({ currentPeriodEnd: daysFrom(-1) }),
    currentPlanId: "standard",
    payment: { planId: "platform", seats: 2, months: 1 },
    now: NOW,
  });
  assert.equal(switched.planId, "platform");
  assert.equal(switched.periodStart.toISOString(), NOW.toISOString());
});

test("төлсөн хугацаа дууссан active → past_due; grace skills 3, бусад 14 хоног", () => {
  assert.equal(graceDaysFor("skills"), SKILLS_GRACE_DAYS);
  assert.equal(graceDaysFor("standard"), GRACE_DAYS);

  const ent = (planId: string, endedDaysAgo: number) =>
    resolveEntitlements({
      mode: "saas",
      subscription: record(sub({ planId, currentPeriodEnd: daysFrom(-endedDaysAgo) })),
      orgCreatedAt: daysFrom(-100),
      now: NOW,
    });
  const skillsGrace = ent("skills", 2);
  assert.equal(skillsGrace.status, "past_due");
  assert.equal(skillsGrace.writable, true);
  const skillsLapsed = ent("skills", SKILLS_GRACE_DAYS + 1);
  assert.equal(skillsLapsed.writable, false);
  assert.equal(skillsLapsed.readOnlyReason, "past_due");

  assert.equal(ent("standard", SKILLS_GRACE_DAYS + 1).writable, true, "standard-д 14 хоног");

  const running = ent("standard", -5);
  assert.equal(running.status, "active");
  const unmanaged = resolveEntitlements({ mode: "saas", subscription: record(sub()), orgCreatedAt: daysFrom(-100), now: NOW });
  assert.equal(unmanaged.status, "active", "currentPeriodEnd-гүй (Console-оор удирддаг) active хөндөгдөхгүй");
});

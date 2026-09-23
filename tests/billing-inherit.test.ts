// Группын багц өвлөлт — ЦЭВЭР логикийн тест (DATABASE_URL ШААРДАХГҮЙ).
//
// Хамрах хүрээ: нэг нягтлан / нэг эзэн олон компани хөтлөхөд 2–10 дахь
// компани нь мөргүй үүсч, өөрийн trial дуусмагц read-only болдог байсан
// алдааны хамгаалалт.

import test from "node:test";
import assert from "node:assert/strict";

import {
  GROUP_INHERITED_NOTE,
  planInheritedSubscription,
  type InheritableSubscription,
} from "../lib/billing/inherit";

const PLATFORM: InheritableSubscription = {
  planId: "platform",
  status: "active",
  seats: 3,
  trialEndsAt: null,
  currentPeriodEnd: new Date("2030-12-31T00:00:00Z"),
  overrides: { limits: { companies: 10 } },
};

test("эх байгууллагын багц бүтнээрээ өвлөгдөнө", () => {
  const plan = planInheritedSubscription(PLATFORM);
  assert.ok(plan);
  assert.equal(plan.planId, "platform");
  assert.equal(plan.status, "active");
  assert.equal(plan.seats, 3);
  assert.deepEqual(plan.currentPeriodEnd, new Date("2030-12-31T00:00:00Z"));
  assert.deepEqual(plan.overrides, { limits: { companies: 10 } });
});

test("үнэ ҮРГЭЛЖ 0 — групп доторх компани давхар тооцогдохгүй", () => {
  // Төлбөр нь ЭХ байгууллага дээр үлдэнэ. Эс бөгөөс 10 компанитай
  // нягтлан 10 × 100,000₮ гэж харагдана.
  const plan = planInheritedSubscription(PLATFORM);
  assert.equal(plan?.pricePerSeatMnt, 0);
  assert.equal(plan?.note, GROUP_INHERITED_NOTE);
});

test("мөргүй эх байгууллагаас өвлөх зүйл АЛГА (trial дагана)", () => {
  // Trial дээрх харилцагчийн шинэ компани нь өөрийн trial-аа авна —
  // мөр ЗОХИОХГҮЙ.
  assert.equal(planInheritedSubscription(null), null);
  assert.equal(planInheritedSubscription(undefined), null);
});

test("цуцлагдсан / зогссон багц ӨВЛӨГДӨХГҮЙ", () => {
  // Эс бөгөөс шинэ компани төрөхөөсөө read-only болно. Мөр үүсгэхгүй нь
  // 14 хоногийн trial өгч, асуудлаа шийдэх зай гаргана.
  for (const status of ["cancelled", "suspended"])
    assert.equal(
      planInheritedSubscription({ ...PLATFORM, status }),
      null,
      `${status} өвлөгдөх ёсгүй`
    );
});

test("trial ба past_due статус өвлөгдөнө (бичих эрх нээлттэй)", () => {
  for (const status of ["trialing", "past_due", "active"]) {
    const plan = planInheritedSubscription({ ...PLATFORM, status });
    assert.ok(plan, `${status} өвлөгдөх ёстой`);
    assert.equal(plan.status, status);
  }
});

test("хоосон талбарууд null болж хэвийн дамжина", () => {
  const plan = planInheritedSubscription({
    planId: "standard",
    status: "active",
    seats: null,
    trialEndsAt: null,
    currentPeriodEnd: null,
    overrides: null,
  });
  assert.ok(plan);
  assert.equal(plan.seats, null);
  assert.equal(plan.currentPeriodEnd, null);
  assert.equal(plan.overrides, null);
});

test("өвлөлт нь эх мөрийг МУТАЦ хийхгүй", () => {
  const before = JSON.stringify(PLATFORM);
  planInheritedSubscription(PLATFORM);
  assert.equal(JSON.stringify(PLATFORM), before);
});

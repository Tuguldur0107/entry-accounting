// Entitlement-ийн цэвэр дүрэм (lib/billing/entitlements.ts) — trial, grace,
// override, dedicated горим, хязгаар.
import assert from "node:assert/strict";
import test from "node:test";

import {
  limitReached,
  parseOverrides,
  resolveEntitlements,
  trialEndFor,
} from "../lib/billing/entitlements";
import { GRACE_DAYS, TRIAL_DAYS } from "../lib/billing/plans";

const NOW = new Date("2026-09-20T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

test("dedicated горим — бүх боломж, хязгааргүй, үргэлж бичигдэнэ", () => {
  const ent = resolveEntitlements({ mode: "dedicated", subscription: null, orgCreatedAt: daysAgo(400), now: NOW });
  assert.equal(ent.planId, "dedicated");
  assert.equal(ent.writable, true);
  assert.equal(ent.limits.seats, null);
  assert.equal(ent.features["api.rest"], true);
});

test("saas мөргүй = trial 14 хоног; дуусвал read-only, өгөгдөл хэвээр", () => {
  const fresh = resolveEntitlements({ mode: "saas", subscription: null, orgCreatedAt: daysAgo(3), now: NOW });
  assert.equal(fresh.planId, "trial");
  assert.equal(fresh.status, "trialing");
  assert.equal(fresh.writable, true);
  assert.equal(fresh.daysLeft, TRIAL_DAYS - 3);
  assert.deepEqual(fresh.trialEndsAt, trialEndFor(daysAgo(3)));

  const expired = resolveEntitlements({ mode: "saas", subscription: null, orgCreatedAt: daysAgo(TRIAL_DAYS + 1), now: NOW });
  assert.equal(expired.writable, false);
  assert.equal(expired.readOnlyReason, "trial_expired");
  assert.equal(expired.daysLeft, null);
});

test("standard active — суудал мөрөөс, api.rest хаалттай; override нээнэ", () => {
  const base = { planId: "standard", status: "active", seats: 5, trialEndsAt: null, currentPeriodEnd: null, overrides: null };
  const ent = resolveEntitlements({ mode: "saas", subscription: base, orgCreatedAt: daysAgo(100), now: NOW });
  assert.equal(ent.writable, true);
  assert.equal(ent.limits.seats, 5);
  assert.equal(ent.features["api.rest"], false);
  assert.equal(limitReached(ent, "seats", 5), true);
  assert.equal(limitReached(ent, "seats", 4), false);

  const withOverride = resolveEntitlements({
    mode: "saas",
    subscription: { ...base, overrides: { features: { "api.rest": true }, limits: { companies: 3 } } },
    orgCreatedAt: daysAgo(100),
    now: NOW,
  });
  assert.equal(withOverride.features["api.rest"], true);
  assert.equal(withOverride.limits.companies, 3);
});

test("past_due — grace дотор бичигдэнэ, дараа нь read-only", () => {
  const periodEnd = daysAgo(5);
  const sub = { planId: "standard", status: "past_due", seats: 2, trialEndsAt: null, currentPeriodEnd: periodEnd, overrides: null };
  const inGrace = resolveEntitlements({ mode: "saas", subscription: sub, orgCreatedAt: daysAgo(300), now: NOW });
  assert.equal(inGrace.writable, true);
  assert.equal(inGrace.daysLeft, GRACE_DAYS - 5);

  const after = resolveEntitlements({ mode: "saas", subscription: { ...sub, currentPeriodEnd: daysAgo(GRACE_DAYS + 1) }, orgCreatedAt: daysAgo(300), now: NOW });
  assert.equal(after.writable, false);
  assert.equal(after.readOnlyReason, "past_due");
});

test("suspended / cancelled → read-only; танигдахгүй багц → standard", () => {
  const sub = { planId: "gold", status: "suspended", seats: null, trialEndsAt: null, currentPeriodEnd: null, overrides: null };
  const ent = resolveEntitlements({ mode: "saas", subscription: sub, orgCreatedAt: daysAgo(10), now: NOW });
  assert.equal(ent.planId, "standard");
  assert.equal(ent.writable, false);
  assert.equal(ent.readOnlyReason, "suspended");
});

test("parseOverrides fail-safe — танигдахгүй түлхүүр, буруу төрөл хаягдана", () => {
  assert.equal(parseOverrides(null), null);
  assert.equal(parseOverrides("x"), null);
  assert.deepEqual(parseOverrides({ features: { mcp: false, bogus: true }, limits: { seats: -1, companies: 2, other: 1 } }), {
    features: { mcp: false },
    limits: { companies: 2 },
  });
});

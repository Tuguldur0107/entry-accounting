import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrialFunnel,
  median,
  parseFunnelRange,
  productOfPlan,
  type TrialFunnelOrg,
} from "../lib/platform/trial-funnel";

const T0 = new Date("2026-09-01T00:00:00Z");
const h = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);

function org(id: string, patch: Partial<TrialFunnelOrg> = {}): TrialFunnelOrg {
  return {
    organizationId: id,
    orgName: `Org ${id}`,
    createdAt: T0,
    planId: null,
    isDemo: false,
    firstOrgOfOwner: true,
    connectedAt: null,
    masterDataAt: null,
    firstJournalAt: null,
    paidAt: null,
    manuallyConverted: false,
    welcomeDismissed: false,
    ...patch,
  };
}

const RANGE = { product: "accounting" as const, from: "2026-09-01", to: "2026-09-30" };

test("buildTrialFunnel — дараалсан тоо, хувь, медиан хугацаа", () => {
  const funnel = buildTrialFunnel(
    [
      org("a", { connectedAt: h(1), masterDataAt: h(2), firstJournalAt: h(5), paidAt: h(100) }),
      org("b", { connectedAt: h(3), masterDataAt: h(4) }),
      org("c", { connectedAt: h(10) }),
      org("d"),
    ],
    RANGE
  );
  assert.equal(funnel.cohortSize, 4);
  const byKey = Object.fromEntries(funnel.stages.map((s) => [s.key, s]));
  assert.deepEqual(
    funnel.stages.map((s) => s.count),
    [4, 3, 2, 1, 1]
  );
  assert.equal(byKey.connected.rateFromSignup, 0.75);
  assert.equal(byKey.master_data.rateFromPrevious, 2 / 3);
  assert.equal(byKey.connected.medianHoursFromSignup, 3);
  assert.equal(byKey.master_data.medianHoursFromSignup, 3);
  assert.equal(byKey.paid.medianHoursFromSignup, 100);
  assert.equal(funnel.orgs.find((o) => o.organizationId === "b")?.lastStage, "master_data");
  assert.equal(funnel.orgs.find((o) => o.organizationId === "d")?.lastStage, "signed_up");
});

test("buildTrialFunnel — дараалал алгассан нь count-д биш, reachedAnyOrder-д", () => {
  const funnel = buildTrialFunnel([org("a", { firstJournalAt: h(2), paidAt: h(3) })], RANGE);
  const journal = funnel.stages.find((s) => s.key === "first_journal");
  assert.equal(journal?.count, 0);
  assert.equal(journal?.reachedAnyOrder, 1);
  assert.equal(funnel.orgs[0].lastStage, "signed_up");
});

test("buildTrialFunnel — демо, нэмэлт компани, өөр бүтээгдэхүүн когортоос хасагдана", () => {
  const funnel = buildTrialFunnel(
    [org("a"), org("demo", { isDemo: true }), org("second", { firstOrgOfOwner: false }), org("s", { planId: "skills" })],
    RANGE
  );
  assert.equal(funnel.cohortSize, 1);
  assert.deepEqual(funnel.excluded, { demo: 1, additionalCompany: 1, otherProduct: 1 });

  const skills = buildTrialFunnel([org("s", { planId: "skills", connectedAt: h(1) })], { ...RANGE, product: "skills" });
  assert.deepEqual(
    skills.stages.map((s) => s.key),
    ["signed_up", "connected", "paid"]
  );
  assert.equal(skills.cohortSize, 1);
});

test("buildTrialFunnel — Console-оос идэвхжүүлсэн нь төлсөнд тооцогдох ч хугацаагүй", () => {
  const funnel = buildTrialFunnel(
    [org("a", { connectedAt: h(1), masterDataAt: h(1), firstJournalAt: h(1), manuallyConverted: true })],
    RANGE
  );
  const paid = funnel.stages.find((s) => s.key === "paid");
  assert.equal(paid?.count, 1);
  assert.equal(paid?.medianHoursFromSignup, null);
});

test("buildTrialFunnel — хоосон когорт хувь null, «Дараа үзнэ» тоологдоно", () => {
  const empty = buildTrialFunnel([], RANGE);
  assert.equal(empty.cohortSize, 0);
  assert.equal(empty.stages[1].rateFromSignup, null);
  const dismissed = buildTrialFunnel([org("a", { welcomeDismissed: true }), org("b")], RANGE);
  assert.equal(dismissed.welcomeDismissed, 1);
});

test("median / productOfPlan", () => {
  assert.equal(median([]), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(productOfPlan("skills"), "skills");
  assert.equal(productOfPlan(null), "accounting");
  assert.equal(productOfPlan("standard"), "accounting");
});

test("parseFunnelRange — default 90 хоног, гажиг/урвуу/урт муж ШИДНЭ", () => {
  assert.deepEqual(parseFunnelRange({}, "2026-09-26"), { from: "2026-06-29", to: "2026-09-26" });
  assert.deepEqual(parseFunnelRange({ from: "2026-09-01", to: "2026-09-30" }, "2026-09-26"), {
    from: "2026-09-01",
    to: "2026-09-30",
  });
  assert.throws(() => parseFunnelRange({ from: "2026-02-30" }, "2026-09-26"));
  assert.throws(() => parseFunnelRange({ from: "2026-09-10", to: "2026-09-01" }, "2026-09-26"));
  assert.throws(() => parseFunnelRange({ from: "2025-01-01", to: "2026-09-01" }, "2026-09-26"));
  assert.doesNotThrow(() => parseFunnelRange({ from: "2025-09-27", to: "2026-09-26" }, "2026-09-26"));
});

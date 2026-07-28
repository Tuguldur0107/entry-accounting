import test from "node:test";
import assert from "node:assert/strict";

import {
  isPeriodCode,
  isPeriodWritable,
  lastDayOfMonth,
  nextPeriodCode,
  periodCodeOf,
  periodCodesBetween,
  periodRange,
  previousPeriodCode,
  type PeriodStatus,
} from "../lib/periods/period";

test("period code: derived from a date, validated", () => {
  assert.equal(periodCodeOf("2026-07-28"), "2026-07");
  assert.equal(periodCodeOf("2026-01-01"), "2026-01");
  assert.throws(() => periodCodeOf("2026-7-1"), /буруу форматтай/);
  assert.throws(() => periodCodeOf("2026-13-01"), /буруу/);

  assert.ok(isPeriodCode("2026-12"));
  assert.ok(!isPeriodCode("2026-13"));
  assert.ok(!isPeriodCode("2026-1"));
});

test("period range: inclusive month bounds incl. leap February", () => {
  assert.deepEqual(periodRange("2026-07"), {
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  });
  assert.deepEqual(periodRange("2026-02"), {
    startDate: "2026-02-01",
    endDate: "2026-02-28",
  });
  // 2028 — хөрөөт жил
  assert.equal(lastDayOfMonth("2028-02"), 29);
  assert.deepEqual(periodRange("2026-11"), {
    startDate: "2026-11-01",
    endDate: "2026-11-30",
  });
});

test("period navigation: year boundaries", () => {
  assert.equal(nextPeriodCode("2026-12"), "2027-01");
  assert.equal(nextPeriodCode("2026-01"), "2026-02");
  assert.equal(previousPeriodCode("2026-01"), "2025-12");
  assert.equal(previousPeriodCode("2026-12"), "2026-11");
});

test("period range list: ascending, inclusive, empty when reversed", () => {
  assert.deepEqual(periodCodesBetween("2026-11", "2027-02"), [
    "2026-11",
    "2026-12",
    "2027-01",
    "2027-02",
  ]);
  assert.deepEqual(periodCodesBetween("2026-05", "2026-05"), ["2026-05"]);
  assert.deepEqual(periodCodesBetween("2026-06", "2026-05"), []);
});

test("writability: unregistered period is open, closed blocks writes", () => {
  const periods = new Map<string, PeriodStatus>([
    ["2026-05", "closed"],
    ["2026-06", "open"],
  ]);
  assert.equal(isPeriodWritable(periods, "2026-05-31"), false);
  assert.equal(isPeriodWritable(periods, "2026-06-01"), true);
  // Бүртгэлгүй сар — нээлттэй (хаалт хийж эхлээгүй систем ажиллана).
  assert.equal(isPeriodWritable(periods, "2026-07-15"), true);
});

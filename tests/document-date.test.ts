import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCalendarDate,
  defaultDocumentDate,
  isCalendarDate,
  isDateInPeriod,
  isFuturePeriodDate,
  periodFromCookieHeader,
  periodFromCookieValue,
  ulaanbaatarToday,
} from "../lib/periods/document-date";
import { assertNotFuturePeriod, FuturePeriodError } from "../lib/periods/guard";

test("ENT-027: хуанлид байхгүй огноо татгалзагдана", () => {
  assert.equal(isCalendarDate("2025-02-30"), false);
  assert.equal(isCalendarDate("2025-02-29"), false);
  assert.equal(isCalendarDate("2024-02-29"), true);
  assert.equal(isCalendarDate("2025-13-01"), false);
  assert.equal(isCalendarDate("2025-04-31"), false);
  assert.equal(isCalendarDate("2025-12-31"), true);
  assert.equal(isCalendarDate("2025-1-5"), false);
  assert.equal(isCalendarDate(null), false);
  assert.throws(() => assertCalendarDate("2025-02-30"), /хуанлид байхгүй/);
  assert.throws(() => assertCalendarDate("30/02/2025"), /YYYY-MM-DD/);
  assert.doesNotThrow(() => assertCalendarDate("2024-02-29"));
});

test("ENT-041: шинэ баримтын огноо сонгосон сараас", () => {
  const today = "2026-09-23";
  assert.equal(defaultDocumentDate(null, today), today);
  assert.equal(defaultDocumentDate("2026-09", today), today);
  assert.equal(defaultDocumentDate("2025-03", today), "2025-03-31");
  assert.equal(defaultDocumentDate("2024-02", today), "2024-02-29");
  assert.equal(defaultDocumentDate("2026-11", today), "2026-11-01");
  assert.equal(defaultDocumentDate("garbage", today), today);
  assert.equal(isDateInPeriod("2025-03-15", "2025-03"), true);
  assert.equal(isDateInPeriod("2026-09-23", "2025-03"), false);
  assert.equal(isDateInPeriod("2026-09-23", null), true);
});

test("ea-period cookie задлал", () => {
  assert.equal(periodFromCookieValue("2025-03:PTD"), "2025-03");
  assert.equal(periodFromCookieValue("2025-13:PTD"), null);
  assert.equal(periodFromCookieValue(undefined), null);
  assert.equal(periodFromCookieHeader("a=1; ea-period=2025-03%3AYTD; b=2"), "2025-03");
  assert.equal(periodFromCookieHeader("a=1"), null);
});

test("ENT-028: ирээдүйн САРЫН огноо батлагдахгүй", () => {
  const today = "2026-09-23";
  assert.equal(isFuturePeriodDate("2026-09-30", today), false);
  assert.equal(isFuturePeriodDate("2026-10-01", today), true);
  assert.equal(isFuturePeriodDate("2027-06-01", today), true);
  assert.throws(() => assertNotFuturePeriod("2027-06-01", today), FuturePeriodError);
  assert.doesNotThrow(() => assertNotFuturePeriod("2026-09-30", today));
  assert.doesNotThrow(() => assertNotFuturePeriod("2025-01-01", today));
});

test("Улаанбаатарын өнөөдөр UTC+8-аар", () => {
  assert.equal(ulaanbaatarToday(new Date("2026-09-22T17:30:00Z")), "2026-09-23");
  assert.equal(ulaanbaatarToday(new Date("2026-09-22T15:30:00Z")), "2026-09-22");
});

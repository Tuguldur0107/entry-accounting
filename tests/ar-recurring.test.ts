// Давтамжтай нэхэмжлэхийн ЦЭВЭР логик (lib/arap/recurring.ts): хуваарийн огноо
// (сарын сүүл, 29–31, улирал/жил), нөхөлтийн дээд хязгаар, шалгалт.

import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  dueOccurrences,
  firstOccurrence,
  nextOccurrence,
  normalizeRecurringSchedule,
  occurrenceInMonth,
  recurringDescription,
  recurringExternalRef,
  recurringScheduleLabel,
} from "../lib/arap/recurring";

test("сарын өдөр — сарын сүүл, богино сар", () => {
  assert.equal(occurrenceInMonth(2026, 2, 0), "2026-02-28");
  assert.equal(occurrenceInMonth(2028, 2, 0), "2028-02-29");
  assert.equal(occurrenceInMonth(2026, 10, 5), "2026-10-05");
  assert.equal(occurrenceInMonth(2026, 4, 0), "2026-04-30");
});

test("эхний ба дараагийн огноо", () => {
  assert.equal(firstOccurrence("2026-09-28", 1, 1), "2026-10-01", "энэ сарын 1 өнгөрсөн → дараа сар");
  assert.equal(firstOccurrence("2026-09-28", 28, 1), "2026-09-28", "тэр өдөр орно");
  assert.equal(firstOccurrence("2026-09-28", 0, 1), "2026-09-30");
  assert.equal(firstOccurrence("2026-11-15", 10, 3), "2027-02-10", "улирал — 3 сарын дараа");
  assert.equal(nextOccurrence("2026-01-31", 0, 1), "2026-02-28");
  assert.equal(nextOccurrence("2026-02-28", 0, 1), "2026-03-31", "сарын сүүл алдагдахгүй");
  assert.equal(nextOccurrence("2026-12-05", 5, 1), "2027-01-05");
  assert.equal(nextOccurrence("2026-10-05", 5, 12), "2027-10-05");
});

test("өнөөдрийг хүртэлх огноонууд — нөхөлтийн хязгаар, дуусах огноо", () => {
  const base = { dayOfMonth: 1, intervalMonths: 1, endDate: null };
  assert.deepEqual(dueOccurrences({ ...base, nextRunDate: "2026-10-01", today: "2026-09-30" }), []);
  assert.deepEqual(dueOccurrences({ ...base, nextRunDate: "2026-10-01", today: "2026-10-01" }), ["2026-10-01"]);
  assert.deepEqual(
    dueOccurrences({ ...base, nextRunDate: "2026-06-01", today: "2026-12-15" }),
    ["2026-06-01", "2026-07-01", "2026-08-01"],
    "сервер удаан унтарсан — нэг tick-д 3"
  );
  assert.deepEqual(
    dueOccurrences({ ...base, nextRunDate: "2026-10-01", today: "2026-12-15", endDate: "2026-11-15" }),
    ["2026-10-01", "2026-11-01"]
  );
});

test("шалгалт ба шошго", () => {
  const ok = { intervalMonths: 1, dayOfMonth: 1, paymentTermsDays: 14, startDate: "2026-10-01", endDate: "", autoPost: false, sendEmail: false };
  assert.deepEqual(normalizeRecurringSchedule(ok), { value: { ...ok, endDate: null } });
  assert.ok("error" in normalizeRecurringSchedule({ ...ok, intervalMonths: 2 }));
  assert.ok("error" in normalizeRecurringSchedule({ ...ok, dayOfMonth: 31 }));
  assert.ok("error" in normalizeRecurringSchedule({ ...ok, paymentTermsDays: -1 }));
  assert.ok("error" in normalizeRecurringSchedule({ ...ok, endDate: "2026-09-01" }));
  assert.match(
    (normalizeRecurringSchedule({ ...ok, sendEmail: true }) as { error: string }).error,
    /автоматаар батлах/
  );
  assert.equal(recurringScheduleLabel(1, 0), "Сар бүр, сарын сүүлийн өдөр");
  assert.equal(recurringScheduleLabel(3, 10), "Улирал бүр, сарын 10-нд");
  assert.equal(recurringDescription(" Түрээс ", "2026-10-01"), "Түрээс — 2026-10");
  assert.equal(recurringExternalRef("abc", "2026-10-01"), "recurring:abc:2026-10-01");
  assert.equal(addDays("2026-10-25", 14), "2026-11-08");
});

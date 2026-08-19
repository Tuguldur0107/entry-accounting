import { test } from "node:test";
import assert from "node:assert/strict";

import { computeTaxDeadlines } from "../lib/tax/calendar";

function byKey(rows: ReturnType<typeof computeTaxDeadlines>, key: string) {
  const row = rows.find((r) => r.key === key);
  assert.ok(row, `${key} олдсонгүй`);
  return row;
}

test("сарын дундуур: НДШ дараа сар руу, НӨАТ/ХАОАТ энэ сард үлдэнэ", () => {
  const rows = computeTaxDeadlines("2026-08-07");
  // 08-05 өнгөрсөн → НДШ дараагийн хугацаа 09-05 (тайлант үе 2026-08).
  assert.equal(byKey(rows, "si").dueDate, "2026-09-05");
  assert.equal(byKey(rows, "si").period, "2026-08");
  // 08-10 болоогүй → НӨАТ энэ сарын 10 (тайлант үе 2026-07).
  assert.equal(byKey(rows, "vat").dueDate, "2026-08-10");
  assert.equal(byKey(rows, "vat").period, "2026-07");
  assert.equal(byKey(rows, "vat").daysLeft, 3);
});

test("хугацааны өдөр нь daysLeft=0 (өнөөдөр дуусна)", () => {
  const rows = computeTaxDeadlines("2026-08-10");
  assert.equal(byKey(rows, "vat").dueDate, "2026-08-10");
  assert.equal(byKey(rows, "vat").daysLeft, 0);
});

test("оны зааг: 1-р сарын эхээр НӨАТ 01-10 (12-р сарын тайлан)", () => {
  const rows = computeTaxDeadlines("2027-01-03");
  assert.equal(byKey(rows, "vat").dueDate, "2027-01-10");
  assert.equal(byKey(rows, "vat").period, "2026-12");
  // ААНОАТ: Q4 2026 → 2027-01-20.
  assert.equal(byKey(rows, "cit").dueDate, "2027-01-20");
  assert.equal(byKey(rows, "cit").period, "2026 Q4");
});

test("ААНОАТ улирлын дараалал: 8-р сард дараагийн нь Q3 → 10-20", () => {
  const rows = computeTaxDeadlines("2026-08-19");
  assert.equal(byKey(rows, "cit").dueDate, "2026-10-20");
  assert.equal(byKey(rows, "cit").period, "2026 Q3");
});

test("эрэмбэ: хамгийн ойрын хугацаа эхэндээ", () => {
  const rows = computeTaxDeadlines("2026-08-07");
  const dates = rows.map((r) => r.dueDate);
  assert.deepEqual(dates, [...dates].sort());
});

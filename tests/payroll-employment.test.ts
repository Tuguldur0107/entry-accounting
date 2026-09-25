// SIM2-019 / SIM2-020 — сарын дунд орсон/гарсан ажилтны цалингийн хувь (ЦЭВЭР).

import test from "node:test";
import assert from "node:assert/strict";

import {
  employmentShare,
  isTerminated,
  monthWorkingDays,
  proratedHours,
} from "../lib/payroll/employment";

test("ажлын өдөр: 2025-08 = 21, 2025-09 = 22", () => {
  assert.equal(monthWorkingDays("2025-08").length, 21);
  assert.equal(monthWorkingDays("2025-09").length, 22);
});

test("SIM2-019: 2025-08-18-нд орсон → 10/21, 3,000,000 × 10/21 = 1,428,571.43", () => {
  const share = employmentShare("2025-08", "2025-08-18", null);
  assert.equal(share.partial, true);
  assert.equal(share.workedDays, 10);
  assert.equal(share.totalDays, 21);
  assert.match(share.note!, /10\/21.*08-18-нд орсон/);
  const hours = proratedHours(168, share);
  assert.equal(hours, 80);
  assert.equal(Math.round(((3_000_000 * hours) / 168) * 100) / 100, 1_428_571.43);
});

test("SIM2-020: 2025-09-15-нд гарсан → 11/22 (1,800,000 → 900,000); 10-р сард ажиллаагүй", () => {
  const sep = employmentShare("2025-09", "2020-01-01", "2025-09-15");
  assert.equal(sep.workedDays, 11);
  assert.equal(sep.totalDays, 22);
  assert.equal((1_800_000 * proratedHours(176, sep)) / 176, 900_000);
  const oct = employmentShare("2025-10", "2020-01-01", "2025-09-15");
  assert.equal(oct.employed, false);
  assert.equal(employmentShare("2025-07", "2025-08-18", null).employed, false);
});

test("бүтэн сар: хувь 1, тайлбаргүй; гарсан огноо өнгөрсөн бол идэвхгүй", () => {
  const full = employmentShare("2025-08", "2025-01-01", null);
  assert.equal(full.partial, false);
  assert.equal(full.note, null);
  assert.equal(proratedHours(168, full), 168);
  assert.equal(isTerminated("2025-09-15", "2025-09-15"), true);
  assert.equal(isTerminated("2025-09-30", "2025-09-15"), false);
  assert.equal(isTerminated(null, "2025-09-15"), false);
});

// Цалингийн нэмэгдэл/олговрын ЦЭВЭР тестүүд — overtime.md-ийн жишээ, ХЗ-ийн
// коэффициент, 12 сарын дундаж, ХЧТА-ийн "хувь заагаагүй бол зохиохгүй" дүрэм.

import assert from "node:assert/strict";
import test from "node:test";

import {
  averageDailyWage,
  averageMonthlyEarnings,
  computeOvertimePay,
  computeSickBenefit,
  computeVacationPay,
  LEGAL_OVERTIME_COEFFICIENTS,
  previousPeriodCodes,
} from "../lib/payroll/additions";

const noHours = {
  overtimeHours: 0,
  restDayHours: 0,
  holidayHours: 0,
  nightHours: 0,
};

test("илүү цаг — overtime.md-ийн жишээтэй таарна (11,905 × 1.5 × 5)", () => {
  const hourlyRate = Math.round((2_000_000 / 168) * 100) / 100; // 11,904.76
  const out = computeOvertimePay({
    hourlyRate,
    hours: { ...noHours, overtimeHours: 5 },
  });
  assert.equal(out.overtime, 89_286); // 11,904.76 × 1.5 × 5
  assert.equal(out.total, out.overtime);
});

test("баярын өдөр 2.0×, амралтын өдөр 1.5×, шөнө +20%", () => {
  const out = computeOvertimePay({
    hourlyRate: 10_000,
    hours: { overtimeHours: 1, restDayHours: 2, holidayHours: 3, nightHours: 4 },
  });
  assert.equal(out.overtime, 15_000); // 10,000 × 1.5 × 1
  assert.equal(out.restDay, 30_000); // 10,000 × 1.5 × 2
  assert.equal(out.holiday, 60_000); // 10,000 × 2.0 × 3
  assert.equal(out.night, 8_000); // 10,000 × 0.2 × 4 — зөвхөн НЭМЭГДЭЛ
  assert.equal(out.total, 113_000);
});

test("байгууллага коэффициентээ өсгөж болно (хуулиас дээгүүр)", () => {
  const out = computeOvertimePay({
    hourlyRate: 10_000,
    hours: { ...noHours, overtimeHours: 1 },
    coefficients: { overtime: 2 },
  });
  assert.equal(out.overtime, 20_000);
  // Бусад нь хуулийн суурь хэвээр
  assert.equal(LEGAL_OVERTIME_COEFFICIENTS.holiday, 2);
});

test("цаг байхгүй бол нэмэгдэл 0; сөрөг цаг ШИДНЭ", () => {
  assert.equal(computeOvertimePay({ hourlyRate: 10_000, hours: noHours }).total, 0);
  assert.throws(() =>
    computeOvertimePay({ hourlyRate: 10_000, hours: { ...noHours, overtimeHours: -1 } })
  );
});

test("өмнөх сарын кодууд — жилийн хилээр зөв ухарна", () => {
  assert.deepEqual(previousPeriodCodes("2026-02", 3), ["2026-01", "2025-12", "2025-11"]);
  assert.throws(() => previousPeriodCodes("2026-13", 3));
  assert.throws(() => previousPeriodCodes("2026-02", 0));
});

test("12 сарын дундаж — зөвхөн өмнөх сарууд, одоогийн сар ОРОХГҮЙ", () => {
  const history = [
    { periodMonth: "2026-09", earnings: 9_000_000 }, // тайлант сар — тооцогдохгүй
    { periodMonth: "2026-08", earnings: 1_000_000 },
    { periodMonth: "2026-07", earnings: 1_200_000 },
    { periodMonth: "2025-08", earnings: 800_000 }, // 13 сарын өмнөх — цонхноос гадуур
  ];
  const out = averageMonthlyEarnings({
    periodMonth: "2026-09",
    history,
    months: 12,
    baseSalary: 500_000,
  });
  assert.equal(out.monthsUsed, 2);
  assert.equal(out.monthly, 1_100_000);
  assert.equal(out.basis, "history");
});

test("түүхгүй ажилтан — үндсэн цалингаас, basis ИЛ тэмдэглэгдэнэ", () => {
  const out = averageMonthlyEarnings({
    periodMonth: "2026-09",
    history: [],
    months: 12,
    baseSalary: 1_500_000,
  });
  assert.deepEqual(out, { monthly: 1_500_000, monthsUsed: 0, basis: "baseSalary" });
});

test("ээлжийн амралт = өдрийн дундаж × хоног", () => {
  const daily = averageDailyWage(2_200_000, 22);
  assert.equal(daily, 100_000);
  assert.equal(computeVacationPay(daily, 15), 1_500_000);
  assert.equal(computeVacationPay(daily, 0), 0);
  assert.throws(() => averageDailyWage(2_200_000, 0));
});

test("ХЧТА — хувь заагаагүй бол null (дүн ЗОХИОХГҮЙ)", () => {
  const daily = 50_000;
  assert.equal(computeSickBenefit(daily, 4, null), null);
  assert.equal(computeSickBenefit(daily, 0, null), 0); // хоноггүй бол 0 гэдэг нь тодорхой
  assert.equal(computeSickBenefit(daily, 4, 50), 100_000);
  assert.throws(() => computeSickBenefit(daily, 4, 120));
});

// Цалингийн тохиргооны шалгалт — хуваагч 0 болохоос, хуулиас доогуур
// коэффициентээс хамгаална (lib/payroll/settings-input.ts).

import assert from "node:assert/strict";
import test from "node:test";

import {
  validatePayrollSettings,
  type PayrollSettingsInput,
} from "../lib/payroll/settings-input";

const VALID: PayrollSettingsInput = {
  minimumWage: 792_000,
  siCapMultiplier: 10,
  monthlyTaxFree: 0,
  standardMonthlyHours: 168,
  monthlyWorkDays: 22,
  averageEarningsMonths: 12,
  overtimeMultiplier: 1.5,
  restDayMultiplier: 1.5,
  holidayMultiplier: 2,
  nightBonusRate: 0.2,
};

test("хүчинтэй тохиргоо — numeric нь string болж, бүхэл нь тоогоор үлдэнэ", () => {
  const out = validatePayrollSettings(VALID);
  assert.equal(out.minimumWage, "792000");
  assert.equal(out.standardMonthlyHours, "168");
  assert.equal(out.monthlyWorkDays, "22");
  assert.equal(out.siCapMultiplier, 10);
  assert.equal(out.averageEarningsMonths, 12);
  assert.equal(out.holidayMultiplier, "2");
});

test("хуваагч 0 байж БОЛОХГҮЙ (цагийн хөлс, өдрийн дундаж)", () => {
  assert.throws(
    () => validatePayrollSettings({ ...VALID, standardMonthlyHours: 0 }),
    /стандарт ажлын цаг/
  );
  assert.throws(
    () => validatePayrollSettings({ ...VALID, monthlyWorkDays: 0 }),
    /ажлын өдрийн норм/
  );
  assert.throws(() => validatePayrollSettings({ ...VALID, monthlyWorkDays: 32 }));
});

test("коэффициент хуулийн доод хэмжээнээс ДООШ орохгүй", () => {
  assert.throws(
    () => validatePayrollSettings({ ...VALID, overtimeMultiplier: 1.2 }),
    /ХЗ 103/
  );
  assert.throws(
    () => validatePayrollSettings({ ...VALID, holidayMultiplier: 1.5 }),
    /ХЗ 108/
  );
  assert.throws(
    () => validatePayrollSettings({ ...VALID, nightBonusRate: 0.1 }),
    /ХЗ 106/
  );
});

test("хуулиас ДЭЭГҮҮР тогтоож болно", () => {
  const out = validatePayrollSettings({
    ...VALID,
    overtimeMultiplier: 2,
    nightBonusRate: 0.5,
  });
  assert.equal(out.overtimeMultiplier, "2");
  assert.equal(out.nightBonusRate, "0.5");
});

test("доод цалин, cap, татваргүй босго, дундажийн сар — хязгаарууд", () => {
  assert.throws(() => validatePayrollSettings({ ...VALID, minimumWage: 0 }));
  assert.throws(() => validatePayrollSettings({ ...VALID, siCapMultiplier: 0 }));
  assert.throws(() => validatePayrollSettings({ ...VALID, siCapMultiplier: 10.5 }));
  assert.throws(() => validatePayrollSettings({ ...VALID, monthlyTaxFree: -1 }));
  assert.throws(() =>
    validatePayrollSettings({ ...VALID, averageEarningsMonths: 0 })
  );
  assert.throws(() =>
    validatePayrollSettings({ ...VALID, averageEarningsMonths: 61 })
  );
  // 2026 татваргүй босго идэвхжүүлэх нь хүчинтэй
  assert.equal(
    validatePayrollSettings({ ...VALID, monthlyTaxFree: 800_000 }).monthlyTaxFree,
    "800000"
  );
});

test("тоо болохгүй утга ШИДНЭ (зохиохгүй)", () => {
  assert.throws(() =>
    validatePayrollSettings({
      ...VALID,
      minimumWage: Number.NaN,
    })
  );
});

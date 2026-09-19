// Цалингийн хуудсын ЦЭВЭР бүтэц — тэнцэл, задаргаа, гар засварын тэмдэг.

import assert from "node:assert/strict";
import test from "node:test";

import { LEGAL_OVERTIME_COEFFICIENTS } from "../lib/payroll/additions";
import { buildPayslip, type PayslipLineInput } from "../lib/payroll/payslip";

const BASE: PayslipLineInput = {
  employeeId: "emp-1",
  employeeName: "Б. Болд",
  registerNo: "УК12345678",
  position: "Нягтлан бодогч",
  department: "Санхүү",
  baseSalary: 2_000_000,
  standardHours: 168,
  workedHours: 168,
  baseEarnings: 2_000_000,
  overtimeHours: 0,
  restDayHours: 0,
  holidayHours: 0,
  nightHours: 0,
  overtimePay: 0,
  overtimePayManual: false,
  vacationDays: 0,
  vacationPay: 0,
  vacationPayManual: false,
  otherAdditions: 0,
  earnings: 2_000_000,
  employeeSi: 230_000,
  pit: 163_000,
  otherDeductions: 0,
  sickDays: 0,
  sickBenefit: 0,
  sickBenefitManual: false,
  netSalary: 1_607_000,
  advanceAmount: 600_000,
  finalNet: 1_007_000,
  employerSi: 250_000,
  averageMonthlyEarnings: 0,
  averageMonthsUsed: 0,
};

const build = (line: Partial<PayslipLineInput>) =>
  buildPayslip({
    periodMonth: "2026-09",
    line: { ...BASE, ...line },
    coefficients: LEGAL_OVERTIME_COEFFICIENTS,
    monthlyWorkDays: 22,
  });

test("энгийн хуудас — олголт − суутгал = гарт олгох, урьдчилгаа задарна", () => {
  const slip = build({});
  assert.equal(slip.earnings.total, 2_000_000);
  assert.equal(slip.deductions.total, 393_000);
  assert.equal(slip.netSalary, 1_607_000);
  assert.equal(slip.advanceAmount + slip.finalNet, slip.netSalary);
  assert.equal(slip.taxFree, null);
  assert.equal(slip.earnings.lines[0].note, "ажилласан 168 / 168 цаг");
});

test("дүн 0 мөр хуудсанд ГАРАХГҮЙ", () => {
  const slip = build({});
  assert.equal(slip.earnings.lines.length, 1); // зөвхөн үндсэн цалин
  assert.ok(!slip.deductions.lines.some((row) => row.label === "Бусад суутгал"));
});

test("илүү цагийн задаргаа — нийлбэр нь хадгалагдсан дүнтэй ТААРНА", () => {
  // 11,904.76 цагийн хөлс: илүү цаг 5ц, баярын өдөр 8ц, шөнө 10ц
  const overtimePay = 89_286 + 190_476 + 23_810;
  const slip = build({
    overtimeHours: 5,
    holidayHours: 8,
    nightHours: 10,
    overtimePay,
    earnings: 2_000_000 + overtimePay,
    netSalary: 1_607_000 + overtimePay,
    finalNet: 1_007_000 + overtimePay,
  });
  const shown = slip.earnings.lines
    .filter((row) => row.label !== "Үндсэн цалин")
    .reduce((sum, row) => sum + row.amount, 0);
  assert.equal(shown, overtimePay);
  assert.ok(slip.earnings.lines.some((row) => row.note === "5 цаг × 1.5"));
  assert.ok(slip.earnings.lines.some((row) => row.note === "8 цаг × 2"));
  // Ажиллаагүй ангилал мөр болохгүй
  assert.ok(!slip.earnings.lines.some((row) => row.label === "Амралтын өдрийн нэмэгдэл"));
});

test("гараар дарж бичсэн нэмэгдэл задрахгүй, «гараар» гэж тэмдэглэгдэнэ", () => {
  const slip = build({
    overtimeHours: 5,
    overtimePay: 120_000,
    overtimePayManual: true,
    earnings: 2_120_000,
    netSalary: 1_727_000,
    finalNet: 1_127_000,
  });
  const line = slip.earnings.lines.find((row) => row.note === "гараар");
  assert.equal(line?.amount, 120_000);
  assert.equal(line?.label, "Илүү цаг, шөнийн нэмэгдэл");
});

test("ХЧТА тэтгэмж — ТУСДАА татваргүй хэсэг, гарт олгоход нэмэгдэнэ", () => {
  const slip = build({
    sickDays: 4,
    sickBenefit: 200_000,
    netSalary: 1_807_000,
    finalNet: 1_207_000,
    averageMonthlyEarnings: 2_200_000,
    averageMonthsUsed: 12,
  });
  assert.equal(slip.taxFree?.total, 200_000);
  assert.equal(slip.taxFree?.lines[0].note, "4 хоног");
  // Татварын суурь хөндөгдөөгүй
  assert.equal(slip.earnings.total, 2_000_000);
  assert.equal(slip.deductions.total, 393_000);
  assert.ok(slip.averageNote?.includes("сүүлийн 12 сар"));
  assert.ok(slip.averageNote?.includes("100,000")); // өдрийн дундаж 2.2M / 22
});

test("түүхгүй ажилтан — дундажийн суурь ИЛ бичигдэнэ", () => {
  const slip = build({
    vacationDays: 5,
    vacationPay: 454_545,
    earnings: 2_454_545,
    netSalary: 2_061_545,
    finalNet: 1_461_545,
    averageMonthlyEarnings: 2_000_000,
    averageMonthsUsed: 0,
  });
  assert.ok(slip.averageNote?.includes("түүх байхгүй"));
  assert.ok(slip.earnings.lines.some((row) => row.note === "5 хоног"));
});

test("тэнцэхгүй өгөгдөл ШИДНЭ (буруу хуудас ажилтанд очихгүй)", () => {
  assert.throws(() => build({ netSalary: 1_500_000 }), /тэнцэхгүй/);
});

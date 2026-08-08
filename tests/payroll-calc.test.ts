import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPayrollJournalLines,
  computeEmployeePayroll,
  pitBeforeCredit,
  pitCreditOf,
} from "../lib/payroll/calc";

// worked-example.md-ийн Б.Болд жишээ (2,239,288₮ нийт олголт, ҮОМШӨ 0.8%,
// бусад суутгал 50,000₮) — тоонууд ЯГ таарах ёстой.
const BOLD = {
  earnings: 2_239_288,
  otherDeductions: 50_000,
  accidentRatePercent: 0.8,
  date: "2026-07-31",
  minimumWage: 792_000,
  siCapMultiplier: 10,
};

test("worked example: ажилтны НДШ 257,518", () => {
  const result = computeEmployeePayroll(BOLD);
  assert.equal(result.employeeSi, 257_518);
});

test("worked example: ХАОАТ 184,177 (шатлал + хөнгөлөлт 14,000)", () => {
  const result = computeEmployeePayroll(BOLD);
  assert.equal(result.taxableIncome, 1_981_770);
  assert.equal(result.pit, 184_177);
});

test("worked example: гарт олгох 1,747,593", () => {
  const result = computeEmployeePayroll(BOLD);
  assert.equal(result.netSalary, 1_747_593);
});

test("worked example: АО НДШ 279,911, нийт зардал 2,519,199", () => {
  const result = computeEmployeePayroll(BOLD);
  assert.equal(result.employerSi, 279_911);
  assert.equal(result.totalCost, 2_519_199);
});

test("НДШ cap: 10 сая цалинд суурь нь 7,920,000-аар таслагдана", () => {
  const result = computeEmployeePayroll({ ...BOLD, earnings: 10_000_000, otherDeductions: 0 });
  assert.equal(result.cappedBase, 7_920_000);
  assert.equal(result.employeeSi, Math.round(7_920_000 * 0.115));
});

test("ХАОАТ 2026 шатлал: 12 сая ногдох орлогод 10%+15% давхарлана", () => {
  // 10M×10% + 2M×15% = 1,300,000
  assert.equal(pitBeforeCredit(12_000_000, "2026-01-31"), 1_300_000);
  // 16M: 1M + 0.75M + 1M×20% = 1,950,000
  assert.equal(pitBeforeCredit(16_000_000, "2026-01-31"), 1_950_000);
});

test("ХАОАТ 2025: flat 10% (effective date)", () => {
  assert.equal(pitBeforeCredit(12_000_000, "2025-12-31"), 1_200_000);
});

test("хөнгөлөлтийн шатлал pit.md-ийн дагуу", () => {
  assert.equal(pitCreditOf(400_000), 20_000);
  assert.equal(pitCreditOf(1_981_770), 14_000);
  assert.equal(pitCreditOf(3_000_001), 0);
});

test("татваргүй босго (2026: 800k) идэвхжүүлбэл ногдох орлогыг бууруулна", () => {
  const withFree = computeEmployeePayroll({ ...BOLD, monthlyTaxFree: 800_000 });
  assert.equal(withFree.taxableIncome, 1_981_770 - 800_000);
});

test("GL журнал: Dr = Cr тэнцэнэ, суутгалгүй бол 5 мөр", () => {
  const totals = {
    earnings: 2_239_288,
    employeeSi: 257_518,
    employerSi: 279_911,
    pit: 184_177,
    otherDeductions: 50_000,
    netSalary: 1_747_593,
  };
  const accounts = {
    salaryExpense: "72100000",
    employerSiExpense: "72100002",
    siPayable: "31420000",
    pitPayable: "31430000",
    salaryPayable: "31500001",
    deduction: "31900001",
  };
  const lines = buildPayrollJournalLines(totals, accounts, "2026-07");
  const dr = lines.reduce((sum, line) => sum + line.debit, 0);
  const cr = lines.reduce((sum, line) => sum + line.credit, 0);
  assert.equal(dr, cr);
  assert.equal(lines.length, 6); // суутгалтай тул 6 мөр
  const noDeduction = buildPayrollJournalLines(
    { ...totals, otherDeductions: 0, netSalary: totals.netSalary + 50_000 },
    accounts,
    "2026-07"
  );
  assert.equal(noDeduction.length, 5);
  assert.equal(
    noDeduction.reduce((sum, line) => sum + line.debit - line.credit, 0),
    0
  );
});

test("суутгал нийт олголтоос ихдвэл алдаа", () => {
  assert.throws(() =>
    computeEmployeePayroll({ ...BOLD, earnings: 100_000, otherDeductions: 200_000 })
  );
});

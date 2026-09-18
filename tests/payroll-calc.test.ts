import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPayrollJournalLines,
  computeEmployeePayroll,
  pitBeforeCredit,
  pitCreditOf,
} from "../lib/payroll/calc";

// worked-example.md-ийн Б.Болд жишээ (2,239,288₮ нийт олголт, АО-НДШ 12.5%
// = суурь 11.7 + ҮОМШӨ 0.8, бусад суутгал 50,000₮) — тоонууд ЯГ таарах ёстой.
const BOLD = {
  earnings: 2_239_288,
  otherDeductions: 50_000,
  employerSiPercent: 12.5,
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

// ── Урьдчилгаа цалин (ажилласан цагаар, суутгалгүй) ─────────────────────────
// Урьдчилгаа нь НЭМЭЛТ олголт БИШ — сарын гарт олгох цалинг хоёр төлбөр
// болгон хуваадаг тул НДШ/ХАОАТ/нийт гарт олгох дүн ӨӨРЧЛӨГДӨХГҮЙ байх ёстой.

const ADVANCE_BASE = {
  earnings: 2_000_000,
  employerSiPercent: 12.5,
  date: "2026-07-31",
  minimumWage: 792_000,
  siCapMultiplier: 10,
  standardMonthlyHours: 168,
  advanceBaseSalary: 2_000_000,
};

test("урьдчилгаа: цагийн хөлс = үндсэн цалин / стандарт цаг", () => {
  const result = computeEmployeePayroll({ ...ADVANCE_BASE, advanceHours: 80 });
  // 2,000,000 / 168 = 11,904.76₮/цаг
  assert.equal(result.hourlyRate, 11_904.76);
  assert.equal(result.advanceAmount, Math.round(11_904.76 * 80));
  assert.equal(result.advanceHours, 80);
});

test("урьдчилгаа нь НДШ, ХАОАТ, нийт гарт олгохыг өөрчлөхгүй", () => {
  const without = computeEmployeePayroll({ ...ADVANCE_BASE, advanceHours: 0 });
  const withAdvance = computeEmployeePayroll({
    ...ADVANCE_BASE,
    advanceHours: 80,
  });
  assert.equal(withAdvance.employeeSi, without.employeeSi);
  assert.equal(withAdvance.employerSi, without.employerSi);
  assert.equal(withAdvance.pit, without.pit);
  assert.equal(withAdvance.netSalary, without.netSalary);
  assert.equal(withAdvance.earnings, without.earnings);
});

test("урьдчилгаа + сүүл цалин = сарын нийт гарт олгох", () => {
  const result = computeEmployeePayroll({ ...ADVANCE_BASE, advanceHours: 80 });
  assert.equal(result.advanceAmount + result.finalNet, result.netSalary);
  assert.ok(result.finalNet > 0);
});

test("урьдчилгаагүй мөр: сүүл цалин = нийт гарт олгох", () => {
  const result = computeEmployeePayroll(ADVANCE_BASE);
  assert.equal(result.advanceAmount, 0);
  assert.equal(result.hourlyRate, 11_904.76);
  assert.equal(result.finalNet, result.netSalary);
});

test("урьдчилгаа нь гарт олгохоос их бол ШИДНЭ (сөрөг сүүл цалин)", () => {
  assert.throws(
    () => computeEmployeePayroll({ ...ADVANCE_BASE, advanceHours: 200 }),
    /Урьдчилгаа нь сарын гарт олгох цалингаас их/
  );
});

test("стандарт ажлын цаг 0 байхад урьдчилгаа бодохгүй — ШИДНЭ", () => {
  assert.throws(
    () =>
      computeEmployeePayroll({
        ...ADVANCE_BASE,
        standardMonthlyHours: 0,
        advanceHours: 10,
      }),
    /стандарт ажлын цаг/
  );
});

test("сөрөг ажилласан цаг хориотой", () => {
  assert.throws(
    () => computeEmployeePayroll({ ...ADVANCE_BASE, advanceHours: -1 }),
    /Ажилласан цаг/
  );
});

test("урьдчилгаа нь ҮНДСЭН цалингаар бодогдоно (урамшуулал орохгүй)", () => {
  // Нийт олголт урамшууллаар өссөн ч урьдчилгааны суурь нь үндсэн цалин.
  const result = computeEmployeePayroll({
    ...ADVANCE_BASE,
    earnings: 3_000_000,
    advanceBaseSalary: 2_000_000,
    advanceHours: 84,
  });
  assert.equal(result.hourlyRate, 11_904.76);
  assert.equal(result.advanceAmount, Math.round(11_904.76 * 84));
});

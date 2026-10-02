import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportDataDetail, findReportRow, mappingProblems, normalizeCellMapping, parseFormDetail, parseReportList } from "../lib/itc/etax/api";
import { ETAX_FIELD_LABELS, ETAX_FORMS, ETAX_FORM_KEYS, ETAX_SHEET_SOURCES, isEtaxFormKey } from "../lib/itc/etax/constants";
import {
  buildCitSnapshot,
  buildPitSnapshot,
  deadlineOf,
  etaxPeriodOf,
  periodCodeFor,
  periodLabelOf,
  periodRangeOf,
  validateSnapshot,
  type CitTotals,
  type PitTotals,
} from "../lib/itc/etax/submission";

// eTax — олон маягт (НӨАТ / ХАОАТ / ААНОАТ): тайлант үеийн код, өссөн дүн, snapshot, шалгалт,
// холболт маягтын талбараар. Дүн зохиохгүй — ХАОАТ цалингийн мөрөөс, ААНОАТ дансны дүн + элэгдлийн зөрүү.

const taxpayer = { name: "Хос Хас Технологи ХХК", registerNo: "6543210", vatPayerNo: null };

test("маягт бүр талбар, шошго, заавал талбар, картын талбартай; түлхүүр шалгалт", () => {
  for (const key of ETAX_FORM_KEYS) {
    const meta = ETAX_FORMS[key];
    assert.ok(meta.fields.length >= 5);
    for (const f of meta.fields) assert.ok(ETAX_FIELD_LABELS[f], `${key}.${f} шошгогүй`);
    for (const f of meta.requiredFields) assert.ok(meta.fields.includes(f));
    for (const f of meta.cardFields) assert.ok(meta.fields.includes(f));
    assert.ok(meta.cardFields.length <= 4);
  }
  assert.equal(isEtaxFormKey("pit"), true);
  assert.equal(isEtaxFormKey("vat2"), false);
  assert.ok(ETAX_SHEET_SOURCES.includes("payroll"));
});

test("тайлант үе — сар/улирал/жил код, ТЕГ-ийн period, огнооны муж (ААНОАТ жилийн эхнээс), хугацаа", () => {
  assert.equal(periodCodeFor("vat", "2026-09"), "2026-09");
  assert.equal(periodCodeFor("pit", "2026-09"), "2026-09");
  assert.equal(periodCodeFor("cit", "2026-09"), "2026-Q3");
  assert.equal(periodCodeFor("cit", "2026-12"), "2026-Q4");
  assert.throws(() => periodCodeFor("cit", "2026-13"), /YYYY-MM/);
  assert.deepEqual(etaxPeriodOf("2026-Q3"), { year: 2026, period: 3, kind: "quarter" });
  assert.deepEqual(etaxPeriodOf("2026"), { year: 2026, period: 1, kind: "year" });
  assert.deepEqual(etaxPeriodOf("2026-02"), { year: 2026, period: 2, kind: "month" });
  assert.throws(() => etaxPeriodOf("2026-Q5"), /буруу/);
  assert.deepEqual(periodRangeOf("vat", "2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodRangeOf("cit", "2026-Q3"), { from: "2026-01-01", to: "2026-09-30" }); // өссөн дүнгээр
  assert.deepEqual(periodRangeOf("cit", "2026"), { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(deadlineOf("pit", "2026-12"), "2027-01-10");
  assert.equal(deadlineOf("cit", "2026-Q3"), "2026-10-20");
  assert.equal(deadlineOf("cit", "2026-Q4"), "2027-01-20");
  assert.equal(deadlineOf("cit", "2026"), "2027-02-10");
  assert.ok(periodLabelOf("2026-Q3").includes("3-р улирал"));
});

const pitTotals: PitTotals = {
  periodCode: "2026-09",
  employeeCount: 12,
  earnings: 36_000_000,
  employeeSi: 4_140_000,
  taxableIncome: 31_620_000,
  pitCredit: 240_000,
  pit: 2_922_000,
  netSalary: 28_938_000,
  runStatus: "voucher_created",
  voucherStatus: "posted",
  monthlyTaxFree: 20_000,
};

test("ХАОАТ snapshot — цалингийн нийлбэр, ТТ-11, сарын хугацаа; шалгалт уялдаа + анхааруулга", () => {
  const snap = buildPitSnapshot({ totals: pitTotals, taxpayer, computedAt: new Date("2026-10-02T03:00:00Z") });
  assert.equal(snap.form, "pit");
  assert.equal(snap.formCode, "ТТ-11");
  assert.equal(snap.deadline, "2026-10-10");
  assert.equal(snap.amounts.pit, 2_922_000);
  assert.equal(snap.amounts.employeeCount, 12);
  assert.deepEqual(validateSnapshot(snap, "2026-10-05").errors, []);
  assert.deepEqual(validateSnapshot(snap, "2026-10-05").warnings, []);
  const draft = buildPitSnapshot({ totals: { ...pitTotals, voucherStatus: "draft" }, taxpayer, computedAt: new Date() });
  assert.ok(validateSnapshot(draft, "2026-10-05").warnings.some((w) => w.includes("батлагдаагүй")));
  const noRun = buildPitSnapshot({ totals: { ...pitTotals, employeeCount: 0, earnings: 0, employeeSi: 0, taxableIncome: 0, pitCredit: 0, pit: 0, netSalary: 0, runStatus: null }, taxpayer, computedAt: new Date() });
  assert.ok(validateSnapshot(noRun, "2026-10-05").warnings.some((w) => w.includes("тэг тайлан")));
  const bad = buildPitSnapshot({ totals: { ...pitTotals, pit: 40_000_000 }, taxpayer, computedAt: new Date() });
  assert.ok(validateSnapshot(bad, "2026-10-05").errors.some((e) => e.includes("Суутгасан ХАОАТ")));
});

const citTotals: CitTotals = {
  periodCode: "2026-Q3",
  revenue: 900_000_000,
  cogs: 500_000_000,
  operatingExpenses: 250_000_000,
  financeExpenses: 10_000_000,
  bookDepreciation: 30_000_000,
  taxDepreciation: 24_000_000,
  accountCount: 40,
};

test("ААНОАТ snapshot — өссөн дүн, нийт зардал, ашиг, элэгдлийн зөрүүгээр тохируулсан ашиг; шалгалт", () => {
  const snap = buildCitSnapshot({ totals: citTotals, taxpayer, computedAt: new Date("2026-10-02T03:00:00Z") });
  assert.equal(snap.form, "cit");
  assert.equal(snap.formCode, "ТТ-02");
  assert.deepEqual(snap.range, { from: "2026-01-01", to: "2026-09-30" });
  assert.equal(snap.deadline, "2026-10-20");
  assert.equal(snap.amounts.totalExpenses, 760_000_000);
  assert.equal(snap.amounts.profitBeforeTax, 140_000_000);
  assert.equal(snap.amounts.depreciationAdjustedProfit, 146_000_000); // ашиг + дансны элэгдэл − татварын элэгдэл
  const result = validateSnapshot(snap, "2026-10-05");
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((w) => w.includes("бусад тохируулга")));
  const broken = { ...snap, amounts: { ...snap.amounts, totalExpenses: 1 } };
  assert.ok(validateSnapshot(broken, "2026-10-05").errors.some((e) => e.includes("Нийт зардал")));
  const noTaxDep = buildCitSnapshot({ totals: { ...citTotals, taxDepreciation: 0 }, taxpayer, computedAt: new Date() });
  assert.ok(validateSnapshot(noTaxDep, "2026-10-05").warnings.some((w) => w.includes("Татварын элэгдэл 0")));
});

const listRows = parseReportList({
  code: 0,
  reportList: [
    { id: "1", taxReportCode: "ТТ-03А", taxTypeId: 4, taxTypeName: "Нэмэгдсэн өртгийн албан татвар", branchId: 25, period: 9, periodYear: 2026, formNo: 1145, revenueId: 1 },
    { id: "2", taxReportCode: "ТТ-11", taxTypeId: 7, taxTypeName: "Цалин, хөдөлмөрийн хөлс, тэдгээртэй адилтгах орлогоос суутгасан татвар", branchId: 25, period: 9, periodYear: 2026, formNo: 1250, revenueId: 2 },
    { id: "3", taxReportCode: "ТТ-02", taxTypeId: 32, taxTypeName: "Аж ахуйн нэгжийн орлогын албан татвар", branchId: 25, period: 3, periodYear: 2026, formNo: 1252, revenueId: 3 },
  ],
});

test("findReportRow — маягт бүр нэрийн загвараар, тайлант үе сар/улирал", () => {
  assert.equal(findReportRow(listRows, "vat", "2026-09").id, "1");
  assert.equal(findReportRow(listRows, "pit", "2026-09").id, "2");
  assert.equal(findReportRow(listRows, "cit", "2026-Q3").id, "3");
  assert.throws(() => findReportRow(listRows, "cit", "2026-09"), /ААНОАТ-ын тайлан алга/);
  assert.equal(findReportRow(listRows, "cit", "2026-Q3", { taxTypeId: 32 }).id, "3");
});

test("нүдний холболт маягтаар — ХАОАТ заавал earnings + pit; ААНОАТ revenue + profitBeforeTax; сөрөг ашиг allowMinus", () => {
  const cells = parseFormDetail({
    code: 0,
    reportFormPass: {
      reportFormInfo: { formNo: "1252", reportCode: "ТТ-02" },
      sections: [{ title: "A", sectionNo: 1, headers: [], rows: [
        { rowNumber: 1, cells: [{ tagId: 1, key: "R1", isDisable: true, allowMinus: false }] },
        { rowNumber: 2, cells: [{ tagId: 2, key: "R2", isDisable: true, allowMinus: true }] },
        { rowNumber: 3, cells: [{ tagId: 3, key: "R3", isDisable: true, allowMinus: false }] },
      ] }],
    },
  }).cells;
  const pitMap = normalizeCellMapping({ earnings: "R1", pit: "R3", junk: "x" }, "pit");
  assert.deepEqual(Object.keys(pitMap), [...ETAX_FORMS.pit.fields]);
  assert.deepEqual(mappingProblems(pitMap, cells, "pit"), []);
  assert.ok(mappingProblems(normalizeCellMapping({ earnings: "R1" }, "pit"), cells, "pit").some((p) => p.includes("Суутгасан ХАОАТ")));

  const citMap = normalizeCellMapping({ revenue: "R1", profitBeforeTax: "R2" }, "cit");
  assert.deepEqual(mappingProblems(citMap, cells, "cit"), []);
  const loss = buildCitSnapshot({ totals: { ...citTotals, revenue: 100 }, taxpayer, computedAt: new Date() });
  assert.ok(loss.amounts.profitBeforeTax < 0);
  const detail = buildReportDataDetail(loss, citMap, cells);
  assert.deepEqual(detail.map((d) => d.tagKey), ["R1", "R2"]);
  assert.equal(detail[1].value, "-759999900");
  // алдагдлыг хасах утга авдаггүй нүдэнд → шиднэ
  assert.throws(() => buildReportDataDetail(loss, normalizeCellMapping({ revenue: "R1", profitBeforeTax: "R3" }, "cit"), cells), /хасах утга/);
});

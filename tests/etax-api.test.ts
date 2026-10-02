import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildReportDataDetail,
  cellValueOf,
  describeCell,
  etaxPeriodOf,
  findHistoryRow,
  findVatReportRow,
  mappingProblems,
  normalizeCellMapping,
  parseFormDetail,
  parseHistory,
  parseReportList,
  parseSaveResponse,
  parseSubmitResponse,
  parseUserOrgs,
  pickEtaxOrg,
  reportHeadOf,
  saveFormDataBody,
  submitBody,
  taxStatusToEntry,
  type EtaxFormCell,
} from "../lib/itc/etax/api";
import { etaxApiBase, etaxClientId, etaxNeKey } from "../lib/itc/etax/client";
import { ETAX_PATHS, ETAX_TAX_STATUS } from "../lib/itc/etax/constants";
import { EtaxError, buildVatSnapshot } from "../lib/itc/etax/submission";

// eTax API-ийн ЦЭВЭР хэсэг — АЛБАН спек docs/integrations/etax/00-etax-api-spec.md §3-ын
// жишээ хариугаар тулгав. Таамаглахгүй: танигдахгүй хариу / код ≠ 0 → EtaxError.

test("замууд спекээс үгчлэн; client_id staging албан, бодит env-ээр; NE-KEY env", () => {
  assert.equal(ETAX_PATHS.saveFormData, "/api/beta/return/saveFormData");
  assert.equal(ETAX_PATHS.submit, "/api/beta/return/submit");
  assert.equal(ETAX_PATHS.userOrgs, "/api/beta/user/getUserOrgs");
  assert.equal(etaxClientId("staging", {}), "etax-api-staging");
  assert.equal(etaxClientId("production", { ETAX_CLIENT_ID: "etax-api" }), "etax-api");
  assert.equal(etaxApiBase("production", {}), "https://etax.mta.mn");
  assert.equal(etaxApiBase("staging", { ETAX_API_BASE: "https://proxy.example/etax" }), "https://st-etax.mta.mn");
  assert.equal(etaxApiBase("production", { ETAX_API_BASE: "https://proxy.example/etax/" }), "https://proxy.example/etax");
  assert.throws(() => etaxApiBase("production", { ETAX_API_BASE: "ftp://x" }), /ETAX_API_BASE/);
  assert.equal(etaxNeKey({}), null);
  assert.equal(etaxNeKey({ ETAX_NE_KEY: " k " }), "k");
});

test("parseUserOrgs — спекийн жишээ (нэг объект) ба массив; pickEtaxOrg регистрээр", () => {
  const sample = {
    id: 8888888, Tin: "888888888", entType: 2, parentId: 88888888, entStatus: 2, entityName: "Тестийн хэрэглэгч", Pin: "88888888", isConfirmed: 1,
    refEntType: { code: "Organization", name: "Хуулийн этгээд" }, refEntStatus: { Code: "REG", name: "Бүртгэгдсэн" },
    taxpayerBranchView: { branchCode: "25", branchName: "Сүхбаатар дүүрэг", subBranchCode: "1548", subBranchName: "18-р хороо" },
    agreeGeneralRoleUser: true, ebarimtLogin: true,
  };
  const [org] = parseUserOrgs(sample);
  assert.deepEqual(org, {
    entId: 8888888, tin: "888888888", pin: "88888888", name: "Тестийн хэрэглэгч", entType: 2, entStatus: 2, isConfirmed: true,
    branchCode: "25", branchName: "Сүхбаатар дүүрэг", subBranchCode: "1548", subBranchName: "18-р хороо", isGeneralAccountant: true,
  });
  const two = parseUserOrgs([sample, { ...sample, id: 1, Pin: "6543210" }]);
  assert.equal(two.length, 2);
  assert.equal(pickEtaxOrg(two, "6543210").entId, 1);
  assert.equal(pickEtaxOrg([org], null).entId, 8888888);
  assert.throws(() => pickEtaxOrg(two, "0000000"), /2 байгууллагатай/);
  assert.throws(() => pickEtaxOrg([], null), /алга/);
  assert.deepEqual(parseUserOrgs({ message: "x" }), []);
});

const listRow = {
  id: "77", taxReportCode: "ТТ-03А", taxTypeId: 4, taxTypeName: "Нэмэгдсэн өртгийн албан татвар", branchId: 25, branchCode: "25",
  branchName: "Сүхбаатар", periodId: 9, period: 9, periodYear: 2026, periodName: "9-р сар", returnBeginDate: "2026-10-01",
  returnDueDate: "2026-10-10", reportNo: null, taxReportStatus: null, taxReportStatusName: "", formNo: 1145, rsId: 0, licenseNo: "", revenueId: 7472744,
};

test("parseReportList — код ≠ 0 шиднэ; findVatReportRow үе + НӨАТ нэрээр, олон бол шиднэ", () => {
  assert.throws(() => parseReportList({ code: 5, message: "Эрхгүй" }), (e: unknown) => e instanceof EtaxError && /код 5 — Эрхгүй/.test(e.message));
  const rows = parseReportList({ code: 0, reportList: [listRow, { ...listRow, id: "78", taxTypeId: 7, taxTypeName: "ХХОАТ", period: 9 }] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].formNo, 1145);
  assert.equal(rows[0].reportNo, null);
  assert.equal(findVatReportRow(rows, "2026-09").id, "77");
  assert.equal(findVatReportRow(rows, "2026-09", { taxTypeId: 7 }).id, "78");
  assert.throws(() => findVatReportRow(rows, "2026-08"), /алга/);
  const dup = parseReportList({ code: 0, reportList: [listRow, { ...listRow, id: "79", formNo: 1200 }] });
  assert.throws(() => findVatReportRow(dup, "2026-09"), /2 НӨАТ-ын мөр/);
  assert.equal(findVatReportRow(dup, "2026-09", { formNo: 1200 }).id, "79");
  assert.deepEqual(etaxPeriodOf("2026-09"), { year: 2026, period: 9 });
  assert.throws(() => etaxPeriodOf("2026-9"), /YYYY-MM/);
});

test("parseHistory — үүрлэсэн historyList → мөр; төлвийн код → Entry төлөв", () => {
  const rows = parseHistory({
    code: 0,
    historyList: [
      {
        taxReportCode: "ТТ-03А", taxReportName: "НӨАТ", taxTypeCode: "04",
        returnPeriods: [{ year: 2026, period: 9, reports: [{ reportNo: "9644301", taxFormNo: 1145, refReportStatusId: 11, refReportStatusName: "Хүлээн авсан", assessmentAmount: 400000 }] }],
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reportNo, "9644301");
  assert.equal(rows[0].year, 2026);
  assert.equal(rows[0].taxReportCode, "ТТ-03А");
  assert.equal(taxStatusToEntry(ETAX_TAX_STATUS.saved), "saved");
  assert.equal(taxStatusToEntry(3), "submitted");
  assert.equal(taxStatusToEntry(6), "submitted");
  assert.equal(taxStatusToEntry(11), "accepted");
  assert.equal(taxStatusToEntry(8), "rejected");
  assert.equal(taxStatusToEntry(99), null);
  assert.equal(findHistoryRow(rows, { reportNo: 9644301, year: 2026, period: 9, formNo: null })?.statusId, 11);
  assert.equal(findHistoryRow(rows, { reportNo: null, year: 2026, period: 9, formNo: 1145 })?.statusId, 11);
  assert.equal(findHistoryRow(rows, { reportNo: null, year: 2026, period: 8, formNo: 1145 }), null);
});

const template = {
  code: 0,
  reportFormPass: {
    reportFormInfo: { formNo: "1145", reportCode: "ТТ-03А", taxTypeCode: "04", reportName: "НӨАТ-ын тайлан", reportFrequency: "Сар", version: 3 },
    sections: [
      {
        title: "Үндсэн", sectionNo: 1,
        headers: [{ sequence: 1, name: "Үзүүлэлт", field: "c1" }, { sequence: 2, name: "Дүн", field: "c2" }],
        rows: [
          { rowNumber: 1, cells: [{ tagId: 101, key: "TG101", columnKey: "c2", columnSequence: 2, dataType: "number", isDisable: true, allowMinus: false, expression: "" }] },
          { rowNumber: 2, cells: [{ tagId: 102, key: "TG102", columnKey: "c2", columnSequence: 2, dataType: "number", isDisable: true, allowMinus: false }] },
          { rowNumber: 3, cells: [{ tagId: 103, key: "TG103", columnKey: "c2", columnSequence: 2, dataType: "number", isDisable: false, expression: "TG101-TG102",
            validations: [{ validationKey: "V1", cellKey: "TG103", validCondition: ">=0", errorType: "error", errorMessage: "Сөрөг" }] }] },
          { rowNumber: 4, cells: [{ tagId: 104, key: "TG104", columnKey: "c2", columnSequence: 2, dataType: "number", isDisable: true, allowMinus: true }] },
        ],
      },
    ],
  },
};

test("parseFormDetail — нүд, багана нэр, томьёо, validations; describeCell", () => {
  const form = parseFormDetail(template);
  assert.equal(form.formNo, "1145");
  assert.equal(form.reportCode, "ТТ-03А");
  assert.equal(form.cells.length, 4);
  const c103 = form.cells.find((c) => c.key === "TG103")!;
  assert.equal(c103.hasExpression, true);
  assert.equal(c103.acceptsValue, false);
  assert.equal(c103.columnName, "Дүн");
  assert.equal(c103.validations[0].message, "Сөрөг");
  assert.equal(describeCell(c103), "TG103 — Үндсэн · мөр 3 · Дүн (томьёотой)");
  assert.throws(() => parseFormDetail({ code: 0, reportFormPass: { sections: [] } }), /нүд алга/);
});

test("холболт — бүрдэл, давхардал, загварт байхгүй нүд; reportDataDetail дүнг л буулгана", () => {
  const cells = parseFormDetail(template).cells;
  const mapping = normalizeCellMapping({ outputVat: "TG101", inputVat: "TG102", payableVat: "TG104", carriedInVat: "", junk: "x" });
  assert.deepEqual(mapping, { outputVat: "TG101", inputVat: "TG102", carriedInVat: null, payableVat: "TG104", refundableVat: null });
  assert.deepEqual(mappingProblems(mapping, cells), []);
  assert.ok(mappingProblems({ outputVat: "TG101" }, cells).some((p) => p.includes("payableVat")));
  assert.ok(mappingProblems({ outputVat: "TG101", inputVat: "TG101", payableVat: "TG104" }, cells).some((p) => p.includes("хоёулаа")));
  assert.ok(mappingProblems({ outputVat: "TG999", inputVat: "TG102", payableVat: "TG104" }, cells).some((p) => p.includes("TG999")));

  const snapshot = buildVatSnapshot({
    summary: { periodCode: "2026-09", outputVat: 1_250_000, inputVat: 800_000.5, carriedInVat: 0, payableVat: 449_999.5, refundableVat: 0, deadline: "2026-10-10", outputLineCount: 1, inputLineCount: 1 },
    settings: { outputVatAccountNumber: "31410000", inputVatAccountNumber: "13620000", vatRatePercent: 10 },
    taxpayer: { name: "Х", registerNo: "6543210", vatPayerNo: null },
    computedAt: new Date("2026-10-02T00:00:00Z"),
  });
  const detail = buildReportDataDetail(snapshot, mapping, cells);
  assert.deepEqual(detail, [
    { tagId: 101, type: 0, tagKey: "TG101", value: "1250000" },
    { tagId: 102, type: 0, tagKey: "TG102", value: "800000.50" },
    { tagId: 104, type: 0, tagKey: "TG104", value: "449999.50" },
  ]);
  assert.equal(cellValueOf(10), "10");
  assert.equal(cellValueOf(10.004), "10");
  assert.equal(cellValueOf(10.5), "10.50");
  assert.throws(() => buildReportDataDetail(snapshot, { outputVat: "TG101" }, cells), /холболт дутуу/);
});

test("saveFormDataBody / submitBody — толгой жагсаалтын мөрөөс, reportNo шинэд 0, илгээхэд заавал", () => {
  const [row] = parseReportList({ code: 0, reportList: [listRow] });
  const head = reportHeadOf(row);
  assert.equal(head.reportNo, 0);
  assert.equal(head.resubmitId, 0);
  assert.equal(head.licenseNo, "0");
  const body = saveFormDataBody(head, [{ tagId: 101, type: 0, tagKey: "TG101", value: "1" }]);
  assert.deepEqual(body.reportData, {
    reportNo: 0, taxTypeId: 4, branchId: 25, year: 2026, period: 9, isXreport: 0, formNo: 1145, activitiType: 1, resubmitId: 0,
    fileGroupId: "", reportStatusId: 2, licenseNo: "0", revenueId: 7472744,
  });
  assert.equal(body.reportDataDetail.length, 1);
  assert.throws(() => submitBody(head), /reportNo алга/);
  const saved = reportHeadOf(row, 9644301);
  assert.equal(submitBody(saved, { isXreport: true }).isXreport, 1);
  assert.equal(submitBody(saved).reportNo, 9644301);
  assert.throws(() => reportHeadOf({ ...row, formNo: null }), /formNo/);
});

test("parseSaveResponse / parseSubmitResponse — спекийн жишээ; reportNo-гүй бол шиднэ", () => {
  const saved = parseSaveResponse({ code: 0, message: "Амжилттай", reportData: { reportNo: 9644301, reportNoStr: "TT-02", reportStatusId: 2 } });
  assert.deepEqual(saved, { reportNo: 9644301, reportNoStr: "TT-02", statusId: 2, message: "Амжилттай" });
  assert.throws(() => parseSaveResponse({ code: 0, reportData: {} }), /reportNo/);
  assert.throws(() => parseSaveResponse({ code: 1, message: "Маягт хаалттай" }), /Маягт хаалттай/);
  assert.equal(parseSubmitResponse({ code: 0, message: "Илгээлээ" }).message, "Илгээлээ");
  assert.throws(() => parseSubmitResponse({ code: 2, message: "Шалгуур хангаагүй" }), /Шалгуур/);
  const cell: EtaxFormCell = parseFormDetail(template).cells[0];
  assert.equal(cell.acceptsValue, true);
});

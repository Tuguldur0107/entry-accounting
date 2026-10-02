import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSheetDataDetail,
  deleteAllSheetDataBody,
  describeSheetColumn,
  normalizeSheetMapping,
  parseSaveSheetResponse,
  parseSheetDetail,
  parseSheetList,
  saveSheetDataBody,
  sheetMappingProblems,
  type EtaxSheetSourceRow,
} from "../lib/itc/etax/api";
import { ETAX_PATHS, ETAX_SHEET_FIELDS, ETAX_SHEET_FIELD_LABELS } from "../lib/itc/etax/constants";
import { EtaxError } from "../lib/itc/etax/submission";

// Хавсралт мэдээ (спек §3.11–§3.15) — ЦЭВЭР: жагсаалт/загварын parser, баганын холболт,
// Entry-ийн задаргааны мөр → sheetDataDetail. Дүн зохиохгүй, холбоогүй багана бичигдэхгүй.

test("замууд спекээс; мэдээний талбар бүр монгол шошготой", () => {
  assert.equal(ETAX_PATHS.saveSheetData, "/api/beta/return/saveSheetData");
  assert.equal(ETAX_PATHS.deleteAllSheetData, "/api/beta/return/deleteAllSheetData");
  for (const field of ETAX_SHEET_FIELDS) assert.ok(ETAX_SHEET_FIELD_LABELS[field].length > 0);
});

test("parseSheetList — массив / нэг объект; sheetFormNo-гүй мөр алгасна", () => {
  const one = { sheetFormNo: 501, sheetName: "Борлуулалт", sheetCode: "TT-03A_4", sheetLabel: "4", sheetVersion: "1", sequence: 1, status: 0, statusDesc: "Шинэ", sheetType: 1 };
  assert.equal(parseSheetList(one).length, 1);
  const list = parseSheetList([one, { ...one, sheetFormNo: 502, sheetCode: "TT-03A_5" }, { sheetName: "дутуу" }]);
  assert.equal(list.length, 2);
  assert.equal(list[1].sheetCode, "TT-03A_5");
  assert.throws(() => parseSheetList({ code: 3, message: "Тайлан олдсонгүй" }), /Тайлан олдсонгүй/);
});

const detailArray = [
  { sheetFormNo: 501, sheetCode: "TT-03A_4", sheetName: "Борлуулалт", sheetVersion: "1", isExcelImport: 1, columnKey: "C3", columnSequence: 3, name: "НӨАТ", dataType: "number", isDisable: true },
  { sheetFormNo: 501, sheetCode: "TT-03A_4", columnKey: "C1", columnSequence: 1, name: "Регистр", dataType: "string", isDisable: true },
  { sheetFormNo: 501, sheetCode: "TT-03A_4", columnKey: "C2", columnSequence: 2, name: "Нэр", dataType: "string", isDisable: true },
  { sheetFormNo: 501, sheetCode: "TT-03A_4", columnKey: "C4", columnSequence: 4, name: "Нийт", dataType: "number", expression: "C3*11", isDisable: false, hidden: false },
  { sheetFormNo: 501, sheetCode: "TT-03A_4", sheetName: "x" },
];

test("parseSheetDetail — хавтгай массив → багана (дарааллаар), объект дотор child/columns ч уншина", () => {
  const t = parseSheetDetail(detailArray);
  assert.equal(t.sheetFormNo, 501);
  assert.equal(t.sheetCode, "TT-03A_4");
  assert.equal(t.isExcelImport, true);
  assert.deepEqual(t.columns.map((c) => c.columnKey), ["C1", "C2", "C3", "C4"]);
  assert.equal(t.columns[3].hasExpression, true);
  assert.equal(describeSheetColumn(t.columns[3]), "C4 — Нийт (томьёотой)");
  const nested = parseSheetDetail({ sheetFormNo: 501, sheetCode: "TT-03A_4", columns: detailArray.slice(0, 2) });
  assert.equal(nested.columns.length, 2);
  assert.throws(() => parseSheetDetail({ sheetFormNo: 501, sheetCode: "X", columns: [] }), /багана алга/);
  assert.throws(() => parseSheetDetail({ columnKey: "C1" }), /sheetFormNo/);
});

test("normalizeSheetMapping / sheetMappingProblems — эхгүй мэдээ асуудалгүй; эхтэй бол харилцагч + дүн заавал", () => {
  const empty = normalizeSheetMapping({}, { sheetFormNo: 501, sheetCode: "TT-03A_4" });
  assert.equal(empty.source, null);
  assert.equal(empty.granularity, "counterparty");
  assert.deepEqual(sheetMappingProblems(empty, null), []);
  const columns = parseSheetDetail(detailArray).columns;
  const partial = normalizeSheetMapping({ source: "sales", granularity: "document", columns: { name: "C2" } }, { sheetFormNo: 501, sheetCode: "TT-03A_4" });
  assert.equal(partial.granularity, "document");
  assert.ok(sheetMappingProblems(partial, columns).some((p) => p.includes("дүнгийн багана")));
  const bad = normalizeSheetMapping({ source: "purchases", columns: { registerNo: "C1", vatAmount: "C1", netAmount: "C9" } }, { sheetFormNo: 501, sheetCode: "TT-03A_4" });
  const problems = sheetMappingProblems(bad, columns);
  assert.ok(problems.some((p) => p.includes("хоёулаа")));
  assert.ok(problems.some((p) => p.includes("C9")));
  assert.equal(normalizeSheetMapping({ source: "junk", granularity: "weird" }, { sheetFormNo: 1, sheetCode: "S" }).source, null);
});

const rows: EtaxSheetSourceRow[] = [
  { registerNo: "6543210", tin: "37900846788", name: "Монгол ХХК", documentNo: "AR-26-000001", date: "2026-09-05", ddtd: null, netAmount: 1_000_000, vatAmount: 100_000, totalAmount: 1_100_000, documentCount: 2 },
  { registerNo: null, tin: null, name: "Иргэн", documentNo: null, date: null, ddtd: "0000054355123", netAmount: -50_000.5, vatAmount: -5_000.05, totalAmount: -55_000.55, documentCount: 1 },
];

test("buildSheetDataDetail — мөр бүр дугаартай, зөвхөн холбосон багана, буцаалт сөрөг", () => {
  const columns = parseSheetDetail(detailArray).columns;
  const mapping = normalizeSheetMapping({ source: "sales", columns: { rowNo: "C0", registerNo: "C1", name: "C2", vatAmount: "C3" } }, { sheetFormNo: 501, sheetCode: "TT-03A_4" });
  // C0 загварт алга → шиднэ
  assert.throws(() => buildSheetDataDetail(rows, mapping, columns), /C0/);
  const ok = normalizeSheetMapping({ source: "sales", columns: { registerNo: "C1", name: "C2", vatAmount: "C3" } }, { sheetFormNo: 501, sheetCode: "TT-03A_4" });
  const detail = buildSheetDataDetail(rows, ok, columns);
  assert.equal(detail.length, 2);
  assert.deepEqual(detail[0], {
    rowNumber: 1, isTotal: 0, isChecked: false, isEdit: false, type: "0",
    cells: [{ key: "C1", value: "6543210" }, { key: "C2", value: "Монгол ХХК" }, { key: "C3", value: "100000" }],
  });
  assert.deepEqual(detail[1].cells, [{ key: "C1", value: "" }, { key: "C2", value: "Иргэн" }, { key: "C3", value: "-5000.05" }]);
  assert.deepEqual(buildSheetDataDetail([], ok, columns), []);
});

test("saveSheetDataBody / deleteAllSheetDataBody / parseSaveSheetResponse", () => {
  const head = { reportNo: 9644301, activitiType: 1, resubmitId: 0 };
  const mapping = { sheetFormNo: 501, sheetCode: "TT-03A_4" };
  const body = saveSheetDataBody(head, mapping, []);
  assert.deepEqual(body, { sheetFormNo: 501, reportNo: 9644301, activitiType: 1, resubmitId: 0, sheetCode: "TT-03A_4", sheetDataDetail: [] });
  assert.throws(() => saveSheetDataBody({ ...head, reportNo: 0 }, mapping, []), /reportNo/);
  assert.deepEqual(deleteAllSheetDataBody(head, 501), { sheetFormNo: 501, reportNo: 9644301, activitiType: 1, resubmitId: 0 });
  assert.deepEqual(parseSaveSheetResponse({ reportData: { reportNo: 9644301 }, reportDataDetail: [null] }, 9644301), { reportNo: 9644301 });
  assert.deepEqual(parseSaveSheetResponse({ reportData: { reportNo: 0 } }, 9644301), { reportNo: 9644301 });
  assert.throws(() => parseSaveSheetResponse({ reportData: { reportNo: 1 } }, 9644301), (e: unknown) => e instanceof EtaxError && /өөр reportNo/.test(e.message));
  assert.throws(() => parseSaveSheetResponse({ code: 7, message: "Мэдээ хаалттай" }, 9644301), /Мэдээ хаалттай/);
});

// eTax API — ЦЭВЭР хэсэг (client-safe): хүсэлтийн body, хариуны parser, маягтын
// загвар → нүдний жагсаалт, Entry-ийн НӨАТ-ын дүн → маягтын нүд (холболтоор).
// Эх: АЛБАН спек docs/integrations/etax/00-etax-api-spec.md §3. Сүлжээ `client.ts`-д.
// tests/etax-api.test.ts. Дүн ЗОХИОХГҮЙ — зөвхөн snapshot-ын утгыг холбосон нүдэнд буулгана;
// танигдахгүй хариу → EtaxError (чимээгүй таамаглахгүй).

import {
  ETAX_ERRORS,
  ETAX_FIELD_LABELS,
  ETAX_FORMS,
  ETAX_SHEET_FIELDS,
  ETAX_SHEET_GRANULARITIES,
  ETAX_SHEET_SOURCES,
  ETAX_TAX_STATUS,
  type EtaxFormKey,
  type EtaxSheetField,
  type EtaxSheetGranularity,
  type EtaxSheetSource,
  type EtaxSubmissionStatus,
} from "./constants";
import { EtaxError, etaxPeriodOf, type EtaxSnapshot } from "./submission";

export { etaxPeriodOf, periodCodeFor, periodRangeOf, deadlineOf, periodLabelOf } from "./submission";

type Json = Record<string, unknown>;

const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const bool = (value: unknown): boolean => value === true || value === 1 || value === "true";

/** Спекийн `{ code, message, <list> }` хариу — `reportList` г.м. нэг объект эсвэл массив ирж болно. */
function listOf(value: unknown): Json[] {
  if (Array.isArray(value)) return value.map(obj);
  const single = obj(value);
  return Object.keys(single).length ? [single] : [];
}

/** `code ≠ 0` → ТЕГ-ийн алдааны мессежээр ШИДНЭ. */
export function assertEtaxCode(json: unknown, context: string): Json {
  const body = obj(json);
  const code = num(body.code);
  if (code != null && code !== 0)
    throw new EtaxError(ETAX_ERRORS.api, `${context}: ТЕГ код ${code} — ${text(body.message) || "тайлбаргүй"}`);
  return body;
}

// ── §3.2 Байгууллага ────────────────────────────────────────────────────────

export interface EtaxOrg {
  entId: number;
  tin: string;
  pin: string;
  name: string;
  /** 1 хувь хүн · 2 хуулийн этгээд */
  entType: number | null;
  /** 2 бүртгэгдсэн · 3 хасагдахаар хүлээж буй · 4 хасагдсан */
  entStatus: number | null;
  isConfirmed: boolean;
  branchCode: string | null;
  branchName: string | null;
  subBranchCode: string | null;
  subBranchName: string | null;
  isGeneralAccountant: boolean;
}

export function parseUserOrgs(json: unknown): EtaxOrg[] {
  const rows = Array.isArray(json) ? json.map(obj) : listOf(obj(json).data ?? json);
  const orgs: EtaxOrg[] = [];
  for (const row of rows) {
    const entId = num(row.id ?? row.entId);
    if (entId == null) continue;
    const branch = obj(row.taxpayerBranchView);
    orgs.push({
      entId,
      tin: text(row.Tin ?? row.tin),
      pin: text(row.Pin ?? row.pin),
      name: text(row.entityName ?? row.entName),
      entType: num(row.entType),
      entStatus: num(row.entStatus),
      isConfirmed: bool(row.isConfirmed),
      branchCode: text(branch.branchCode) || null,
      branchName: text(branch.branchName) || null,
      subBranchCode: text(branch.subBranchCode) || null,
      subBranchName: text(branch.subBranchName) || null,
      isGeneralAccountant: bool(row.agreeGeneralRoleUser),
    });
  }
  return orgs;
}

/** Регистрээр тохирох байгууллага — олон бол регистр заавал, нэг бол тэр. */
export function pickEtaxOrg(orgs: EtaxOrg[], registerNo: string | null): EtaxOrg {
  if (orgs.length === 0) throw new EtaxError(ETAX_ERRORS.api, "ITC хэрэглэгчид холбогдсон байгууллага алга (eTax-д эрх олгуулна уу)");
  const wanted = (registerNo ?? "").trim().toUpperCase();
  if (wanted) {
    const match = orgs.find((o) => o.pin.toUpperCase() === wanted);
    if (match) return match;
  }
  if (orgs.length === 1) return orgs[0];
  throw new EtaxError(
    ETAX_ERRORS.validation,
    `ITC хэрэглэгч ${orgs.length} байгууллагатай — Компанийн мэдээллийн регистр аль нэгтэй нь таарахгүй (${orgs.map((o) => o.pin).join(", ")})`
  );
}

// ── §3.3 Тушаах тайлангийн жагсаалт ─────────────────────────────────────────

export interface EtaxReportListRow {
  id: string;
  taxReportCode: string;
  taxTypeId: number | null;
  taxTypeName: string;
  branchId: number | null;
  branchCode: string;
  branchName: string;
  periodId: number | null;
  period: number | null;
  periodYear: number | null;
  periodName: string;
  returnBeginDate: string;
  returnDueDate: string;
  reportNo: number | null;
  statusId: number | null;
  statusName: string;
  formNo: number | null;
  rsId: number | null;
  licenseNo: string;
  revenueId: number | null;
  subBranchId: string;
}

export function parseReportList(json: unknown): EtaxReportListRow[] {
  const body = assertEtaxCode(json, "Тушаах тайлангийн жагсаалт");
  return listOf(body.reportList).map((row) => ({
    id: text(row.id),
    taxReportCode: text(row.taxReportCode),
    taxTypeId: num(row.taxTypeId),
    taxTypeName: text(row.taxTypeName),
    branchId: num(row.branchId),
    branchCode: text(row.branchCode),
    branchName: text(row.branchName ?? row.branchLabel),
    periodId: num(row.periodId),
    period: num(row.period),
    periodYear: num(row.periodYear),
    periodName: text(row.periodName),
    returnBeginDate: text(row.returnBeginDate),
    returnDueDate: text(row.returnDueDate),
    reportNo: num(row.reportNo),
    statusId: num(row.taxReportStatus),
    statusName: text(row.taxReportStatusName),
    formNo: num(row.formNo),
    rsId: num(row.rsId),
    licenseNo: text(row.licenseNo),
    revenueId: num(row.revenueId),
    subBranchId: text(row.subBranchId),
  }));
}

/**
 * Жагсаалтаас тайлант үеийн мөр. `taxTypeId`/`formNo` өгсөн бол тэр (холболтоос);
 * үгүй бол маягтын нэрийн загвар (`ETAX_FORMS[form].namePattern`) — олон/үгүй бол ШИДНЭ.
 * Тайлант үе: сар → period = сар; улирал → period = улирал; жил → period = 1.
 */
export function findReportRow(
  rows: EtaxReportListRow[],
  form: EtaxFormKey,
  periodCode: string,
  prefer: { taxTypeId?: number | null; formNo?: number | null } = {}
): EtaxReportListRow {
  const { year, period } = etaxPeriodOf(periodCode);
  const inPeriod = rows.filter((r) => r.periodYear === year && r.period === period);
  let candidates = inPeriod;
  const label = ETAX_FORMS[form].shortLabel;
  if (prefer.taxTypeId != null) candidates = candidates.filter((r) => r.taxTypeId === prefer.taxTypeId);
  else if (prefer.formNo != null) candidates = candidates.filter((r) => r.formNo === prefer.formNo);
  else candidates = candidates.filter((r) => ETAX_FORMS[form].namePattern.test(`${r.taxTypeName} ${r.taxReportCode}`));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0)
    throw new EtaxError(
      ETAX_ERRORS.api,
      `ТЕГ-ийн тушаах жагсаалтад ${periodCode}-ын ${label}-ын тайлан алга (${inPeriod.length} мөр: ${inPeriod.map((r) => r.taxTypeName).join(", ") || "хоосон"})`
    );
  throw new EtaxError(ETAX_ERRORS.validation, `ТЕГ-ийн жагсаалтад ${periodCode}-д ${candidates.length} ${label}-ын мөр — маягтын холболтод татварын төрлөө сонгоно уу`);
}

/** @deprecated — `findReportRow(rows, "vat", …)`. */
export function findVatReportRow(rows: EtaxReportListRow[], periodCode: string, prefer: { taxTypeId?: number | null; formNo?: number | null } = {}): EtaxReportListRow {
  return findReportRow(rows, "vat", periodCode, prefer);
}

// ── §3.4 Түүх ───────────────────────────────────────────────────────────────

export interface EtaxHistoryRow {
  reportNo: string;
  taxTypeId: number | null;
  taxTypeCode: string;
  taxReportCode: string;
  taxReportName: string;
  formNo: number | null;
  year: number | null;
  period: number | null;
  statusId: number | null;
  statusName: string;
  rsId: string;
  assessmentAmount: number | null;
  receivedEmpName: string;
}

export function parseHistory(json: unknown): EtaxHistoryRow[] {
  const body = assertEtaxCode(json, "Тайлангийн түүх");
  const out: EtaxHistoryRow[] = [];
  for (const form of listOf(body.historyList)) {
    for (const rp of listOf(form.returnPeriods)) {
      for (const report of listOf(rp.reports)) {
        out.push({
          reportNo: text(report.reportNo),
          taxTypeId: num(report.taxTypeId),
          taxTypeCode: text(report.taxTypeCode ?? form.taxTypeCode),
          taxReportCode: text(report.taxReportCode ?? form.taxReportCode),
          taxReportName: text(report.taxReportName ?? form.taxReportName),
          formNo: num(report.taxFormNo),
          year: num(report.year ?? rp.year),
          period: num(report.period ?? rp.period),
          statusId: num(report.refReportStatusId),
          statusName: text(report.refReportStatusName),
          rsId: text(report.rsId),
          assessmentAmount: num(report.assessmentAmount),
          receivedEmpName: text(report.receivedEmpName),
        });
      }
    }
  }
  return out;
}

/** ТЕГ-ийн төлвийн код → Entry-ийн илгээлтийн төлөв (танигдахгүй → null, таамаглахгүй). */
export function taxStatusToEntry(statusId: number | null): EtaxSubmissionStatus | null {
  switch (statusId) {
    case ETAX_TAX_STATUS.saved:
      return "saved";
    case ETAX_TAX_STATUS.submitted:
    case ETAX_TAX_STATUS.assigned:
      return "submitted";
    case ETAX_TAX_STATUS.received:
      return "accepted";
    case ETAX_TAX_STATUS.returned:
      return "rejected";
    default:
      return null;
  }
}

// ── §3.7 Маягтын загвар ─────────────────────────────────────────────────────

export interface EtaxFormCell {
  tagId: number;
  /** `tagKey` — утга хадгалах түлхүүр (§3.8/§3.9). */
  key: string;
  sectionNo: number | null;
  sectionTitle: string;
  rowNumber: number | null;
  columnKey: string;
  columnName: string;
  dataType: string;
  drawType: string;
  /** Спек: «Утга авах эсэх, true — утга авна». */
  acceptsValue: boolean;
  allowMinus: boolean;
  /** Томьёотой (ТЕГ бодно) — холболтод сонгохгүй байхыг зөвлөнө. */
  hasExpression: boolean;
  defaultValue: string;
  validations: { key: string; condition: string; errorType: string; message: string }[];
}

export interface EtaxFormTemplate {
  formNo: string;
  reportCode: string;
  taxTypeCode: string;
  reportName: string;
  frequency: string;
  version: number | null;
  cells: EtaxFormCell[];
}

export function parseFormDetail(json: unknown): EtaxFormTemplate {
  const body = assertEtaxCode(json, "Маягтын загвар");
  const pass = obj(body.reportFormPass);
  const info = obj(pass.reportFormInfo);
  const cells: EtaxFormCell[] = [];
  for (const section of listOf(pass.sections)) {
    const headers = listOf(section.headers);
    const headerName = (columnSequence: number | null, columnKey: string) => {
      const byKey = headers.find((h) => text(h.field) === columnKey && columnKey !== "");
      const bySeq = columnSequence != null ? headers.find((h) => num(h.sequence) === columnSequence) : undefined;
      return text((byKey ?? bySeq)?.name);
    };
    for (const row of listOf(section.rows)) {
      for (const cell of listOf(row.cells)) {
        const tagId = num(cell.tagId);
        const key = text(cell.key);
        if (tagId == null || !key) continue;
        const columnKey = text(cell.columnKey);
        cells.push({
          tagId,
          key,
          sectionNo: num(cell.sectionNo ?? section.sectionNo),
          sectionTitle: text(section.title),
          rowNumber: num(cell.rowNumber ?? row.rowNumber),
          columnKey,
          columnName: headerName(num(cell.columnSequence), columnKey),
          dataType: text(cell.dataType),
          drawType: text(cell.drawType),
          acceptsValue: bool(cell.isDisable),
          allowMinus: bool(cell.allowMinus),
          hasExpression: text(cell.expression) !== "",
          defaultValue: text(cell.defaultValue),
          validations: listOf(cell.validations).map((v) => ({
            key: text(v.validationKey),
            condition: text(v.validCondition),
            errorType: text(v.errorType),
            message: text(v.errorMessage),
          })),
        });
      }
    }
  }
  if (cells.length === 0) throw new EtaxError(ETAX_ERRORS.api, "Маягтын загварт нүд алга — хариу танигдсангүй");
  return {
    formNo: text(info.formNo),
    reportCode: text(info.reportCode),
    taxTypeCode: text(info.taxTypeCode),
    reportName: text(info.reportName),
    frequency: text(info.reportFrequency),
    version: num(info.version),
    cells,
  };
}

/** Нүдний хүний уншихаар шошго — холболтын сонголтод. */
export function describeCell(cell: EtaxFormCell): string {
  const where = [cell.sectionTitle, cell.rowNumber != null ? `мөр ${cell.rowNumber}` : "", cell.columnName].filter(Boolean).join(" · ");
  return `${cell.key}${where ? ` — ${where}` : ""}${cell.hasExpression ? " (томьёотой)" : ""}`;
}

// ── Холболт: Entry талбар → маягтын нүд ─────────────────────────────────────

/** Entry талбар → маягтын нүдний `tagKey` (маягт бүрийн `ETAX_FORMS[form].fields`). */
export type EtaxCellMapping = Partial<Record<string, string | null>>;

export function normalizeCellMapping(raw: unknown, form: EtaxFormKey = "vat"): EtaxCellMapping {
  const source = obj(raw);
  const out: EtaxCellMapping = {};
  for (const field of ETAX_FORMS[form].fields) {
    const key = text(source[field]);
    out[field] = key || null;
  }
  return out;
}

/** Холболтын бүрдэл: маягтын ЗААВАЛ талбарууд; давхардал; загварт байхгүй нүд. Алдааг жагсаана. */
export function mappingProblems(mapping: EtaxCellMapping, cells: EtaxFormCell[] | null, form: EtaxFormKey = "vat"): string[] {
  const problems: string[] = [];
  const meta = ETAX_FORMS[form];
  for (const field of meta.requiredFields) if (!mapping[field]) problems.push(`«${ETAX_FIELD_LABELS[field] ?? field}» нүдтэй холбогдоогүй`);
  const used = new Map<string, string>();
  for (const field of meta.fields) {
    const key = mapping[field];
    if (!key) continue;
    const prev = used.get(key);
    if (prev) problems.push(`${key} нүдэнд ${prev} ба ${field} хоёулаа холбогдсон`);
    used.set(key, field);
    if (cells && !cells.some((c) => c.key === key)) problems.push(`${key} нүд маягтын загварт алга (загвар өөрчлөгдсөн?)`);
  }
  return problems;
}

/** Мөнгөн дүн → ТЕГ-ийн нүдний утга (string; бүхэл бол орон бутархайгүй). */
export function cellValueOf(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export interface EtaxReportDataDetail {
  tagId: number;
  type: number;
  tagKey: string;
  value: string;
}

/**
 * snapshot-ын дүнг холбосон нүдэнд буулгана (§3.9 `reportDataDetail`). Холбогдоогүй
 * талбар алгасагдана; холбосон нүд загварт байхгүй / хасах утга авдаггүй нүдэнд сөрөг → ШИДНЭ.
 */
export function buildReportDataDetail(snapshot: EtaxSnapshot, mapping: EtaxCellMapping, cells: EtaxFormCell[]): EtaxReportDataDetail[] {
  const problems = mappingProblems(mapping, cells, snapshot.form);
  if (problems.length) throw new EtaxError(ETAX_ERRORS.validation, `Маягтын холболт дутуу: ${problems.join("; ")}`);
  const detail: EtaxReportDataDetail[] = [];
  for (const field of ETAX_FORMS[snapshot.form].fields) {
    const key = mapping[field];
    if (!key) continue;
    const cell = cells.find((c) => c.key === key)!;
    const amount = snapshot.amounts[field] ?? 0;
    if (amount < 0 && !cell.allowMinus) throw new EtaxError(ETAX_ERRORS.validation, `${key} нүд хасах утга авахгүй (${ETAX_FIELD_LABELS[field] ?? field})`);
    detail.push({ tagId: cell.tagId, type: 0, tagKey: cell.key, value: cellValueOf(amount) });
  }
  return detail;
}

// ── §3.9 / §3.10 body ───────────────────────────────────────────────────────

export interface EtaxReportHead {
  reportNo: number;
  taxTypeId: number;
  branchId: number;
  year: number;
  period: number;
  formNo: number;
  resubmitId: number;
  activitiType: number;
  licenseNo: string;
  revenueId: number | null;
}

/** Жагсаалтын мөр → толгой. `reportNo` байхгүй (шинэ) бол 0 — спекийн заавал number. */
export function reportHeadOf(row: EtaxReportListRow, reportNo: number | null = row.reportNo): EtaxReportHead {
  const missing = (["taxTypeId", "branchId", "periodYear", "period", "formNo"] as const).filter((k) => row[k] == null);
  if (missing.length) throw new EtaxError(ETAX_ERRORS.api, `ТЕГ-ийн жагсаалтын мөр дутуу: ${missing.join(", ")}`);
  return {
    reportNo: reportNo ?? 0,
    taxTypeId: row.taxTypeId!,
    branchId: row.branchId!,
    year: row.periodYear!,
    period: row.period!,
    formNo: row.formNo!,
    resubmitId: row.rsId ?? 0,
    // Спекийн жишээ 1 — хуваарилалтын төрөл; жагсаалт өгдөггүй (staging-д батална, docs/dev/etax.md §6).
    activitiType: 1,
    licenseNo: row.licenseNo || "0",
    revenueId: row.revenueId,
  };
}

export function saveFormDataBody(head: EtaxReportHead, detail: EtaxReportDataDetail[], options: { isXreport?: boolean } = {}) {
  return {
    reportData: {
      reportNo: head.reportNo,
      taxTypeId: head.taxTypeId,
      branchId: head.branchId,
      year: head.year,
      period: head.period,
      isXreport: options.isXreport ? 1 : 0,
      formNo: head.formNo,
      activitiType: head.activitiType,
      resubmitId: head.resubmitId,
      fileGroupId: "",
      reportStatusId: ETAX_TAX_STATUS.saved,
      licenseNo: head.licenseNo,
      revenueId: head.revenueId ?? 0,
    },
    reportDataDetail: detail,
  };
}

export function submitBody(head: EtaxReportHead, options: { isXreport?: boolean } = {}) {
  if (!head.reportNo) throw new EtaxError(ETAX_ERRORS.state, "Эхлээд ТЕГ-д хадгална (reportNo алга)");
  return {
    reportNo: head.reportNo,
    taxTypeId: head.taxTypeId,
    branchId: head.branchId,
    year: head.year,
    period: head.period,
    isXreport: options.isXreport ? 1 : 0,
    formNo: head.formNo,
    resubmitId: head.resubmitId,
    activitiType: head.activitiType,
    reportStatusId: ETAX_TAX_STATUS.saved,
  };
}

export interface EtaxSaveResult {
  reportNo: number;
  reportNoStr: string;
  statusId: number | null;
  message: string;
}

export function parseSaveResponse(json: unknown): EtaxSaveResult {
  const body = assertEtaxCode(json, "Тайлан хадгалах");
  const data = obj(body.reportData);
  const reportNo = num(data.reportNo);
  if (reportNo == null || reportNo <= 0) throw new EtaxError(ETAX_ERRORS.api, "Тайлан хадгалах: ТЕГ reportNo буцаасангүй");
  return { reportNo, reportNoStr: text(data.reportNoStr), statusId: num(data.reportStatusId), message: text(body.message) };
}

export function parseSubmitResponse(json: unknown): { message: string } {
  const body = assertEtaxCode(json, "Тайлан илгээх");
  return { message: text(body.message) };
}

/** Нэг тайлангийн ТЕГ-ийн сүүлийн төлөв — түүхээс reportNo-гоор, үгүй бол үе + маягтаар. */
export function findHistoryRow(rows: EtaxHistoryRow[], match: { reportNo: number | null; year: number; period: number; formNo: number | null }): EtaxHistoryRow | null {
  if (match.reportNo != null) {
    const byNo = rows.find((r) => r.reportNo === String(match.reportNo));
    if (byNo) return byNo;
  }
  const byPeriod = rows.filter((r) => r.year === match.year && r.period === match.period && (match.formNo == null || r.formNo === match.formNo));
  return byPeriod.length === 1 ? byPeriod[0] : null;
}

// ── §3.11–§3.15 Хавсралт мэдээ (sheet) ─────────────────────────────────────

export interface EtaxSheetInfo {
  sheetFormNo: number;
  sheetName: string;
  sheetCode: string;
  sheetLabel: string;
  sheetVersion: string;
  sequence: number | null;
  statusId: number | null;
  statusName: string;
  sheetType: number | null;
}

/** §3.11 — тайлангийн хавсралт мэдээний жагсаалт (массив / нэг объект / `data`). */
export function parseSheetList(json: unknown): EtaxSheetInfo[] {
  const body = Array.isArray(json) ? json : assertEtaxCode(json, "Мэдээний жагсаалт");
  const rows = Array.isArray(body) ? body.map(obj) : listOf((body as Json).sheetList ?? (body as Json).data ?? body);
  const out: EtaxSheetInfo[] = [];
  for (const row of rows) {
    const sheetFormNo = num(row.sheetFormNo);
    const sheetCode = text(row.sheetCode);
    if (sheetFormNo == null || !sheetCode) continue;
    out.push({
      sheetFormNo,
      sheetName: text(row.sheetName),
      sheetCode,
      sheetLabel: text(row.sheetLabel),
      sheetVersion: text(row.sheetVersion),
      sequence: num(row.sequence),
      statusId: num(row.status),
      statusName: text(row.statusDesc),
      sheetType: num(row.sheetType),
    });
  }
  return out;
}

export interface EtaxSheetColumn {
  /** Нүдний код — `sheetDataDetail[].cells[].key`. */
  columnKey: string;
  sequence: number | null;
  name: string;
  dataType: string;
  /** Спек: «Утга авах эсэх». */
  acceptsValue: boolean;
  hasExpression: boolean;
  hasSum: boolean;
  hidden: boolean;
  maxLength: number | null;
}

export interface EtaxSheetTemplate {
  sheetFormNo: number;
  sheetCode: string;
  sheetName: string;
  sheetLabel: string;
  sheetVersion: string;
  isExcelImport: boolean;
  columns: EtaxSheetColumn[];
}

/**
 * §3.12 — мэдээний загвар. Спекийн хариу хавтгай (мэдээний мета + баганын талбар нэг
 * түвшинд) тул: массив бол мөр бүр = багана; объект бол `columns`/`child`/`data` дотроос,
 * үгүй бол өөрөө нэг багана. Багана `columnKey`-гүй бол алгасна.
 */
export function parseSheetDetail(json: unknown): EtaxSheetTemplate {
  const items: Json[] = Array.isArray(json) ? json.map(obj) : [];
  const root = Array.isArray(json) ? obj(json[0]) : obj(json);
  if (!Array.isArray(json)) {
    assertEtaxCode(json, "Мэдээний загвар");
    const nested = listOf(root.columns ?? root.child ?? root.data ?? root.sheetColumns);
    if (nested.length) items.push(...nested);
    else items.push(root);
  }
  const meta = Array.isArray(json) ? root : root;
  const columns: EtaxSheetColumn[] = [];
  for (const item of items) {
    const columnKey = text(item.columnKey);
    if (!columnKey) continue;
    columns.push({
      columnKey,
      sequence: num(item.columnSequence ?? item.sequence),
      name: text(item.name ?? item.field),
      dataType: text(item.dataType),
      acceptsValue: bool(item.isDisable),
      hasExpression: text(item.expression) !== "",
      hasSum: bool(item.hasSum),
      hidden: bool(item.hidden),
      maxLength: num(item.maxLength),
    });
  }
  const sheetFormNo = num(meta.sheetFormNo);
  const sheetCode = text(meta.sheetCode);
  if (sheetFormNo == null || !sheetCode) throw new EtaxError(ETAX_ERRORS.api, "Мэдээний загвар: sheetFormNo / sheetCode алга");
  if (columns.length === 0) throw new EtaxError(ETAX_ERRORS.api, `Мэдээний загвар ${sheetCode}: багана алга — хариу танигдсангүй`);
  columns.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return {
    sheetFormNo,
    sheetCode,
    sheetName: text(meta.sheetName),
    sheetLabel: text(meta.sheetLabel),
    sheetVersion: text(meta.sheetVersion),
    isExcelImport: bool(meta.isExcelImport),
    columns,
  };
}

export function describeSheetColumn(column: EtaxSheetColumn): string {
  return `${column.columnKey}${column.name ? ` — ${column.name}` : ""}${column.hasExpression ? " (томьёотой)" : ""}${column.hidden ? " (далд)" : ""}`;
}

/** Нэг мэдээний холболт: эх (борлуулалт / худалдан авалт / илгээхгүй), нэгтгэл, багана → Entry талбар. */
export interface EtaxSheetMapping {
  sheetFormNo: number;
  sheetCode: string;
  source: EtaxSheetSource | null;
  granularity: EtaxSheetGranularity;
  columns: Partial<Record<EtaxSheetField, string | null>>;
}

export function normalizeSheetMapping(raw: unknown, fallback: { sheetFormNo: number; sheetCode: string }): EtaxSheetMapping {
  const source = obj(raw);
  const src = text(source.source);
  const gran = text(source.granularity);
  const columnsRaw = obj(source.columns);
  const columns: Partial<Record<EtaxSheetField, string | null>> = {};
  for (const field of ETAX_SHEET_FIELDS) columns[field] = text(columnsRaw[field]) || null;
  return {
    sheetFormNo: num(source.sheetFormNo) ?? fallback.sheetFormNo,
    sheetCode: text(source.sheetCode) || fallback.sheetCode,
    source: (ETAX_SHEET_SOURCES as readonly string[]).includes(src) ? (src as EtaxSheetSource) : null,
    granularity: (ETAX_SHEET_GRANULARITIES as readonly string[]).includes(gran) ? (gran as EtaxSheetGranularity) : "counterparty",
    columns,
  };
}

/** Эхтэй мэдээнд ЗААВАЛ: харилцагчийн таних (регистр эсвэл ТТД эсвэл нэр) + НӨАТ эсвэл нийт дүн. */
export function sheetMappingProblems(mapping: EtaxSheetMapping, columns: EtaxSheetColumn[] | null): string[] {
  if (!mapping.source) return [];
  const problems: string[] = [];
  const c = mapping.columns;
  if (!c.registerNo && !c.tin && !c.name) problems.push(`${mapping.sheetCode}: харилцагчийн регистр / ТТД / нэрийн аль нэг нь холбогдоогүй`);
  if (!c.vatAmount && !c.totalAmount && !c.netAmount) problems.push(`${mapping.sheetCode}: дүнгийн багана холбогдоогүй`);
  const used = new Map<string, EtaxSheetField>();
  for (const field of ETAX_SHEET_FIELDS) {
    const key = c[field];
    if (!key) continue;
    const prev = used.get(key);
    if (prev) problems.push(`${mapping.sheetCode}: ${key} баганад ${prev} ба ${field} хоёулаа`);
    used.set(key, field);
    if (columns && !columns.some((col) => col.columnKey === key)) problems.push(`${mapping.sheetCode}: ${key} багана загварт алга`);
  }
  return problems;
}

/** Entry-ээс гарсан мэдээний нэг мөр (sheet-source.ts) — дүн тэмдэгтэй (буцаалт сөрөг). */
export interface EtaxSheetSourceRow {
  registerNo: string | null;
  tin: string | null;
  name: string;
  documentNo: string | null;
  date: string | null;
  ddtd: string | null;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
  documentCount: number;
}

export interface EtaxSheetDataRow {
  rowNumber: number;
  isTotal: number;
  isChecked: boolean;
  isEdit: boolean;
  type: string;
  cells: { key: string; value: string }[];
}

function sheetCellValue(field: EtaxSheetField, row: EtaxSheetSourceRow, rowNo: number): string {
  switch (field) {
    case "rowNo":
      return String(rowNo);
    case "registerNo":
      return row.registerNo ?? "";
    case "tin":
      return row.tin ?? "";
    case "name":
      return row.name;
    case "documentNo":
      return row.documentNo ?? "";
    case "date":
      return row.date ?? "";
    case "ddtd":
      return row.ddtd ?? "";
    case "netAmount":
      return cellValueOf(row.netAmount);
    case "vatAmount":
      return cellValueOf(row.vatAmount);
    case "totalAmount":
      return cellValueOf(row.totalAmount);
    case "documentCount":
      return String(row.documentCount);
  }
}

/** Эх мөрүүд → `sheetDataDetail` (§3.14); холбоогүй багана бичигдэхгүй; хоосон мөр үгүй. */
export function buildSheetDataDetail(rows: EtaxSheetSourceRow[], mapping: EtaxSheetMapping, columns: EtaxSheetColumn[]): EtaxSheetDataRow[] {
  const problems = sheetMappingProblems(mapping, columns);
  if (problems.length) throw new EtaxError(ETAX_ERRORS.validation, `Мэдээний холболт дутуу: ${problems.join("; ")}`);
  const mapped = ETAX_SHEET_FIELDS.filter((f) => !!mapping.columns[f]);
  return rows.map((row, index) => ({
    rowNumber: index + 1,
    isTotal: 0,
    isChecked: false,
    isEdit: false,
    type: "0",
    cells: mapped.map((field) => ({ key: mapping.columns[field]!, value: sheetCellValue(field, row, index + 1) })),
  }));
}

export function saveSheetDataBody(head: Pick<EtaxReportHead, "reportNo" | "activitiType" | "resubmitId">, mapping: Pick<EtaxSheetMapping, "sheetFormNo" | "sheetCode">, detail: EtaxSheetDataRow[]) {
  if (!head.reportNo) throw new EtaxError(ETAX_ERRORS.state, "Эхлээд ТЕГ-д хадгална (reportNo алга)");
  return {
    sheetFormNo: mapping.sheetFormNo,
    reportNo: head.reportNo,
    activitiType: head.activitiType,
    resubmitId: head.resubmitId,
    sheetCode: mapping.sheetCode,
    sheetDataDetail: detail,
  };
}

/** §3.15 — мэдээний мөрүүдийг бүгдийг устгах (дахин бичихийн өмнө). */
export function deleteAllSheetDataBody(head: Pick<EtaxReportHead, "reportNo" | "activitiType" | "resubmitId">, sheetFormNo: number) {
  if (!head.reportNo) throw new EtaxError(ETAX_ERRORS.state, "reportNo алга");
  return { sheetFormNo, reportNo: head.reportNo, activitiType: head.activitiType, resubmitId: head.resubmitId };
}

/** §3.14 хариу — `code` байвал шалгана, `reportData.reportNo` таарахыг баталгаажуулна. */
export function parseSaveSheetResponse(json: unknown, expectedReportNo: number): { reportNo: number } {
  const body = assertEtaxCode(json, "Мэдээ хадгалах");
  const reportNo = num(obj(body.reportData).reportNo);
  if (reportNo != null && reportNo !== 0 && reportNo !== expectedReportNo)
    throw new EtaxError(ETAX_ERRORS.api, `Мэдээ хадгалах: ТЕГ өөр reportNo буцаав (${reportNo} ≠ ${expectedReportNo})`);
  return { reportNo: expectedReportNo };
}

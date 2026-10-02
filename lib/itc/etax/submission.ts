// eTax илгээлтийн ЦЭВЭР логик (client-safe, DB/сүлжээгүй): НӨАТ-ын тайлангийн
// snapshot (Entry-ийн бодолтын хуулбар), шалгалт, төлөвийн машин. tests/etax-submission.test.ts.
//
// Дүрэм (docs/dev/etax.md): тайлан ЗОХИОХГҮЙ — snapshot нь `computeVatReturn`-ийн дүнг л
// хуулна; дүн энд дахин бодогдохгүй (зөвхөн уялдааг ШАЛГАНА). Төлөв хоёр чиглэлд
// дур мэдэн үсэрдэггүй — зөвхөн `ETAX_TRANSITIONS`-ийн ирмэгээр.

import type { VatReturnSummary } from "@/lib/vat/return";

import { isPeriodCode } from "@/lib/periods/period";

import {
  ETAX_ERRORS,
  ETAX_FIELD_LABELS,
  ETAX_FORMS,
  ETAX_PIT_FIELDS,
  ETAX_VAT_FIELDS,
  type EtaxFormKey,
  type EtaxPeriodKind,
  type EtaxSubmissionStatus,
} from "./constants";

export class EtaxError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "EtaxError";
    this.code = code;
  }
}

/** Татвар төлөгчийн толгой — Компанийн мэдээлэл (company_settings)-ээс. */
export interface EtaxTaxpayer {
  name: string;
  /** Байгууллагын регистр (7 орон). */
  registerNo: string | null;
  /** НӨАТ төлөгчийн дугаар — тохиргоонд байвал. */
  vatPayerNo: string | null;
}

/**
 * Тайлангийн snapshot — Entry-ийн бодолтын хуулбар, ТЕГ-ийн маягтын нүдэнд буулгахын ӨМНӨХ
 * тал. `amounts`-ын түлхүүр = маягтын `ETAX_FORMS[form].fields`; `counts` мэдээлэл л.
 */
export interface EtaxSnapshot {
  form: EtaxFormKey;
  formCode: string;
  /** Маягтын төрлөөр: сар `YYYY-MM`, улирал `YYYY-Qn`, жил `YYYY`. */
  periodCode: string;
  /** Өгөгдлийн огнооны муж (YYYY-MM-DD) — ААНОАТ өссөн дүнгээр (жилийн эхнээс). */
  range: { from: string; to: string };
  taxpayer: EtaxTaxpayer;
  amounts: Record<string, number>;
  counts: Record<string, number>;
  /** Эх сурвалж (данс, тохиргоо, журнал) — лавлагаа. */
  source: Record<string, string | number | null>;
  deadline: string; // YYYY-MM-DD
  /** Бодсон мөч (ISO) — хуучирсан эсэхийг харуулахад. */
  computedAt: string;
}

/** НӨАТ-ын snapshot — `amounts` нь `ETAX_VAT_FIELDS` түлхүүртэй (хуучин нэр хэвээр). */
export type EtaxVatSnapshot = EtaxSnapshot;

const round2 = (value: number) => Math.round(value * 100) / 100;

function cleanText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function cleanTaxpayer(taxpayer: EtaxTaxpayer): EtaxTaxpayer {
  return { name: taxpayer.name.trim(), registerNo: cleanText(taxpayer.registerNo), vatPayerNo: cleanText(taxpayer.vatPayerNo) };
}

function roundAll(amounts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(amounts)) out[key] = round2(Number.isFinite(value) ? value : NaN);
  return out;
}

/** `computeVatReturn`-ийн дүнг хуулж snapshot үүсгэнэ — дүн дахин бодогдохгүй. */
export function buildVatSnapshot(input: {
  summary: VatReturnSummary;
  settings: { outputVatAccountNumber: string; inputVatAccountNumber: string; vatRatePercent: number };
  taxpayer: EtaxTaxpayer;
  settlementVoucherId?: string | null;
  computedAt: Date;
}): EtaxSnapshot {
  const { summary, settings } = input;
  const range = periodRangeOf("vat", summary.periodCode);
  return {
    form: "vat",
    formCode: ETAX_FORMS.vat.code,
    periodCode: summary.periodCode,
    range,
    taxpayer: cleanTaxpayer(input.taxpayer),
    amounts: roundAll({
      outputVat: summary.outputVat,
      inputVat: summary.inputVat,
      carriedInVat: summary.carriedInVat,
      payableVat: summary.payableVat,
      refundableVat: summary.refundableVat,
    }),
    counts: { outputLines: summary.outputLineCount, inputLines: summary.inputLineCount },
    source: {
      outputVatAccount: settings.outputVatAccountNumber,
      inputVatAccount: settings.inputVatAccountNumber,
      vatRatePercent: settings.vatRatePercent,
      settlementVoucherId: input.settlementVoucherId ?? null,
    },
    deadline: summary.deadline,
    computedAt: input.computedAt.toISOString(),
  };
}

/** Цалингийн бодолтын нийлбэр (payroll_run_lines) — ХАОАТ суутгагчийн тайлан. */
export interface PitTotals {
  periodCode: string; // YYYY-MM
  employeeCount: number;
  earnings: number;
  employeeSi: number;
  /** Σ max(0, earnings − НДШ − сарын татваргүй босго) — calc.ts-ийн ижил томьёо. */
  taxableIncome: number;
  pitCredit: number;
  pit: number;
  netSalary: number;
  /** Цалингийн журнал байгаа эсэх (status voucher_created) — батлагдаагүй бол анхааруулга. */
  runStatus: string | null;
  voucherStatus: string | null;
  monthlyTaxFree: number;
}

export function buildPitSnapshot(input: { totals: PitTotals; taxpayer: EtaxTaxpayer; computedAt: Date }): EtaxSnapshot {
  const { totals } = input;
  const range = periodRangeOf("pit", totals.periodCode);
  return {
    form: "pit",
    formCode: ETAX_FORMS.pit.code,
    periodCode: totals.periodCode,
    range,
    taxpayer: cleanTaxpayer(input.taxpayer),
    amounts: roundAll({
      employeeCount: totals.employeeCount,
      earnings: totals.earnings,
      employeeSi: totals.employeeSi,
      taxableIncome: totals.taxableIncome,
      pitCredit: totals.pitCredit,
      pit: totals.pit,
      netSalary: totals.netSalary,
    }),
    counts: { employees: totals.employeeCount },
    source: { runStatus: totals.runStatus, voucherStatus: totals.voucherStatus, monthlyTaxFree: totals.monthlyTaxFree },
    deadline: deadlineOf("pit", totals.periodCode),
    computedAt: input.computedAt.toISOString(),
  };
}

/** Орлогын тайлангийн нийлбэр (жилийн эхнээс) + ҮХ-ийн элэгдэл — ААНОАТ. */
export interface CitTotals {
  periodCode: string; // YYYY-Qn
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  financeExpenses: number;
  /** Дансны элэгдэл (fa_depreciation_entries.amount, posted) ба татварын мэмо (taxAmount). */
  bookDepreciation: number;
  taxDepreciation: number;
  accountCount: number;
}

export function buildCitSnapshot(input: { totals: CitTotals; taxpayer: EtaxTaxpayer; computedAt: Date }): EtaxSnapshot {
  const t = input.totals;
  const totalExpenses = t.cogs + t.operatingExpenses + t.financeExpenses;
  const profitBeforeTax = t.revenue - totalExpenses;
  return {
    form: "cit",
    formCode: ETAX_FORMS.cit.code,
    periodCode: t.periodCode,
    range: periodRangeOf("cit", t.periodCode),
    taxpayer: cleanTaxpayer(input.taxpayer),
    amounts: roundAll({
      revenue: t.revenue,
      cogs: t.cogs,
      operatingExpenses: t.operatingExpenses,
      financeExpenses: t.financeExpenses,
      totalExpenses,
      profitBeforeTax,
      bookDepreciation: t.bookDepreciation,
      taxDepreciation: t.taxDepreciation,
      // IAS 12 түр зөрүүний НЭГ л тохируулга — бусад тохируулга (хязгаарлагдах зардал г.м.) ТЕГ-ийн маягтад
      depreciationAdjustedProfit: profitBeforeTax + t.bookDepreciation - t.taxDepreciation,
    }),
    counts: { accounts: t.accountCount },
    source: { basis: "GL 5/6/7/8 бүлэг, жилийн эхнээс; элэгдэл fa_depreciation_entries" },
    deadline: deadlineOf("cit", t.periodCode),
    computedAt: input.computedAt.toISOString(),
  };
}

// ── Тайлант үе ───────────────────────────────────────────────────────────────

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const YEAR_RE = /^(\d{4})$/;

/** Топбарын сар (`YYYY-MM`) → маягтын тайлант үеийн код. */
export function periodCodeFor(form: EtaxFormKey, monthCode: string): string {
  const match = MONTH_RE.exec(monthCode);
  if (!match || !isPeriodCode(monthCode)) throw new EtaxError(ETAX_ERRORS.validation, "Тайлант үеийн код буруу (YYYY-MM)");
  const kind = ETAX_FORMS[form].periodKind;
  if (kind === "month") return monthCode;
  if (kind === "quarter") return `${match[1]}-Q${Math.ceil(Number(match[2]) / 3)}`;
  return match[1];
}

/** Маягтын тайлант үеийн код → ТЕГ-ийн `year` / `period` (сар 1–12, улирал 1–4, жил 1). */
export function etaxPeriodOf(periodCode: string): { year: number; period: number; kind: EtaxPeriodKind } {
  let m = MONTH_RE.exec(periodCode);
  if (m) {
    const month = Number(m[2]);
    if (month < 1 || month > 12) throw new EtaxError(ETAX_ERRORS.validation, "Тайлант үеийн код буруу (YYYY-MM)");
    return { year: Number(m[1]), period: month, kind: "month" };
  }
  m = QUARTER_RE.exec(periodCode);
  if (m) return { year: Number(m[1]), period: Number(m[2]), kind: "quarter" };
  m = YEAR_RE.exec(periodCode);
  if (m) return { year: Number(m[1]), period: 1, kind: "year" };
  throw new EtaxError(ETAX_ERRORS.validation, "Тайлант үеийн код буруу (YYYY-MM / YYYY-Qn / YYYY)");
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Өгөгдлийн огнооны муж: сар; улирал/жил — өссөн дүнгээр бол жилийн эхнээс. */
export function periodRangeOf(form: EtaxFormKey, periodCode: string): { from: string; to: string } {
  const { year, period, kind } = etaxPeriodOf(periodCode);
  const cumulative = ETAX_FORMS[form].cumulative;
  if (kind === "month") return { from: `${year}-${pad(period)}-01`, to: `${year}-${pad(period)}-${pad(lastDay(year, period))}` };
  if (kind === "quarter") {
    const startMonth = (period - 1) * 3 + 1;
    const endMonth = period * 3;
    return { from: cumulative ? `${year}-01-01` : `${year}-${pad(startMonth)}-01`, to: `${year}-${pad(endMonth)}-${pad(lastDay(year, endMonth))}` };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Хуулийн хугацаа — НӨАТ/ХАОАТ дараа сарын 10, ААНОАТ улирлын дараа сарын 20, жилийнх дараа оны 2-р сарын 10 (lib/tax/calendar.ts). */
export function deadlineOf(form: EtaxFormKey, periodCode: string): string {
  const { year, period, kind } = etaxPeriodOf(periodCode);
  if (kind === "month") {
    const next = period === 12 ? { y: year + 1, m: 1 } : { y: year, m: period + 1 };
    return `${next.y}-${pad(next.m)}-10`;
  }
  if (kind === "quarter") {
    const endMonth = period * 3;
    const next = endMonth === 12 ? { y: year + 1, m: 1 } : { y: year, m: endMonth + 1 };
    return `${next.y}-${pad(next.m)}-20`;
  }
  return `${year + 1}-02-10`;
}

export function periodLabelOf(periodCode: string): string {
  const { year, period, kind } = etaxPeriodOf(periodCode);
  if (kind === "month") return `${year} оны ${period}-р сар`;
  if (kind === "quarter") return `${year} оны ${period}-р улирал (өссөн дүнгээр)`;
  return `${year} он`;
}

// ── Шалгалт ──────────────────────────────────────────────────────────────────

export interface EtaxValidation {
  errors: string[];
  warnings: string[];
  /** Шалгасан өдөр (УБ, YYYY-MM-DD). */
  checkedOn: string;
}

const REGISTER_RE = /^\d{7}$/;
const TOLERANCE = 0.01;

function validateHeader(snapshot: EtaxSnapshot, errors: string[]): void {
  const { taxpayer } = snapshot;
  try {
    etaxPeriodOf(snapshot.periodCode);
  } catch {
    errors.push("Тайлант үеийн код буруу");
  }
  if (!taxpayer.name) errors.push("Компанийн нэр хоосон — Тохиргоо → Компанийн мэдээлэл");
  if (!taxpayer.registerNo) errors.push("Байгууллагын регистрийн дугаар хоосон — Тохиргоо → Компанийн мэдээлэл");
  else if (!REGISTER_RE.test(taxpayer.registerNo)) errors.push("Регистрийн дугаар 7 оронтой тоо байна");
  for (const field of ETAX_FORMS[snapshot.form].fields) {
    const value = snapshot.amounts[field];
    if (!Number.isFinite(value)) errors.push(`${ETAX_FIELD_LABELS[field] ?? field} тоо биш`);
  }
}

/**
 * Snapshot-ын уялдаа + толгойн бүрдэл. `errors` байвал «Бэлэн» болохгүй; `warnings` нь
 * хүнд ил харагдах анхааруулга (хоцорсон, хоосон тайлан). Хувь, торгуулийн дүн энд
 * БОДОГДОХГҮЙ (хуулийн тоо кодод байхгүй — зөвхөн хугацаа хэтэрснийг хэлнэ).
 */
export function validateVatSnapshot(snapshot: EtaxSnapshot, today: string): EtaxValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { amounts, counts } = snapshot;
  validateHeader(snapshot, errors);
  for (const field of ETAX_VAT_FIELDS) if (Number.isFinite(amounts[field]) && amounts[field] < 0) errors.push(`${ETAX_FIELD_LABELS[field]} сөрөг байж болохгүй`);

  if (errors.length === 0) {
    const net = round2(amounts.outputVat - amounts.inputVat - amounts.carriedInVat);
    const expectedPayable = Math.max(0, net);
    const expectedRefundable = Math.max(0, -net);
    if (Math.abs(amounts.payableVat - expectedPayable) > TOLERANCE)
      errors.push("Төлөх НӨАТ = гаралт − оролт − шилжсэн кредит тэнцэхгүй — тайланг дахин бодно уу");
    if (Math.abs(amounts.refundableVat - expectedRefundable) > TOLERANCE)
      errors.push("Шилжүүлэх НӨАТ тэнцэхгүй — тайланг дахин бодно уу");
    if (amounts.payableVat > 0 && amounts.refundableVat > 0) errors.push("Төлөх ба шилжүүлэх дүн зэрэг байж болохгүй");
  }

  if ((counts.outputLines ?? 0) === 0 && (counts.inputLines ?? 0) === 0 && amounts.carriedInVat === 0)
    warnings.push("Энэ сард НӨАТ-ын мөр алга — тэг тайлан (хоосон ч тушаана)");
  if (today > snapshot.deadline) warnings.push(`Эцсийн хугацаа ${snapshot.deadline} өнгөрсөн — хоцорсон тайлан (алданги тооцогдож болзошгүй)`);

  return { errors, warnings, checkedOn: today };
}

export function validatePitSnapshot(snapshot: EtaxSnapshot, today: string): EtaxValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { amounts, source } = snapshot;
  validateHeader(snapshot, errors);
  for (const field of ETAX_PIT_FIELDS) if (Number.isFinite(amounts[field]) && amounts[field] < 0) errors.push(`${ETAX_FIELD_LABELS[field]} сөрөг байж болохгүй`);
  if (errors.length === 0) {
    if (amounts.pit > amounts.taxableIncome + TOLERANCE) errors.push("Суутгасан ХАОАТ татвар ногдох орлогоос их байж болохгүй — цалингийн бодолтыг шалгана уу");
    if (amounts.taxableIncome > amounts.earnings + TOLERANCE) errors.push("Татвар ногдох орлого нийт олголтоос их байж болохгүй");
  }
  if (amounts.employeeCount === 0) warnings.push("Энэ сард цалингийн бодолт алга — тэг тайлан (хоосон ч тушаана)");
  else if (source.runStatus !== "voucher_created") warnings.push("Цалингийн журнал үүсгээгүй — бодолт өөрчлөгдөж болзошгүй");
  else if (source.voucherStatus && source.voucherStatus !== "posted") warnings.push("Цалингийн журнал батлагдаагүй (ноорог) — батлаад тушаахыг зөвлөнө");
  if (today > snapshot.deadline) warnings.push(`Эцсийн хугацаа ${snapshot.deadline} өнгөрсөн — хоцорсон тайлан`);
  return { errors, warnings, checkedOn: today };
}

export function validateCitSnapshot(snapshot: EtaxSnapshot, today: string): EtaxValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { amounts } = snapshot;
  validateHeader(snapshot, errors);
  if (errors.length === 0) {
    for (const field of ["revenue", "cogs", "operatingExpenses", "financeExpenses", "bookDepreciation", "taxDepreciation"])
      if (amounts[field] < 0) warnings.push(`${ETAX_FIELD_LABELS[field]} сөрөг — буцаалт/залруулга давамгайлсан, журналаа шалгана уу`);
    const expectedTotal = round2(amounts.cogs + amounts.operatingExpenses + amounts.financeExpenses);
    if (Math.abs(amounts.totalExpenses - expectedTotal) > TOLERANCE) errors.push("Нийт зардал бүлгүүдийн нийлбэртэй тэнцэхгүй — дахин бодно уу");
    if (Math.abs(amounts.profitBeforeTax - round2(amounts.revenue - amounts.totalExpenses)) > TOLERANCE) errors.push("Ашиг = орлого − зардал тэнцэхгүй — дахин бодно уу");
    if (amounts.taxDepreciation === 0 && amounts.bookDepreciation > 0)
      warnings.push("Татварын элэгдэл 0 — ҮХ-ийн картад татварын хугацаа тохируулаагүй байж магадгүй (Үндсэн хөрөнгө)");
  }
  if (amounts.revenue === 0 && amounts.totalExpenses === 0) warnings.push("Орлого, зардал алга — тэг тайлан");
  warnings.push("ААНОАТ-ын бусад тохируулга (хязгаарлагдах зардал, чөлөөлөгдөх орлого, алдагдал шилжүүлэх) ТЕГ-ийн маягт дээр — Entry зөвхөн дансны дүн ба элэгдлийн зөрүүг өгнө");
  if (today > snapshot.deadline) warnings.push(`Эцсийн хугацаа ${snapshot.deadline} өнгөрсөн — хоцорсон тайлан`);
  return { errors, warnings, checkedOn: today };
}

/** Маягтаар шалгалт. */
export function validateSnapshot(snapshot: EtaxSnapshot, today: string): EtaxValidation {
  switch (snapshot.form) {
    case "pit":
      return validatePitSnapshot(snapshot, today);
    case "cit":
      return validateCitSnapshot(snapshot, today);
    default:
      return validateVatSnapshot(snapshot, today);
  }
}

/** Хоёр snapshot-ын ДҮН зөрөх үү — хадгалсан ноорог хуучирсан эсэх. */
export function snapshotAmountsDiffer(a: EtaxSnapshot, b: EtaxSnapshot): boolean {
  const keys = new Set([...Object.keys(a.amounts), ...Object.keys(b.amounts)]);
  for (const key of keys) if (Math.abs((a.amounts[key] ?? 0) - (b.amounts[key] ?? 0)) > TOLERANCE) return true;
  return false;
}

/** Төлөвийн машин — зөвхөн эдгээр ирмэг. */
export const ETAX_TRANSITIONS: Readonly<Record<EtaxSubmissionStatus, readonly EtaxSubmissionStatus[]>> = {
  draft: ["ready", "cancelled"],
  // ready → saved: API-аар ТЕГ-д хадгалсан; ready → submitted: вэбээс гараар тушаасан (дугаартай)
  ready: ["saved", "submitted", "draft", "cancelled"],
  // saved → saved: дахин хадгалах (ижил reportNo); saved → draft: дүн өөрчлөгдвөл дахин бодох
  saved: ["saved", "submitted", "draft", "cancelled"],
  submitted: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: EtaxSubmissionStatus, to: EtaxSubmissionStatus): boolean {
  return ETAX_TRANSITIONS[from].includes(to);
}

/** Шилжилт зөвшөөрөгдөхгүй бол ШИДНЭ ([ETAX_STATE]). */
export function assertTransition(from: EtaxSubmissionStatus, to: EtaxSubmissionStatus): void {
  if (!canTransition(from, to))
    throw new EtaxError(ETAX_ERRORS.state, `«${from}» төлвөөс «${to}» руу шилжих боломжгүй`);
}

/** Батлах шинжтэй шилжилт (tax:post) — ТЕГ-д тушаасан/хүлээн авсан/буцаасан гэж бүртгэх. */
export function isPostingTransition(to: EtaxSubmissionStatus): boolean {
  return to === "submitted" || to === "accepted" || to === "rejected";
}

/** Тушаалтын бүртгэлд ТЕГ-ийн дугаар (reportNo эсвэл гараар) ЗААВАЛ (хоосон «тушаасан» төлөв ХОРИОТОЙ). */
export function requiresTaxReference(to: EtaxSubmissionStatus): boolean {
  return to === "submitted";
}

export function normalizeTaxReference(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > 64) throw new EtaxError(ETAX_ERRORS.validation, "ТЕГ-ийн дугаар 64 тэмдэгтээс урт байж болохгүй");
  return text;
}

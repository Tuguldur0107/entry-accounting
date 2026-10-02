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
  ETAX_FORMS,
  type EtaxFormKey,
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

/** НӨАТ-ын тайлангийн snapshot — ТЕГ-ийн маягтын мөрөнд буулгахын ӨМНӨХ Entry-ийн тал. */
export interface EtaxVatSnapshot {
  form: EtaxFormKey;
  formCode: string;
  periodCode: string; // YYYY-MM
  taxpayer: EtaxTaxpayer;
  amounts: {
    outputVat: number;
    inputVat: number;
    carriedInVat: number;
    payableVat: number;
    refundableVat: number;
  };
  counts: { outputLines: number; inputLines: number };
  source: {
    outputVatAccount: string;
    inputVatAccount: string;
    vatRatePercent: number;
    /** Тооцооны журнал (ноорог/батлагдсан) байвал — лавлагаа. */
    settlementVoucherId: string | null;
  };
  deadline: string; // YYYY-MM-DD
  /** Бодсон мөч (ISO) — хуучирсан эсэхийг харуулахад. */
  computedAt: string;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function cleanText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

/** `computeVatReturn`-ийн дүнг хуулж snapshot үүсгэнэ — дүн дахин бодогдохгүй. */
export function buildVatSnapshot(input: {
  summary: VatReturnSummary;
  settings: { outputVatAccountNumber: string; inputVatAccountNumber: string; vatRatePercent: number };
  taxpayer: EtaxTaxpayer;
  settlementVoucherId?: string | null;
  computedAt: Date;
}): EtaxVatSnapshot {
  const { summary, settings, taxpayer } = input;
  return {
    form: "vat",
    formCode: ETAX_FORMS.vat.code,
    periodCode: summary.periodCode,
    taxpayer: {
      name: taxpayer.name.trim(),
      registerNo: cleanText(taxpayer.registerNo),
      vatPayerNo: cleanText(taxpayer.vatPayerNo),
    },
    amounts: {
      outputVat: round2(summary.outputVat),
      inputVat: round2(summary.inputVat),
      carriedInVat: round2(summary.carriedInVat),
      payableVat: round2(summary.payableVat),
      refundableVat: round2(summary.refundableVat),
    },
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

export interface EtaxValidation {
  errors: string[];
  warnings: string[];
  /** Шалгасан өдөр (УБ, YYYY-MM-DD). */
  checkedOn: string;
}

const REGISTER_RE = /^\d{7}$/;
const TOLERANCE = 0.01;

/**
 * Snapshot-ын уялдаа + толгойн бүрдэл. `errors` байвал «Бэлэн» болохгүй; `warnings` нь
 * хүнд ил харагдах анхааруулга (хоцорсон, хоосон тайлан). Хувь, торгуулийн дүн энд
 * БОДОГДОХГҮЙ (хуулийн тоо кодод байхгүй — зөвхөн хугацаа хэтэрснийг хэлнэ).
 */
export function validateVatSnapshot(snapshot: EtaxVatSnapshot, today: string): EtaxValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { amounts, taxpayer, counts } = snapshot;

  if (!isPeriodCode(snapshot.periodCode)) errors.push("Тайлант үеийн код буруу (YYYY-MM)");
  if (!taxpayer.name) errors.push("Компанийн нэр хоосон — Тохиргоо → Компанийн мэдээлэл");
  if (!taxpayer.registerNo) errors.push("Байгууллагын регистрийн дугаар хоосон — Тохиргоо → Компанийн мэдээлэл");
  else if (!REGISTER_RE.test(taxpayer.registerNo)) errors.push("Регистрийн дугаар 7 оронтой тоо байна");

  for (const [key, label] of [
    ["outputVat", "Гаралтын НӨАТ"],
    ["inputVat", "Оролтын НӨАТ"],
    ["carriedInVat", "Шилжсэн кредит"],
    ["payableVat", "Төлөх НӨАТ"],
    ["refundableVat", "Шилжүүлэх НӨАТ"],
  ] as const) {
    const value = amounts[key];
    if (!Number.isFinite(value)) errors.push(`${label} тоо биш`);
    else if (value < 0) errors.push(`${label} сөрөг байж болохгүй`);
  }

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

  if (counts.outputLines === 0 && counts.inputLines === 0 && amounts.carriedInVat === 0)
    warnings.push("Энэ сард НӨАТ-ын мөр алга — тэг тайлан (хоосон ч тушаана)");
  if (today > snapshot.deadline) warnings.push(`Эцсийн хугацаа ${snapshot.deadline} өнгөрсөн — хоцорсон тайлан (алданги тооцогдож болзошгүй)`);

  return { errors, warnings, checkedOn: today };
}

/** Хоёр snapshot-ын ДҮН зөрөх үү — хадгалсан ноорог хуучирсан эсэх. */
export function snapshotAmountsDiffer(a: EtaxVatSnapshot, b: EtaxVatSnapshot): boolean {
  const keys = ["outputVat", "inputVat", "carriedInVat", "payableVat", "refundableVat"] as const;
  return keys.some((key) => Math.abs(a.amounts[key] - b.amounts[key]) > TOLERANCE);
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

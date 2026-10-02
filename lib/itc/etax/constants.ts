// eTax («Цахим татварын систем», etax.mta.mn, ТЕГ) холболтын ЛИТЕРАЛ — CLIENT-SAFE
// (DB/сүлжээгүй). Эх: АЛБАН спек `docs/integrations/etax/00-etax-api-spec.md`
// (developer.itc.gov.mn proj-1787125468395, 2026-10-02), docs/dev/etax.md.
// Замууд спекээс ҮГЧЛЭН — зохиохгүй; спекд байхгүй зүйл (бодит орчны client_id,
// staging API хост) ИЛ тэмдэглэгдсэн, env-ээр дарагдана.

import type { ItcEnvironment } from "../constants";

/** eTax вэбийн хаяг (хэрэглэгч гараар тушаах, баталгаажуулах хуудас). Staging хост тодорхойгүй. */
export const ETAX_WEB_BASE: Readonly<Record<ItcEnvironment, string | null>> = {
  production: "https://etax.mta.mn",
  staging: null,
};

/**
 * Keycloak client_id — албан спек §3.1: туршилтын орчинд `etax-api-staging`. Бодит орчны
 * client_id спекд ЗААГААГҮЙ → env `ETAX_CLIENT_ID`; үгүй бол eTax вэбийн public client
 * `etax-gui` (realm ITC, 2026-10-02 ажиглагдсан) — ITC-ээс тодруулна (docs/dev/etax.md §6).
 */
export const ETAX_CLIENT_IDS: Readonly<Record<ItcEnvironment, string>> = {
  staging: "etax-api-staging",
  production: "etax-gui",
};
/** @deprecated — `ETAX_CLIENT_IDS.production`; хуучин импортод. */
export const ETAX_CLIENT_ID_DEFAULT = ETAX_CLIENT_IDS.production;

/**
 * eTax API суурь хаяг (албан спек: `https://etax.mta.mn/api/beta/...`). Туршилтын орчны
 * API хост спекд зөвхөн вэб `st-etax.mta.mn` гэж дурдагдсан → ижил хостоор таамаглаж
 * env `ETAX_API_BASE_STAGING`-ээр дарна; бодит орчинд прокси хэрэгтэй бол `ETAX_API_BASE`.
 */
export const ETAX_API_BASE: Readonly<Record<ItcEnvironment, string>> = {
  production: "https://etax.mta.mn",
  staging: "https://st-etax.mta.mn",
};

/** Албан замууд (спек §3.2–§3.10). Хавсралт мэдээ (§3.11–§3.16) — дараагийн алхам. */
export const ETAX_PATHS = {
  userOrgs: "/api/beta/user/getUserOrgs",
  reportList: "/api/beta/return/getList",
  history: "/api/beta/return/getHistory",
  lateList: "/api/beta/return/getLateList",
  formList: "/api/beta/return/getFormList",
  formDetail: "/api/beta/return/getFormDetail",
  formData: "/api/beta/return/getFormData",
  saveFormData: "/api/beta/return/saveFormData",
  submit: "/api/beta/return/submit",
  /** Хавсралт мэдээ (sheet) — спек §3.11–§3.15. */
  sheetList: "/api/beta/return/getSheetList",
  sheetDetail: "/api/beta/return/getSheetDetail",
  sheetData: "/api/beta/return/getSheetData",
  saveSheetData: "/api/beta/return/saveSheetData",
  deleteAllSheetData: "/api/beta/return/deleteAllSheetData",
} as const;

/** ТЕГ-ийн тайлангийн төлвийн код (спек §3.6–§3.10). */
export const ETAX_TAX_STATUS = {
  saved: 2,
  submitted: 3,
  assigned: 6,
  received: 11,
  returned: 8,
} as const;
export const ETAX_TAX_STATUS_LABELS: Readonly<Record<number, string>> = {
  2: "Хадгалсан",
  3: "Илгээсэн",
  6: "Хуваарилсан",
  11: "Хүлээн авсан",
  8: "Буцаасан",
};

/** Сүлжээний timeout (мс). */
export const ETAX_TIMEOUT_MS = 60_000;

/** Татварын тайлангийн маягтууд — НӨАТ (сар), ХАОАТ суутгал (сар), ААНОАТ (улирал, өссөн дүнгээр). */
export type EtaxFormKey = "vat" | "pit" | "cit";
export const ETAX_FORM_KEYS: readonly EtaxFormKey[] = ["vat", "pit", "cit"];

/** Тайлант үеийн төрөл: сар `YYYY-MM`, улирал `YYYY-Qn`, жил `YYYY`. */
export type EtaxPeriodKind = "month" | "quarter" | "year";

export interface EtaxFormMeta {
  key: EtaxFormKey;
  /** ТЕГ-ийн маягтын код (ТТ-03А НӨАТ; ТТ-11 ХАОАТ суутгагч; ТТ-02 ААНОАТ — спекийн жишээ `reportNoStr "TT-02"`). */
  code: string;
  label: string;
  shortLabel: string;
  periodKind: EtaxPeriodKind;
  /** Өссөн дүнгээр (жилийн эхнээс тайлант үеийн эцэс хүртэл) — ААНОАТ. */
  cumulative: boolean;
  /** Entry-ийн эх хуудас (бодолт). */
  sourceHref: string;
  /** Маягтын нүдэнд буулгах Entry-ийн талбарууд (нэг удаагийн холболт). */
  fields: readonly string[];
  /** Холболтод ЗААВАЛ талбарууд. */
  requiredFields: readonly string[];
  /** Хуудасны дүнгийн картууд (≤ 4). */
  cardFields: readonly string[];
  /** ТЕГ-ийн тушаах жагсаалтаас татварын төрлийг нэрээр таних (холболт сонгоогүй үед). */
  namePattern: RegExp;
}

export const ETAX_VAT_FIELDS = ["outputVat", "inputVat", "carriedInVat", "payableVat", "refundableVat"] as const;
export type EtaxVatField = (typeof ETAX_VAT_FIELDS)[number];
export const ETAX_PIT_FIELDS = ["employeeCount", "earnings", "employeeSi", "taxableIncome", "pitCredit", "pit", "netSalary"] as const;
export const ETAX_CIT_FIELDS = [
  "revenue",
  "cogs",
  "operatingExpenses",
  "financeExpenses",
  "totalExpenses",
  "profitBeforeTax",
  "bookDepreciation",
  "taxDepreciation",
  "depreciationAdjustedProfit",
] as const;

export const ETAX_FORMS: Readonly<Record<EtaxFormKey, EtaxFormMeta>> = {
  vat: {
    key: "vat",
    code: "ТТ-03А",
    label: "НӨАТ-ын тайлан",
    shortLabel: "НӨАТ",
    periodKind: "month",
    cumulative: false,
    sourceHref: "/tax/vat",
    fields: ETAX_VAT_FIELDS,
    requiredFields: ["outputVat", "inputVat", "payableVat"],
    cardFields: ["outputVat", "inputVat", "payableVat", "refundableVat"],
    namePattern: /НӨАТ|нэмэгдсэн\s+өртг/iu,
  },
  pit: {
    key: "pit",
    code: "ТТ-11",
    label: "ХАОАТ суутгагчийн тайлан (цалин)",
    shortLabel: "ХАОАТ",
    periodKind: "month",
    cumulative: false,
    sourceHref: "/tax/pit",
    fields: ETAX_PIT_FIELDS,
    requiredFields: ["earnings", "pit"],
    cardFields: ["employeeCount", "earnings", "taxableIncome", "pit"],
    namePattern: /ХХОАТ|ХАОАТ|цалин|хөдөлмөрийн\s+хөлс|суутгасан/iu,
  },
  cit: {
    key: "cit",
    code: "ТТ-02",
    label: "ААНОАТ-ын тайлан (өссөн дүнгээр)",
    shortLabel: "ААНОАТ",
    periodKind: "quarter",
    cumulative: true,
    sourceHref: "/tax/cit",
    fields: ETAX_CIT_FIELDS,
    requiredFields: ["revenue", "profitBeforeTax"],
    cardFields: ["revenue", "totalExpenses", "profitBeforeTax", "depreciationAdjustedProfit"],
    namePattern: /ААНОАТ|аж\s+ахуйн\s+нэгж|орлогын\s+албан\s+татвар/iu,
  },
};

export function isEtaxFormKey(value: unknown): value is EtaxFormKey {
  return value === "vat" || value === "pit" || value === "cit";
}

/** Талбарын шошго — бүх маягтын нэг толь. */
export const ETAX_FIELD_LABELS: Readonly<Record<string, string>> = {
  outputVat: "Гаралтын НӨАТ (борлуулалт)",
  inputVat: "Оролтын НӨАТ (худалдан авалт)",
  carriedInVat: "Өмнөх үеэс шилжсэн кредит",
  payableVat: "Төлөх НӨАТ",
  refundableVat: "Дараа үед шилжүүлэх НӨАТ",
  employeeCount: "Ажилтны тоо",
  earnings: "Нийт олголт (цалин, нэмэгдэл)",
  employeeSi: "НДШ (ажилтан)",
  taxableIncome: "Татвар ногдох орлого",
  pitCredit: "Татварын хөнгөлөлт",
  pit: "Суутгасан ХАОАТ",
  netSalary: "Гарт олгох цалин",
  revenue: "Орлого (5-р бүлэг)",
  cogs: "Борлуулсан бүтээгдэхүүний өртөг (6)",
  operatingExpenses: "Үйл ажиллагааны зардал (7)",
  financeExpenses: "Санхүүгийн зардал (8)",
  totalExpenses: "Нийт зардал",
  profitBeforeTax: "Татвар төлөхийн өмнөх ашиг (дансны)",
  bookDepreciation: "Дансны элэгдэл (IAS 16)",
  taxDepreciation: "Татварын элэгдэл (мэмо)",
  depreciationAdjustedProfit: "Элэгдлийн зөрүүгээр тохируулсан ашиг",
};
/** @deprecated — `ETAX_FIELD_LABELS`. */
export const ETAX_VAT_FIELD_LABELS: Readonly<Record<EtaxVatField, string>> = {
  outputVat: ETAX_FIELD_LABELS.outputVat,
  inputVat: ETAX_FIELD_LABELS.inputVat,
  carriedInVat: ETAX_FIELD_LABELS.carriedInVat,
  payableVat: ETAX_FIELD_LABELS.payableVat,
  refundableVat: ETAX_FIELD_LABELS.refundableVat,
};

/**
 * Илгээлтийн төлөв — ноорог-first (CLAUDE.md §9): тайлан ТЕГ-д хүний гарын үсэг /
 * баталгаажуулалтгүйгээр хэзээ ч явахгүй.
 *  draft     — Entry-ийн бодолтоос авсан snapshot; дахин бодож шинэчилж болно
 *  ready     — шалгалт (`validateVatSnapshot`) алдаагүй, хүн хянасан
 *  saved     — eTax API-аар ТЕГ-д ХАДГАЛСАН (reportNo-той, илгээгээгүй — ТЕГ-ийн төлөв 2)
 *  submitted — ТЕГ-д тушаасан (API `submit` эсвэл вэбээс гараар; ТЕГ-ийн дугаартай)
 *  accepted  — ТЕГ хүлээн авсан
 *  rejected  — ТЕГ буцаасан (шалтгаан `resultNote`) → шинэ ноорог
 *  cancelled — Entry-д хүчингүй болгосон
 */
export const ETAX_SUBMISSION_STATUSES = ["draft", "ready", "saved", "submitted", "accepted", "rejected", "cancelled"] as const;
export type EtaxSubmissionStatus = (typeof ETAX_SUBMISSION_STATUSES)[number];

export const ETAX_STATUS_LABELS: Readonly<Record<EtaxSubmissionStatus, string>> = {
  draft: "Ноорог",
  ready: "Бэлэн",
  saved: "ТЕГ-д хадгалсан",
  submitted: "Тушаасан",
  accepted: "Хүлээн авсан",
  rejected: "Буцаасан",
  cancelled: "Хүчингүй",
};

/** Нэг маягт × тайлант үед ЗЭРЭГ нэг л «амьд» илгээлт (partial unique index). */
export const ETAX_ACTIVE_STATUSES: readonly EtaxSubmissionStatus[] = ["draft", "ready", "saved", "submitted", "accepted"];

/** `[CODE]` алдааны кодууд. */
export const ETAX_ERRORS = {
  config: "ETAX_CONFIG",
  validation: "ETAX_VALIDATION",
  state: "ETAX_STATE",
  /** ТЕГ-ийн API хариу алдаатай (code ≠ 0, HTTP ≥ 400). */
  api: "ETAX_API",
  /** Хүрсэнгүй / timeout. */
  network: "ETAX_NETWORK",
  /** Нэвтрэлт / NE-KEY хүчингүй. */
  auth: "ETAX_AUTH",
} as const;

/** Хавсралт мэдээний ЭХ — Entry-ийн аль задаргаа мэдээг бөглөх вэ (docs/dev/etax.md §7). */
export const ETAX_SHEET_SOURCES = ["sales", "purchases", "payroll"] as const;
export type EtaxSheetSource = (typeof ETAX_SHEET_SOURCES)[number];
export const ETAX_SHEET_SOURCE_LABELS: Readonly<Record<EtaxSheetSource, string>> = {
  sales: "Борлуулалтын задаргаа (авлагын нэхэмжлэх, POS)",
  purchases: "Худалдан авалтын задаргаа (өглөгийн нэхэмжлэх)",
  payroll: "Цалингийн задаргаа (ажилтан бүрээр — ХАОАТ)",
};

/** Мэдээний мөрийн нэгтгэл: харилцагчаар нийлбэр эсвэл баримт бүрээр. */
export const ETAX_SHEET_GRANULARITIES = ["counterparty", "document"] as const;
export type EtaxSheetGranularity = (typeof ETAX_SHEET_GRANULARITIES)[number];
export const ETAX_SHEET_GRANULARITY_LABELS: Readonly<Record<EtaxSheetGranularity, string>> = {
  counterparty: "Харилцагчаар нэгтгэх",
  document: "Баримт бүрээр",
};

/** Мэдээний мөрийн Entry талбарууд — ТЕГ-ийн мэдээний баганад холбогдоно. */
export const ETAX_SHEET_FIELDS = [
  "rowNo",
  "registerNo",
  "tin",
  "name",
  "documentNo",
  "date",
  "ddtd",
  "netAmount",
  "vatAmount",
  "totalAmount",
  "documentCount",
] as const;
export type EtaxSheetField = (typeof ETAX_SHEET_FIELDS)[number];
export const ETAX_SHEET_FIELD_LABELS: Readonly<Record<EtaxSheetField, string>> = {
  rowNo: "Дугаар (д/д)",
  registerNo: "Харилцагчийн регистр",
  tin: "Харилцагчийн ТТД",
  name: "Харилцагчийн нэр",
  documentNo: "Баримтын дугаар",
  date: "Огноо",
  ddtd: "eBarimt ДДТД",
  netAmount: "Дүн (НӨАТ-гүй) / татвар ногдох орлого",
  vatAmount: "НӨАТ / суутгасан татвар",
  totalAmount: "Нийт дүн / нийт олголт",
  documentCount: "Баримтын тоо",
};

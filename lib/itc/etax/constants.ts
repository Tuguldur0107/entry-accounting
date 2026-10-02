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

/** Татварын тайлангийн маягт — Entry-д одоо бэлтгэдэг нь зөвхөн НӨАТ (сарын). */
export type EtaxFormKey = "vat";

export interface EtaxFormMeta {
  key: EtaxFormKey;
  /** ТЕГ-ийн маягтын код (вэбд ажиглагдсан хуудасны код `TT-03A_*`). */
  code: string;
  label: string;
  periodKind: "month";
  /** Entry-ийн эх хуудас (бодолт). */
  sourceHref: string;
}

export const ETAX_FORMS: Readonly<Record<EtaxFormKey, EtaxFormMeta>> = {
  vat: { key: "vat", code: "ТТ-03А", label: "НӨАТ-ын тайлан", periodKind: "month", sourceHref: "/tax/vat" },
};

export function isEtaxFormKey(value: unknown): value is EtaxFormKey {
  return value === "vat";
}

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

/** Маягтын нүдэнд буулгах Entry-ийн НӨАТ-ын талбарууд (нэг удаагийн холболт — docs/dev/etax.md §4). */
export const ETAX_VAT_FIELDS = ["outputVat", "inputVat", "carriedInVat", "payableVat", "refundableVat"] as const;
export type EtaxVatField = (typeof ETAX_VAT_FIELDS)[number];
export const ETAX_VAT_FIELD_LABELS: Readonly<Record<EtaxVatField, string>> = {
  outputVat: "Гаралтын НӨАТ (борлуулалт)",
  inputVat: "Оролтын НӨАТ (худалдан авалт)",
  carriedInVat: "Өмнөх үеэс шилжсэн кредит",
  payableVat: "Төлөх НӨАТ",
  refundableVat: "Дараа үед шилжүүлэх НӨАТ",
};

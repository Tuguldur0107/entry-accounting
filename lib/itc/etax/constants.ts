// eTax («Цахим татварын систем», etax.mta.mn, ТЕГ) холболтын ЛИТЕРАЛ — CLIENT-SAFE
// (DB/сүлжээгүй). Эх: docs/dev/etax.md, docs/integrations/00-itc-developer-portal.md §4.
//
// ⚠ eTax-ийн АЛБАН гуравдагч талын API-ийн замууд («ETAX API documentation v1.1»,
// developer портал etax-api — Монголын IP-ээс л) ЭНД ХАРААХАН БАЙХГҮЙ. 2026-10-02-нд
// вэбийн (etax.mta.mn) өөрийн backend нь `/backapi/beta/return/*` гэж ажиглагдсан боловч
// тэр нь GUI-ийн ДОТООД, баримтжаагүй API тул production кодонд ХЭРЭГЛЭХГҮЙ (зохиохгүй).
// Спек ирмэгц `ETAX_PATHS`-ыг энд нэмж `client.ts` бичнэ.

import type { ItcEnvironment } from "../constants";

/** eTax вэбийн хаяг (хэрэглэгч гараар тушаах, баталгаажуулах хуудас). Staging хост тодорхойгүй. */
export const ETAX_WEB_BASE: Readonly<Record<ItcEnvironment, string | null>> = {
  production: "https://etax.mta.mn",
  staging: null,
};

/**
 * Keycloak client_id — eTax вэбийн өөрийнх `etax-gui` (realm `ITC`, 2026-10-02 бодит
 * bundle-аас ажиглагдсан; `grant_type=password` realm-д нээлттэй). API-д зориулсан
 * тусдаа client олгогдвол env `ETAX_CLIENT_ID`-аар дарна (`etaxClientId()`).
 */
export const ETAX_CLIENT_ID_DEFAULT = "etax-gui";

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
 *  submitted — ТЕГ-д тушаасан (одоогоор вэбээс гараар; ТЕГ-ийн хүлээн авсан дугаартай)
 *  accepted  — ТЕГ хүлээн авсан
 *  rejected  — ТЕГ буцаасан (шалтгаан `resultNote`) → шинэ ноорог
 *  cancelled — Entry-д хүчингүй болгосон
 */
export const ETAX_SUBMISSION_STATUSES = ["draft", "ready", "submitted", "accepted", "rejected", "cancelled"] as const;
export type EtaxSubmissionStatus = (typeof ETAX_SUBMISSION_STATUSES)[number];

export const ETAX_STATUS_LABELS: Readonly<Record<EtaxSubmissionStatus, string>> = {
  draft: "Ноорог",
  ready: "Бэлэн",
  submitted: "Тушаасан",
  accepted: "Хүлээн авсан",
  rejected: "Буцаасан",
  cancelled: "Хүчингүй",
};

/** Нэг маягт × тайлант үед ЗЭРЭГ нэг л «амьд» илгээлт (partial unique index). */
export const ETAX_ACTIVE_STATUSES: readonly EtaxSubmissionStatus[] = ["draft", "ready", "submitted", "accepted"];

/** `[CODE]` алдааны кодууд. */
export const ETAX_ERRORS = {
  config: "ETAX_CONFIG",
  validation: "ETAX_VALIDATION",
  state: "ETAX_STATE",
} as const;

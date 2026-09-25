// ITC (Мэдээллийн технологийн үндэсний парк) системүүдийн холболтын ЛИТЕРАЛ —
// eTax, eBarimt TPI-ийн хост, realm, client_id, зам. ЦОРЫН ГАНЦ эх сурвалж,
// CLIENT-SAFE (DB/сүлжээгүй). Эх: docs/integrations/00-itc-developer-portal.md §2–§4.
//
// ⚠ eTax API-ийн өөрийн замууд («ETAX API documentation v1.1» PDF — Монголын
// сүлжээнээс л татагдана) ЭНД ХАРААХАН БАЙХГҮЙ: §4.4-ийн асуултын хариу ирмэгц
// `ETAX_PATHS`-д нэмнэ. Зохиохгүй.

export type ItcEnvironment = "staging" | "production";

export const ITC_ENVIRONMENTS: readonly ItcEnvironment[] = ["staging", "production"];

/** Нэвтрэлтийн нэгдсэн систем (Keycloak) — орчин бүрд authBase + realm. */
export const ITC_AUTH: Readonly<Record<ItcEnvironment, { authBase: string; realm: string }>> = {
  staging: { authBase: "https://st.auth.itc.gov.mn", realm: "Staging" },
  production: { authBase: "https://auth.itc.gov.mn", realm: "ITC" },
};

/** Хандах домэйн → client_id (албан заавар §2). eTax API-ийн client_id тодруулагдаагүй. */
export const ITC_CLIENT_IDS = {
  /** api.ebarimt.mn — eBarimt TPI (борлуулалтын задаргаа, мерчант бүртгэл …). */
  ebarimtTpi: "vatps",
  /** service.itc.gov.mn — хялбар бүртгэл, ОАТ. */
  eInventory: "e-inventory",
  /** etax.mta.mn вэбийн нэвтрэлт (API-ийн client_id §4.4 №2-оор тодруулна). */
  etaxGui: "etax-gui",
} as const;

/** eBarimt TPI (api.ebarimt.mn) — орчин бүрийн суурь хаяг. */
export const EBARIMT_TPI_BASE: Readonly<Record<ItcEnvironment, string>> = {
  staging: "https://st-api.ebarimt.mn",
  production: "https://api.ebarimt.mn",
};

/** TPI замууд (alban: developer.itc.gov.mn ebarimt-api). */
export const TPI_PATHS = {
  /** Борлуулалтын задаргаа (жил/сар/өдөр, status) — том татвар төлөгчид. */
  salesTotalData: "/api/tpi/receipt/getSalesTotalData",
  /** Толгой татвар төлөгч охин компанийнхаа ХУДАЛДАН АВАЛТЫГ татах (оролтын НӨАТ тулгалт). */
  saleListErp: "/api/tpi/receipt/getSaleListERP",
  /** Татвар төлөгчийн мэдээлэл (ТТД → нэр, НӨАТ/НХАТ төлөгч, чөлөөлөгдөх төсөл). */
  info: "/api/info/check/getInfo",
} as const;

/** `getSalesTotalData` status шүүлт (албан тайлбар). */
export const TPI_SALES_STATUS = {
  all: 0,
  b2b: 1,
  withLottery: 2,
  invoice: 3,
  batchHeader: 4,
} as const;
export type TpiSalesStatus = (typeof TPI_SALES_STATUS)[keyof typeof TPI_SALES_STATUS];

/** Сүлжээний timeout (мс) — token 10 сек, TPI тайлан 60 сек (том хугацаа удаан). */
export const ITC_TOKEN_TIMEOUT_MS = 10_000;
export const ITC_TPI_TIMEOUT_MS = 60_000;

/**
 * Token-ийг дуусахаас ХЭДЭН мс өмнө хуучирсан гэж үзэх — цагийн зөрүү,
 * сүлжээний саатлаас хамгаална (хүсэлт явж байхад дуусахгүй).
 */
export const ITC_TOKEN_SKEW_MS = 30_000;

/** `[CODE]` алдааны кодууд — action/tool-ийн мессежийн угтвар. */
export const ITC_ERRORS = {
  /** Тохиргоо дутуу (орчин, нэвтрэх нэр, түлхүүр). */
  config: "ITC_CONFIG",
  /** Нэвтрэлт амжилтгүй (Keycloak 400/401). */
  auth: "ITC_AUTH",
  /** Хүрсэнгүй / timeout (Монголын IP-ээс л хандагддаг — §3). */
  network: "ITC_NETWORK",
  /** TPI хариу алдаатай / танигдахгүй. */
  tpi: "ITC_TPI",
} as const;

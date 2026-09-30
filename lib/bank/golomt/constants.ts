// Голомт банкны Open Banking Interface (OBI SPEC 1.5.9) — ЦЭВЭР тогтмол ба
// төрлүүд. DB / node:crypto импортгүй тул client component ч импортолж болно
// (CLAUDE.md «Client/server хил»). Дэлгэрэнгүй: docs/dev/bank-api.md.

/** Банкны 6 оронтой код (lib/qpay/reference.ts QPAY_BANK_CODES-той ижил). */
export const GOLOMT_BANK_CODE = "150000";

export const GOLOMT_ENVIRONMENTS = ["uat", "production"] as const;
export type GolomtEnvironment = (typeof GOLOMT_ENVIRONMENTS)[number];

export const GOLOMT_ENVIRONMENT_LABELS: Record<GolomtEnvironment, string> = {
  uat: "Туршилтын орчин (UAT)",
  production: "Үндсэн орчин",
};

/**
 * Хост ЗӨВХӨН эндээс — хэрэглэгч URL оруулахгүй тул нэвтрэх нууц үг,
 * checksum-ийн түлхүүр банкны 2 хостоос өөр газар ХЭЗЭЭ Ч явахгүй.
 */
export const GOLOMT_API_BASE: Record<GolomtEnvironment, string> = {
  uat: "https://openapi-uat.golomtbank.com/api",
  production: "https://openbank.golomtbank.com/api",
};

/** Нэг татахад хамрах хамгийн урт хугацаа (хоног). */
export const GOLOMT_STATEMENT_MAX_DAYS = 92;
/** OPERACCSTAINQ-ийн нэг хуудасны мөр. */
export const GOLOMT_STATEMENT_PAGE_SIZE = 100;
/** Импортын нэг хуулгын дээд хэмжээ (saveBankStatement-тэй ижил). */
export const GOLOMT_STATEMENT_MAX_ROWS = 5_000;

export function isGolomtEnvironment(value: unknown): value is GolomtEnvironment {
  return (
    typeof value === "string" &&
    (GOLOMT_ENVIRONMENTS as readonly string[]).includes(value)
  );
}

/**
 * Кассын данс Голомтын харилцах данс мөн эсэх — банкны код (150000) эсвэл
 * нэрээр. Дансны дугаар заавал (API-д accountId болно).
 */
export function isGolomtCashAccount(account: {
  accountType: string;
  bankCode?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
}): boolean {
  if (account.accountType !== "bank") return false;
  if (!golomtAccountId(account.accountNumber)) return false;
  if ((account.bankCode ?? "").trim() === GOLOMT_BANK_CODE) return true;
  return /голомт|golomt/i.test(account.bankName ?? "");
}

/** Дансны дугаарыг API-ийн accountId болгоно (зай, зураас хасна); буруу бол null. */
export function golomtAccountId(accountNumber: string | null | undefined): string | null {
  const digits = (accountNumber ?? "").replace(/[\s-]/g, "");
  return /^\d{6,20}$/.test(digits) ? digits : null;
}

/** Холболтын тохиргоо — client-д харагдах хэлбэр (нууц утга БАЙХГҮЙ). */
export type GolomtConnectionView = {
  environment: GolomtEnvironment;
  username: string;
  clientId: string;
  registerNo: string;
  isEnabled: boolean;
  /** Нууц үг, session key, IV key бүгд хадгалагдсан эсэх. */
  hasSecrets: boolean;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
};

/** ACCTLST-ийн нэг харилцах данс (шалгалтын үр дүнд харуулна). */
export type GolomtAccountSummary = {
  accountId: string;
  accountName: string;
  currency: string;
};

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Хуулга татах хугацааны шалгалт — алдааны текст эсвэл null. `today` нь
 * Улаанбаатарын өнөөдөр (ulaanbaatarToday) — ирээдүйн огноо татахгүй.
 */
export function golomtStatementRangeError(
  startDate: string,
  endDate: string,
  today: string
): string | null {
  if (!isIsoDate(startDate) || !isIsoDate(endDate))
    return "Эхлэх, дуусах огноог YYYY-MM-DD хэлбэрээр оруулна уу";
  if (startDate > endDate) return "Эхлэх огноо дуусах огнооноос хойш байна";
  if (endDate > today) return "Дуусах огноо ирээдүйд байж болохгүй";
  const days =
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) /
      86_400_000 +
    1;
  if (days > GOLOMT_STATEMENT_MAX_DAYS)
    return `Нэг удаад ${GOLOMT_STATEMENT_MAX_DAYS} хоногоос ихгүй хугацаа татна`;
  return null;
}

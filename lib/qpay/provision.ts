// QPay мерчант АВТОМАТ бүртгэлийн оролт — ЦЭВЭР (DB-гүй, client-safe), тесттэй.
// docs/deployment/qpay.md §2b, dashboard docs/API.md «Partner».
//
// Entry-ийн компанийн мэдээлэл (company_settings) + байгууллагын эзэн →
// dashboard `POST /api/partner/merchants`-ийн body. Дутууг НЭРЛЭНЭ (монголоор),
// ЗОХИОХГҮЙ: MCC, хот/дүүрэг, банкны код, регистр — хэрэглэгч бөглөнө.
// Регистрийн хэлбэрээс төрөл (company / person) шийдэгдэнэ.

import type { CompanyBankAccount } from "@/lib/db/schema";
import { QPAY_MCC_CODES, guessQpayBankCode, qpayBankName } from "./reference";

export interface QpayProvisionCompany {
  name: string;
  registerNo: string | null;
  mccCode: string | null;
  cityCode: string | null;
  districtCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bankAccounts: CompanyBankAccount[];
}

export interface QpayProvisionOwner {
  email: string;
  name: string | null;
}

export interface QpayProvisionInput {
  /** Entry-ийн байгууллагын ID — dashboard-ын идемпотент түлхүүр (external_id). */
  orgId: string;
  company: QpayProvisionCompany;
  owner: QpayProvisionOwner;
  /** NEXT_PUBLIC_APP_URL + /api/pos/qpay/webhook; null = нийтийн URL байхгүй (webhook-гүй). */
  webhookUrl: string | null;
  /** Дахин холбох — dashboard key-ээ солино (plaintext дахин уншигдахгүй). */
  rotateCredentials?: boolean;
}

/** Dashboard Partner API-ийн данс (snake_case — гэрээ). */
export interface PartnerBankAccount {
  account_bank_code: string;
  account_number: string;
  account_name: string;
  bank_name: string;
  iban?: string;
  is_default: boolean;
}

export interface PartnerProvisionBody {
  external_id: string;
  owner: { email: string; name?: string; phone?: string };
  merchant: {
    type: "company" | "person";
    register_number: string;
    name?: string;
    first_name?: string;
    last_name?: string;
    mcc_code: string;
    phone: string;
    email: string;
    city: string;
    district: string;
    address: string;
  };
  bank_accounts: PartnerBankAccount[];
  webhook_url?: string;
  rotate_credentials?: boolean;
  partner_label: string;
}

export type QpayProvisionPlan =
  | { ok: true; body: PartnerProvisionBody; type: "company" | "person" }
  | { ok: false; problems: string[] };

const COMPANY_REGISTER_RE = /^\d{7}$/;
const CITIZEN_REGISTER_RE = /^[А-ЯЁӨҮ]{2}\d{8}$/u;
const MCC_SET = new Set(QPAY_MCC_CODES.map((m) => m.code));

/** QPay 8 оронтой дотоод дугаар л хүлээж авна (+976 / зай / зураас хасна). */
export function normalizeQpayPhone(input: string | null | undefined): string {
  const digits = (input ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("976")) return digits.slice(3);
  if (digits.length === 13 && digits.startsWith("00976")) return digits.slice(5);
  return digits;
}

/** Регистрийн хэлбэрээс мерчантын төрөл — тодорхойгүй бол null (таахгүй). */
export function qpayMerchantTypeOf(registerNo: string | null | undefined): "company" | "person" | null {
  const value = (registerNo ?? "").trim().toUpperCase();
  if (COMPANY_REGISTER_RE.test(value)) return "company";
  if (CITIZEN_REGISTER_RE.test(value)) return "person";
  return null;
}

/**
 * Компанийн данснуудыг Partner API-ийн хэлбэрт — банкны код ЗААВАЛ (нэрээс
 * таагдвал хэрэглэнэ, эс бөгөөс асуудал), default нэг (тэмдэглээгүй бол эхнийх).
 */
export function mapQpayBankAccounts(
  accounts: CompanyBankAccount[]
): { accounts: PartnerBankAccount[]; problems: string[] } {
  const problems: string[] = [];
  const out: PartnerBankAccount[] = [];
  const filled = accounts.filter((a) => (a.accountNo ?? "").trim());
  if (filled.length === 0) problems.push("Банкны данс — компанийн мэдээлэлд дор хаяж нэг данс (QPay төлбөр орох)");
  const defaultIdx = filled.findIndex((a) => a.isDefault);
  filled.forEach((a, idx) => {
    const code = (a.bankCode ?? "").trim() || guessQpayBankCode(a.bankName);
    if (!code || !qpayBankName(code)) {
      problems.push(`Данс ${a.accountNo.trim()}: банкыг жагсаалтаас сонгоно (QPay банкны код)`);
      return;
    }
    if (!(a.accountName ?? "").trim()) {
      problems.push(`Данс ${a.accountNo.trim()}: данс эзэмшигчийн нэр`);
      return;
    }
    out.push({
      account_bank_code: code,
      account_number: a.accountNo.trim(),
      account_name: a.accountName.trim(),
      bank_name: qpayBankName(code) ?? a.bankName.trim(),
      ...((a.iban ?? "").trim() ? { iban: a.iban!.trim() } : {}),
      is_default: defaultIdx >= 0 ? idx === defaultIdx : idx === 0,
    });
  });
  return { accounts: out, problems };
}

/** Иргэний мерчантад «Овог Нэр» → last_name / first_name (2 үг заавал). */
function splitPersonName(name: string): { lastName: string; firstName: string } | null {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { lastName: parts[0], firstName: parts.slice(1).join(" ") };
}

export function buildQpayProvisionPlan(input: QpayProvisionInput): QpayProvisionPlan {
  const c = input.company;
  const problems: string[] = [];
  const name = (c.name ?? "").trim();
  const registerNo = (c.registerNo ?? "").trim().toUpperCase();
  const type = qpayMerchantTypeOf(registerNo);
  if (!name) problems.push("Компанийн нэр");
  if (!registerNo) problems.push("Регистрийн дугаар (ААН 7 орон / иргэн 2 үсэг + 8 орон)");
  else if (!type) problems.push("Регистрийн дугаар буруу хэлбэртэй (ААН 7 орон / иргэн УБ12345678)");
  const mcc = (c.mccCode ?? "").trim();
  if (!mcc || !MCC_SET.has(mcc)) problems.push("Бизнесийн ангилал (MCC) — жагсаалтаас сонгоно");
  const phone = normalizeQpayPhone(c.phone);
  if (!phone) problems.push("Утас");
  else if (!/^\d{8}$/.test(phone)) problems.push("Утас — улсын кодгүй 8 оронтой (ж: 88112233)");
  const email = (c.email ?? "").trim() || input.owner.email.trim();
  if (!email) problems.push("И-мэйл");
  const city = (c.cityCode ?? "").trim();
  const district = (c.districtCode ?? "").trim();
  if (!/^\d{4,6}$/.test(city)) problems.push("Хот/аймаг — жагсаалтаас сонгоно");
  if (!/^\d{4,6}$/.test(district)) problems.push("Дүүрэг/сум — жагсаалтаас сонгоно");
  const address = (c.address ?? "").trim();
  if (!address) problems.push("Хаяг");
  const banks = mapQpayBankAccounts(c.bankAccounts ?? []);
  problems.push(...banks.problems);
  let person: { lastName: string; firstName: string } | null = null;
  if (type === "person") {
    person = splitPersonName(name);
    if (!person) problems.push("Иргэний мерчантад нэрийг «Овог Нэр» хэлбэрээр (2 үг) бичнэ");
  }
  if (problems.length > 0 || !type) return { ok: false, problems };

  const merchant: PartnerProvisionBody["merchant"] = {
    type,
    register_number: registerNo,
    mcc_code: mcc,
    phone,
    email,
    city,
    district,
    address,
  };
  if (type === "company") merchant.name = name;
  else if (person) {
    merchant.first_name = person.firstName;
    merchant.last_name = person.lastName;
  }
  const ownerName = (input.owner.name ?? "").trim();
  return {
    ok: true,
    type,
    body: {
      external_id: input.orgId,
      owner: { email: input.owner.email.trim(), ...(ownerName ? { name: ownerName } : {}), phone },
      merchant,
      bank_accounts: banks.accounts,
      ...(input.webhookUrl ? { webhook_url: input.webhookUrl } : {}),
      ...(input.rotateCredentials ? { rotate_credentials: true } : {}),
      partner_label: "Entry",
    },
  };
}

/** Хоёр дансны жагсаалт QPay-ийн хувьд ижил үү (sync хэрэгтэй эсэх — хадгалахад). */
export function bankAccountsEqualForQpay(a: CompanyBankAccount[], b: CompanyBankAccount[]): boolean {
  const key = (rows: CompanyBankAccount[]) =>
    JSON.stringify(
      rows
        .filter((r) => (r.accountNo ?? "").trim())
        .map((r) => [
          (r.bankCode ?? "").trim() || guessQpayBankCode(r.bankName) || "",
          r.accountNo.trim().replace(/\s+/g, ""),
          (r.accountName ?? "").trim(),
          (r.iban ?? "").trim(),
          !!r.isDefault,
        ])
    );
  return key(a) === key(b);
}

// QPay Partner API (Entry сервер → qpay-dashboard) — SERVER модуль (DB + fetch).
// docs/deployment/qpay.md §2b, dashboard docs/API.md «Partner».
//
// Байгууллагыг dashboard-д НЭВТРЭХГҮЙГЭЭР мерчант болгоно: компанийн
// мэдээлэл + данс (company_settings) → `POST /api/partner/merchants` → api key +
// webhook secret НЭГ удаа → pos_settings-д шифртэй (connect callback-тай ЯГ ижил
// зам) → «QPay» хэлбэр + түр данс seed → readiness → асна. Дансны өөрчлөлт →
// `PUT …/bank-accounts`. Partner key ЗӨВХӨН env (`QPAY_PARTNER_KEY`);
// хариуны нууц лог/аудитад ХЭЗЭЭ Ч орохгүй.

import { eq } from "drizzle-orm";

import { encryptSecret } from "@/lib/ai/crypto";
import { logAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { organizationProfile, organizations, posSettings, users, type CompanyBankAccount, type PosSettings } from "@/lib/db/schema";
import { ensurePosSettings } from "@/lib/pos/load-data";
import { QpayError } from "./client";
import { QPAY_ERRORS, QPAY_HTTP_TIMEOUT_MS } from "./constants";
import { buildQpayProvisionPlan, mapQpayBankAccounts, type PartnerBankAccount, type PartnerProvisionBody } from "./provision";
import type { QpayReferenceOption } from "./reference";
import { ensureQpayPaymentMethod, loadQpayReadiness, qpayPartnerConfigured, qpayPartnerKey, qpayWebhookUrl } from "./store";

export { qpayPartnerConfigured, qpayPartnerKey };

export const QPAY_PARTNER_MERCHANTS_PATH = "/api/partner/merchants";
export const QPAY_PARTNER_REFERENCE_PATH = "/api/partner/reference";

interface PartnerResponse<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string; code?: string };
}

async function partnerCall<T>(apiUrl: string, method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<PartnerResponse<T>> {
  const key = qpayPartnerKey();
  if (!key) throw new QpayError(QPAY_ERRORS.partnerNotConfigured, "QPAY_PARTNER_KEY тохируулаагүй — автомат бүртгэл боломжгүй");
  let res: Response;
  try {
    res = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(QPAY_HTTP_TIMEOUT_MS * 2),
      cache: "no-store",
    });
  } catch (error) {
    throw new QpayError(QPAY_ERRORS.dashboard, `QPay dashboard-д хүрсэнгүй (${error instanceof Error ? error.message : "network"})`);
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data: data as T & { error?: string; code?: string } };
}

function partnerError(status: number, data: { error?: string; code?: string }): QpayError {
  const detail = data.error ?? `Dashboard ${status}`;
  if (status === 503 || status === 401) return new QpayError(QPAY_ERRORS.partnerNotConfigured, `Dashboard partner key: ${detail}`, status);
  if (status === 400) return new QpayError(QPAY_ERRORS.provisionRejected, detail, status);
  if (status === 409) return new QpayError(QPAY_ERRORS.provisionRejected, detail, status);
  if (status === 502) return new QpayError(QPAY_ERRORS.provisionRejected, `QPay татгалзав: ${detail}`, status);
  return new QpayError(QPAY_ERRORS.dashboard, detail, status);
}

export interface PartnerProvisionResult {
  merchantId: string;
  merchantName: string | null;
  apiKey: string | null;
  webhookSecret: string | null;
  created: boolean;
  reusedMerchant: boolean;
  ownerEmail: string;
  userCreated: boolean;
  setupLinkSent: boolean;
}

/** `POST /api/partner/merchants` — нууц ЗӨВХӨН энэ буцаалтад. */
export async function partnerProvisionMerchant(apiUrl: string, body: PartnerProvisionBody): Promise<PartnerProvisionResult> {
  const res = await partnerCall<{
    merchant_id?: string;
    merchant_name?: string | null;
    api_key?: string | null;
    webhook_secret?: string | null;
    created?: boolean;
    reused_merchant?: boolean;
    owner?: { email?: string; user_created?: boolean; setup_link_sent?: boolean };
  }>(apiUrl, "POST", QPAY_PARTNER_MERCHANTS_PATH, body);
  if (!res.ok) throw partnerError(res.status, res.data);
  if (!res.data.merchant_id) throw new QpayError(QPAY_ERRORS.dashboard, "Dashboard-ын хариу дутуу (merchant_id)", res.status);
  return {
    merchantId: res.data.merchant_id,
    merchantName: res.data.merchant_name ?? null,
    apiKey: res.data.api_key ?? null,
    webhookSecret: res.data.webhook_secret ?? null,
    created: !!res.data.created,
    reusedMerchant: !!res.data.reused_merchant,
    ownerEmail: res.data.owner?.email ?? body.owner.email,
    userCreated: !!res.data.owner?.user_created,
    setupLinkSent: !!res.data.owner?.setup_link_sent,
  };
}

/** `PUT /api/partner/merchants/{id}/bank-accounts` — Entry-ийн жагсаалт эх сурвалж. */
export async function partnerSyncBankAccounts(apiUrl: string, merchantId: string, accounts: PartnerBankAccount[]): Promise<number> {
  const res = await partnerCall<{ bank_accounts?: unknown[] }>(
    apiUrl,
    "PUT",
    `${QPAY_PARTNER_MERCHANTS_PATH}/${encodeURIComponent(merchantId)}/bank-accounts`,
    { accounts }
  );
  if (!res.ok) throw partnerError(res.status, res.data);
  return Array.isArray(res.data.bank_accounts) ? res.data.bank_accounts.length : accounts.length;
}

/** `GET /api/partner/reference?city=` — аймгийн сумд (УБ статик, lib/qpay/reference.ts). */
export async function partnerDistricts(apiUrl: string, cityCode: string): Promise<QpayReferenceOption[]> {
  if (!/^\d{5}$/.test(cityCode)) return [];
  const res = await partnerCall<{ districts?: { code: string; name: string }[] }>(
    apiUrl,
    "GET",
    `${QPAY_PARTNER_REFERENCE_PATH}?city=${encodeURIComponent(cityCode)}`
  );
  if (!res.ok) throw partnerError(res.status, res.data);
  return (res.data.districts ?? []).map((d) => ({ code: String(d.code), name: String(d.name) }));
}

// ─── Байгууллагын түвшний урсгал (DB) ────────────────────────────────────────

export interface OrgProvisionContext {
  settings: PosSettings;
  orgName: string;
  profile: typeof organizationProfile.$inferSelect | null;
  owner: { email: string; name: string | null };
}

/** Компанийн мэдээлэл + байгууллагын эзэн (owner гишүүн; олдохгүй бол дуудагч). */
export async function loadOrgProvisionContext(orgId: string, actingUserId: string): Promise<OrgProvisionContext> {
  const [settings, org, profile, owner, actor] = await Promise.all([
    ensurePosSettings(orgId, actingUserId),
    db.query.organizations.findFirst({ where: eq(organizations.id, orgId), columns: { name: true } }),
    db.query.organizationProfile.findFirst({ where: eq(organizationProfile.organizationId, orgId) }),
    db.query.memberships.findFirst({
      where: (m, { and: andOp, eq: eqOp }) => andOp(eqOp(m.organizationId, orgId), eqOp(m.role, "owner")),
      columns: { userId: true },
    }),
    db.query.users.findFirst({ where: eq(users.id, actingUserId), columns: { email: true, name: true } }),
  ]);
  const ownerUser = owner
    ? await db.query.users.findFirst({ where: eq(users.id, owner.userId), columns: { email: true, name: true } })
    : null;
  const resolved = ownerUser ?? actor;
  if (!resolved) throw new Error("Байгууллагын эзэн олдсонгүй");
  return { settings, orgName: org?.name ?? "", profile: profile ?? null, owner: { email: resolved.email, name: resolved.name } };
}

export function provisionPlanFromContext(orgId: string, ctx: OrgProvisionContext, options: { rotate?: boolean } = {}) {
  const p = ctx.profile;
  return buildQpayProvisionPlan({
    orgId,
    company: {
      name: (p?.name ?? "").trim() || ctx.orgName,
      registerNo: p?.registerNo ?? null,
      mccCode: p?.mccCode ?? null,
      cityCode: p?.cityCode ?? null,
      districtCode: p?.districtCode ?? null,
      address: p?.address ?? null,
      phone: p?.phone ?? null,
      email: p?.email ?? null,
      bankAccounts: p?.bankAccounts ?? [],
    },
    owner: ctx.owner,
    webhookUrl: qpayWebhookUrl(),
    rotateCredentials: options.rotate,
  });
}

export interface ProvisionOutcome {
  merchantId: string;
  merchantName: string | null;
  enabled: boolean;
  problems: string[];
  warnings: string[];
  seeded: string[];
  created: boolean;
  reusedMerchant: boolean;
  ownerEmail: string;
  userCreated: boolean;
  setupLinkSent: boolean;
  /** Байгаа холбоос дээр key солиогүй (rotate биш) — нууц ирээгүй, хуучин key хэвээр. */
  credentialsUnchanged: boolean;
}

/**
 * Байгууллагыг QPay мерчант болгож (эсвэл байгаа холбоосыг sync-лэж) нууцыг
 * pos_settings-д хадгална — connect callback-тай ижил зам. Дуудагч эрх шалгасан.
 */
export async function provisionQpayMerchantForOrg(
  orgId: string,
  userId: string,
  options: { rotate?: boolean } = {}
): Promise<ProvisionOutcome> {
  const ctx = await loadOrgProvisionContext(orgId, userId);
  const plan = provisionPlanFromContext(orgId, ctx, options);
  if (!plan.ok) throw new QpayError(QPAY_ERRORS.provisionIncomplete, `Компанийн мэдээлэлд дутуу: ${plan.problems.join("; ")}`);
  const apiUrl = ctx.settings.qpayApiUrl;
  const result = await partnerProvisionMerchant(apiUrl, plan.body);

  const seeded = await ensureQpayPaymentMethod(orgId, userId);
  const patch: Partial<typeof posSettings.$inferInsert> = {
    qpayMerchantId: result.merchantId,
    qpayProvisionedAt: new Date(),
    updatedAt: new Date(),
  };
  if (result.apiKey) patch.qpayApiKeyEnc = encryptSecret(result.apiKey);
  if (result.webhookSecret) patch.qpayWebhookSecretEnc = encryptSecret(result.webhookSecret);
  const merged = { ...ctx.settings, ...patch } as PosSettings;
  const readiness = await loadQpayReadiness(orgId, merged, { seedOnEnable: false });
  if (readiness.ready) patch.qpayEnabled = true;
  await db.update(posSettings).set(patch).where(eq(posSettings.id, ctx.settings.id));

  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: result.created ? "provision_completed" : "provision_synced",
    entityType: "pos_settings",
    entityId: ctx.settings.id,
    // Нууцын утга ҮГҮЙ.
    summary: `QPay мерчант ${result.created ? "бүртгэгдэв" : "sync хийгдэв"} — ${result.merchantId}${
      result.merchantName ? ` (${result.merchantName})` : ""
    }${result.reusedMerchant ? ", QPay-д байсан мерчант" : ""}; ${plan.body.bank_accounts.length} данс; ${
      readiness.ready ? "асаалттай" : `асаагаагүй: ${readiness.problems.join("; ")}`
    }${seeded.length ? `; ${seeded.join("; ")}` : ""}${result.userCreated ? `; dashboard хэрэглэгч ${result.ownerEmail}` : ""}`,
  });

  return {
    merchantId: result.merchantId,
    merchantName: result.merchantName,
    enabled: readiness.ready,
    problems: readiness.problems,
    warnings: readiness.warnings,
    seeded,
    created: result.created,
    reusedMerchant: result.reusedMerchant,
    ownerEmail: result.ownerEmail,
    userCreated: result.userCreated,
    setupLinkSent: result.setupLinkSent,
    credentialsUnchanged: !result.apiKey,
  };
}

/**
 * Компанийн данс өөрчлөгдөхөд dashboard руу sync — ЗӨВХӨН partner-аар
 * бүртгэгдсэн (`qpayProvisionedAt`) байгууллагад. Best effort: алдаа нь
 * компанийн мэдээлэл хадгалахыг унагахгүй — аудитад + буцаах анхааруулга.
 */
export async function syncQpayBankAccountsForOrg(
  orgId: string,
  userId: string,
  accounts: CompanyBankAccount[]
): Promise<{ synced: number } | { warning: string } | null> {
  const settings = await db.query.posSettings.findFirst({
    where: eq(posSettings.organizationId, orgId),
    columns: { id: true, qpayApiUrl: true, qpayMerchantId: true, qpayProvisionedAt: true },
  });
  if (!settings?.qpayProvisionedAt || !settings.qpayMerchantId || !qpayPartnerConfigured()) return null;
  const mapped = mapQpayBankAccounts(accounts);
  if (mapped.problems.length > 0) {
    return { warning: `QPay данс sync хийгдсэнгүй — ${mapped.problems.join("; ")}` };
  }
  if (mapped.accounts.length === 0) return { warning: "QPay данс sync хийгдсэнгүй — данс хоосон (QPay-д дор хаяж нэг данс үлдэнэ)" };
  try {
    const synced = await partnerSyncBankAccounts(settings.qpayApiUrl, settings.qpayMerchantId, mapped.accounts);
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "bank_accounts_synced",
      entityType: "pos_settings",
      entityId: settings.id,
      summary: `QPay мерчантын данс sync — ${synced} данс (${mapped.accounts.map((a) => `${a.bank_name} ${a.account_number}${a.is_default ? " ★" : ""}`).join(", ")})`,
    });
    return { synced };
  } catch (error) {
    const message = error instanceof Error ? error.message : "тодорхойгүй";
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "bank_accounts_sync_failed",
      entityType: "pos_settings",
      entityId: settings.id,
      summary: `QPay мерчантын данс sync амжилтгүй — ${message}`,
    });
    return { warning: `QPay данс sync амжилтгүй — ${message}` };
  }
}

"use server";

// QPay Server Actions — docs/pos/04-qpay-integration-plan.md §3.3, §3.5.
// Intent-ийн амьдрал: createQpayIntent (dashboard нэхэмжлэх + QR) → кассын
// дэлгэц Entry DB-ээс уншина (getQpayIntent) → webhook / checkQpayIntent
// (≤ 1/10 сек — ККТТ cron хориг) → createPosSale({qpayIntentId}) finalize.
// Бүгд ActionResult — алдаа УТГААР (lib/action-result.ts).

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { actionError, type ActionResult } from "@/lib/action-result";
import { encryptSecret } from "@/lib/ai/crypto";
import { requireModuleAction, requireRole } from "@/lib/auth";
import {
  loadOrgProvisionContext,
  partnerDistricts,
  provisionPlanFromContext,
  provisionQpayMerchantForOrg,
  qpayPartnerConfigured,
  type ProvisionOutcome,
} from "@/lib/qpay/partner";
import type { QpayReferenceOption } from "@/lib/qpay/reference";
import { logAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { cashAccounts, organizations, posQpayIntents, posSettings, posShifts, warehouses } from "@/lib/db/schema";
import { createPosSale, type CreatePosSaleInput, type PosReceipt } from "@/lib/actions/pos";
import { POS_MODULE_KEY } from "@/lib/pos/constants";
import { ensurePosSettings } from "@/lib/pos/load-data";
import { todayInUlaanbaatar } from "@/lib/periods/selection";
import {
  cancelDashboardInvoice,
  checkDashboardPayment,
  createDashboardInvoice,
  listDashboardInvoices,
  QpayError,
} from "@/lib/qpay/client";
import { QPAY_ERRORS, type QpayIntentStatus } from "@/lib/qpay/constants";
import { QPAY_CONNECT_CALLBACK_PATH, buildConnectState, connectUrl } from "@/lib/qpay/connect";
import { checkAllowed, clampInvoiceTtl, invoiceAmountOf, isExpired } from "@/lib/qpay/intent";
import type { QpayReadiness } from "@/lib/qpay/readiness";
import {
  expireStaleIntents,
  listPendingIntents,
  loadIntent,
  loadIntentView,
  ensureQpayPaymentMethod,
  loadQpayReadiness,
  markIntentPaid,
  publicAppUrl,
  qpayStatusSummary,
  qpayWebhookUrl,
  resolveQpayConfig,
  setIntentStatus,
  toIntentView,
} from "@/lib/qpay/store";
import type { QpayIntentView, QpayStatusSummary } from "@/lib/qpay/types";

function revalidateQpay() {
  revalidatePath("/inventory/sales");
  revalidatePath("/inventory/pos-settings");
  revalidatePath("/inventory/pos");
  revalidatePath("/inventory");
}

const cleanText = (value: string | null | undefined) => {
  const text = value?.trim();
  return text ? text : null;
};

// ─── Тохиргоо ─────────────────────────────────────────────────────────────────

export async function getQpayStatus(): Promise<
  ActionResult<{ status: QpayStatusSummary; readiness: QpayReadiness }>
> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
    const settings = await ensurePosSettings(orgId, userId);
    const [status, readiness] = await Promise.all([
      qpayStatusSummary(orgId, settings, todayInUlaanbaatar()),
      loadQpayReadiness(orgId, settings),
    ]);
    return { status, readiness };
  } catch (caught) {
    return actionError("getQpayStatus", caught, "QPay төлөв уншигдсангүй");
  }
}

/**
 * Тохиргоо хадгалах — API key / webhook secret ХООСОН бол хөндөхгүй (write-only
 * талбар: UI-д дахин харагдахгүй), шинэ утга бол шифрлэж бичнэ. Асаахад
 * readiness бүрэн байх ёстой (server тал ч хориглоно).
 */
export async function saveQpaySettings(data: {
  enabled?: boolean;
  apiUrl?: string;
  apiKey?: string | null;
  webhookSecret?: string | null;
  invoiceTtlSec?: number;
}): Promise<ActionResult<{ ok: true; seeded: string[] }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "post");
    const current = await ensurePosSettings(orgId, userId);
    const patch: Partial<typeof posSettings.$inferInsert> = {};
    let seeded: string[] = [];
    if (data.apiUrl !== undefined) {
      const url = data.apiUrl.trim().replace(/\/$/, "");
      if (!/^https?:\/\/\S+$/.test(url)) throw new Error("Dashboard URL http(s)://… хэлбэртэй байна");
      patch.qpayApiUrl = url;
    }
    const apiKey = cleanText(data.apiKey);
    if (apiKey) {
      if (!/^qpd_(live|test)_[A-Za-z0-9_-]{16,}$/.test(apiKey)) throw new Error("API key «qpd_live_…» хэлбэртэй байна");
      patch.qpayApiKeyEnc = encryptSecret(apiKey);
      patch.qpayMerchantId = null;
    }
    const secret = cleanText(data.webhookSecret);
    if (secret) {
      if (secret.length < 16) throw new Error("Webhook secret хэт богино");
      patch.qpayWebhookSecretEnc = encryptSecret(secret);
    }
    if (data.invoiceTtlSec !== undefined) patch.qpayInvoiceTtlSec = clampInvoiceTtl(data.invoiceTtlSec);
    if (data.enabled != null) {
      if (data.enabled) {
        const merged = { ...current, ...patch };
        // Хэлбэр + түр данс автоматаар (идемпотент), дараа нь ХАТУУ readiness.
        seeded = await ensureQpayPaymentMethod(orgId, userId);
        const readiness = await loadQpayReadiness(orgId, merged, { seedOnEnable: false });
        if (!readiness.ready) throw new Error(`QPay идэвхжүүлэхээс өмнө: ${readiness.problems.join("; ")}`);
      }
      patch.qpayEnabled = !!data.enabled;
    }
    patch.updatedAt = new Date();
    await db.update(posSettings).set(patch).where(eq(posSettings.id, current.id));
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "update",
      entityType: "pos_settings",
      entityId: current.id,
      // Нууцын УТГА хэзээ ч аудитад орохгүй — зөвхөн талбарын нэр.
      summary: `QPay тохиргоо шинэчлэгдэв — ${Object.keys(patch).filter((key) => key !== "updatedAt").join(", ")}${seeded.length ? `; ${seeded.join("; ")}` : ""}`,
    });
    revalidateQpay();
    return { ok: true, seeded };
  } catch (caught) {
    return actionError("saveQpaySettings", caught, "QPay тохиргоо хадгалагдсангүй");
  }
}

/** Холболт шалгах — `GET /api/v1/invoices?limit=1` (QPay-д хүрэхгүй), мерчант id-г хадгална. */
export async function testQpayConnection(): Promise<
  ActionResult<{ merchantId: string | null; recentInvoices: number; webhookUrl: string | null }>
> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "post");
    const settings = await ensurePosSettings(orgId, userId);
    const config = resolveQpayConfig(settings);
    const result = await listDashboardInvoices(config, 5);
    if (result.merchantId && result.merchantId !== settings.qpayMerchantId)
      await db.update(posSettings).set({ qpayMerchantId: result.merchantId }).where(eq(posSettings.id, settings.id));
    return { merchantId: result.merchantId, recentInvoices: result.invoices.length, webhookUrl: qpayWebhookUrl() };
  } catch (caught) {
    return actionError("testQpayConnection", caught, "QPay dashboard-тай холбогдсонгүй");
  }
}

/**
 * Нэг товчны холболт эхлүүлэх — dashboard-ын consent хуудасны URL буцаана
 * (client `window.location.assign`). Нууц энд ҮГҮЙ: state нь шифрлэсэн
 * (org, user, apiUrl, 15 мин), callback нь `/api/pos/qpay/connect/callback`.
 * Нийтийн URL (NEXT_PUBLIC_APP_URL) байхгүй бол боломжгүй — гар зам үлдэнэ.
 */
export async function startQpayConnect(data: { apiUrl?: string } = {}): Promise<ActionResult<{ url: string }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "post");
    const settings = await ensurePosSettings(orgId, userId);
    const base = publicAppUrl();
    if (!base)
      throw new Error("Нийтийн URL (NEXT_PUBLIC_APP_URL) тохируулаагүй — нэг товчны холболт боломжгүй, key-ээ гараар оруулна");
    const apiUrl = (data.apiUrl?.trim() || settings.qpayApiUrl).replace(/\/$/, "");
    if (!/^https?:\/\/\S+$/.test(apiUrl)) throw new Error("Dashboard URL http(s)://… хэлбэртэй байна");
    if (apiUrl !== settings.qpayApiUrl)
      await db.update(posSettings).set({ qpayApiUrl: apiUrl, updatedAt: new Date() }).where(eq(posSettings.id, settings.id));
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId), columns: { name: true } });
    const state = buildConnectState({ orgId, userId, apiUrl });
    const url = connectUrl(apiUrl, { callback: `${base}${QPAY_CONNECT_CALLBACK_PATH}`, state, org: org?.name ?? "" });
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "connect_started",
      entityType: "pos_settings",
      entityId: settings.id,
      summary: `QPay нэг товчны холболт эхлэв — ${apiUrl}`,
    });
    return { url };
  } catch (caught) {
    return actionError("startQpayConnect", caught, "QPay холболт эхэлсэнгүй");
  }
}

// ─── Intent ───────────────────────────────────────────────────────────────────

export interface CreateQpayIntentInput {
  shiftId: string;
  /** QPay-ээр төлөх дүн (MNT). */
  amount: number;
  /** Бүтэн борлуулалтын оролт (payments, buyer орсон) — дараа finalize хийхэд replay. */
  saleInput: CreatePosSaleInput;
}

/**
 * Агуулахын (салбарын) QPay данс → дансны дугаар. null = агуулахад данс
 * сонгоогүй (мерчантын үндсэн данс). Сонгосон данс «QPay төлбөр хүлээн авах»
 * биш / идэвхгүй / дугааргүй бол ШИДНЭ (fallback хийхгүй).
 */
async function resolveWarehousePayoutAccount(orgId: string, warehouseId: string | null): Promise<string | null> {
  if (!warehouseId) return null;
  const warehouse = await db.query.warehouses.findFirst({
    where: and(eq(warehouses.id, warehouseId), eq(warehouses.organizationId, orgId)),
    columns: { name: true, qpayCashAccountId: true },
  });
  if (!warehouse?.qpayCashAccountId) return null;
  const account = await db.query.cashAccounts.findFirst({
    where: and(eq(cashAccounts.id, warehouse.qpayCashAccountId), eq(cashAccounts.organizationId, orgId)),
    columns: { name: true, accountNumber: true, qpayPayout: true, isActive: true },
  });
  if (!account) throw new Error(`Салбар «${warehouse.name}»-ын QPay данс олдсонгүй — Бараа → Агуулах дээр дахин сонгоно`);
  if (!account.qpayPayout || !account.isActive)
    throw new Error(
      `Салбар «${warehouse.name}»-ын QPay данс «${account.name}» идэвхгүй эсвэл «QPay төлбөр хүлээн авах» тэмдэглэгдээгүй (Касс → Данс)`
    );
  const number = (account.accountNumber ?? "").trim();
  if (!number) throw new Error(`Салбар «${warehouse.name}»-ын QPay данс «${account.name}» дугааргүй (Касс → Данс)`);
  return number;
}

export async function createQpayIntent(input: CreateQpayIntentInput): Promise<ActionResult<{ intent: QpayIntentView }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "write");
    const settings = await ensurePosSettings(orgId, userId);
    if (!settings.qpayEnabled) throw new QpayError(QPAY_ERRORS.disabled, "QPay идэвхгүй байна (Тохиргоо → QPay)");
    const config = resolveQpayConfig(settings);
    const amount = invoiceAmountOf(Number(input.amount));
    if (!amount) throw new Error("QPay дүн 0-ээс их бүхэл ₮ байна");
    const shift = await db.query.posShifts.findFirst({
      where: and(eq(posShifts.id, input.shiftId), eq(posShifts.organizationId, orgId), eq(posShifts.status, "open")),
      columns: { id: true, documentNo: true, warehouseId: true },
    });
    if (!shift) throw new Error("Нээлттэй ээлж олдсонгүй");
    if (!Array.isArray(input.saleInput?.lines) || input.saleInput.lines.length === 0) throw new Error("Сагс хоосон байна");
    // Салбар = агуулах: ээлжийн агуулахад QPay данс сонгосон бол ТЭР данс руу
    // (dashboard `payout_account_number`); сонгоогүй бол мерчантын үндсэн данс.
    // Сонгосон данс нь тэмдэглэгдээгүй/идэвхгүй бол ЗОГСООНО — өөр данс руу
    // чимээгүй шилжихгүй (мөнгө буруу салбарт орохоос).
    const payoutAccountNumber = await resolveWarehousePayoutAccount(orgId, shift.warehouseId);

    const ttl = clampInvoiceTtl(settings.qpayInvoiceTtlSec);
    const now = new Date();
    // Мөрийг ЭХЛЭЭД үүсгэнэ — id нь callback_url-д (`?intent=`) болон sender_invoice_no-д явна.
    const [row] = await db
      .insert(posQpayIntents)
      .values({
        organizationId: orgId,
        shiftId: shift.id,
        cashierUserId: userId,
        amount: String(amount),
        cartSnapshot: { ...input.saleInput, qpayIntentId: null } as Record<string, unknown>,
        status: "open",
        expiresAt: new Date(now.getTime() + ttl * 1000),
      })
      .returning();
    try {
      const invoice = await createDashboardInvoice(config, {
        senderInvoiceNo: row.id,
        amount,
        description: `${shift.documentNo} POS төлбөр`,
        callbackUrl: qpayWebhookUrl(row.id),
        payoutAccountNumber,
      });
      const [updated] = await db
        .update(posQpayIntents)
        .set({
          qpayInvoiceId: invoice.invoiceId,
          qrText: invoice.qrText || null,
          qrImage: invoice.qrImage,
          urls: invoice.urls,
          updatedAt: new Date(),
        })
        .where(eq(posQpayIntents.id, row.id))
        .returning();
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: "create",
        entityType: "pos_qpay_intent",
        entityId: row.id,
        summary: `QPay нэхэмжлэх ${invoice.invoiceId} — ${amount.toLocaleString("en-US")}₮, ээлж ${shift.documentNo}`,
      });
      return { intent: toIntentView(updated ?? row) };
    } catch (error) {
      await db
        .update(posQpayIntents)
        .set({ status: "failed", lastError: error instanceof Error ? error.message : "dashboard", updatedAt: new Date() })
        .where(eq(posQpayIntents.id, row.id));
      throw error;
    }
  } catch (caught) {
    return actionError("createQpayIntent", caught, "QPay нэхэмжлэх үүссэнгүй");
  }
}

/** Кассын дэлгэцийн polling — ЗӨВХӨН Entry DB (QPay-д хүрэхгүй); хугацаа дууссан бол expired. */
export async function getQpayIntent(intentId: string): Promise<ActionResult<{ intent: QpayIntentView }>> {
  try {
    const { orgId } = await requireModuleAction(POS_MODULE_KEY, "read");
    const row = await loadIntent(orgId, intentId);
    if (!row) throw new Error("QPay intent олдсонгүй");
    if (isExpired({ status: row.status as QpayIntentStatus, expiresAt: row.expiresAt }, new Date())) {
      await expireStaleIntents(orgId);
    }
    const view = await loadIntentView(orgId, intentId);
    if (!view) throw new Error("QPay intent олдсонгүй");
    return { intent: view };
  } catch (caught) {
    return actionError("getQpayIntent", caught, "QPay төлөв уншигдсангүй");
  }
}

/**
 * Гар [Шалгах] — dashboard `payments/check` (QPay-ийн payment/check). ≤ 1 удаа /
 * 10 сек intent тус бүрд; хэтэрвэл [QPAY_CHECK_THROTTLED] (UI товчоо идэвхгүй болгоно).
 */
export async function checkQpayIntent(intentId: string): Promise<ActionResult<{ intent: QpayIntentView }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
    const settings = await ensurePosSettings(orgId, userId);
    const row = await loadIntent(orgId, intentId);
    if (!row) throw new Error("QPay intent олдсонгүй");
    if (row.status === "open" && row.qpayInvoiceId) {
      const now = new Date();
      if (!checkAllowed(row.lastCheckAt, now))
        throw new Error(`[${QPAY_ERRORS.checkThrottled}] 10 секунд тутамд нэг удаа шалгана`);
      await db.update(posQpayIntents).set({ lastCheckAt: now }).where(eq(posQpayIntents.id, row.id));
      const config = resolveQpayConfig(settings);
      const check = await checkDashboardPayment(config, row.qpayInvoiceId);
      if (check.paid) {
        const result = await markIntentPaid(orgId, row.id, {
          paidAmount: check.paidAmount,
          paymentId: null,
          paidAt: now,
          source: "check",
        });
        if (result.changed && result.status === "paid")
          await logAuditEvent({
            userId,
            organizationId: orgId,
            action: "paid",
            entityType: "pos_qpay_intent",
            entityId: row.id,
            summary: `QPay төлөгдлөө (гар шалгалт) — ${row.qpayInvoiceId}, ${Number(row.amount).toLocaleString("en-US")}₮`,
          });
      } else if (isExpired({ status: "open", expiresAt: row.expiresAt }, now)) {
        await expireStaleIntents(orgId);
      }
    }
    const view = await loadIntentView(orgId, intentId);
    if (!view) throw new Error("QPay intent олдсонгүй");
    return { intent: view };
  } catch (caught) {
    return actionError("checkQpayIntent", caught, "QPay төлбөр шалгагдсангүй");
  }
}

/** Кассчин диалог хаах / [Цуцлах] — зөвхөн `open`; QPay-д DELETE (унавал ч Entry-д cancelled). */
export async function cancelQpayIntent(intentId: string): Promise<ActionResult<{ intent: QpayIntentView }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "write");
    const settings = await ensurePosSettings(orgId, userId);
    const row = await loadIntent(orgId, intentId);
    if (!row) throw new Error("QPay intent олдсонгүй");
    if (row.status === "open") {
      let lastError: string | null = null;
      if (row.qpayInvoiceId) {
        try {
          await cancelDashboardInvoice(resolveQpayConfig(settings), row.qpayInvoiceId);
        } catch (error) {
          lastError = error instanceof Error ? error.message : "cancel";
        }
      }
      await setIntentStatus(orgId, intentId, "cancelled", { lastError });
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: "cancel",
        entityType: "pos_qpay_intent",
        entityId: row.id,
        summary: `QPay нэхэмжлэх цуцлагдав — ${row.qpayInvoiceId ?? "(id-гүй)"}${lastError ? " (QPay талд цуцлагдсангүй)" : ""}`,
      });
    }
    const view = await loadIntentView(orgId, intentId);
    if (!view) throw new Error("QPay intent олдсонгүй");
    revalidateQpay();
    return { intent: view };
  } catch (caught) {
    return actionError("cancelQpayIntent", caught, "QPay нэхэмжлэх цуцлагдсангүй");
  }
}

/** Жагсаалтын «QPay хүлээгдэж буй» — open / paid-бүртгэгдээгүй / failed. */
export async function listPendingQpayIntents(): Promise<ActionResult<{ intents: QpayIntentView[] }>> {
  try {
    const { orgId } = await requireModuleAction(POS_MODULE_KEY, "read");
    return { intents: await listPendingIntents(orgId) };
  } catch (caught) {
    return actionError("listPendingQpayIntents", caught, "QPay жагсаалт уншигдсангүй");
  }
}

/**
 * Төлөгдсөн ч бүртгэгдээгүй intent → сагсны snapshot-оор борлуулалт (D3: автомат
 * биш, хүн нэг товчоор). `createPosSale` intent-ийг finalize хийнэ.
 */
export async function finalizeQpayIntent(
  intentId: string
): Promise<ActionResult<{ id: string; documentNo: string; receipt: PosReceipt }>> {
  try {
    const { orgId } = await requireModuleAction(POS_MODULE_KEY, "write");
    const row = await loadIntent(orgId, intentId);
    if (!row) throw new Error("QPay intent олдсонгүй");
    if (row.status !== "paid" || row.saleId)
      throw new Error(`[${QPAY_ERRORS.intentNotPaid}] Зөвхөн төлөгдсөн, бүртгэгдээгүй QPay төлбөрийг борлуулалт болгоно`);
    const snapshot = row.cartSnapshot as unknown as CreatePosSaleInput;
    const result = await createPosSale({ ...snapshot, qpayIntentId: row.id });
    if (result.error || !result.receipt) throw new Error(result.error ?? "Борлуулалт бүртгэгдсэнгүй");
    revalidateQpay();
    return { id: result.id!, documentNo: result.documentNo!, receipt: result.receipt };
  } catch (caught) {
    return actionError("finalizeQpayIntent", caught, "QPay төлбөр борлуулалт болсонгүй");
  }
}

// ─── Partner API — автомат мерчант бүртгэл (docs/deployment/qpay.md §2b) ──────

/**
 * [QPay-д бүртгүүлэх] товчны өмнөх урьдчилсан шалгалт — компанийн мэдээлэлд
 * юу дутууг НЭРЛЭНЭ (dashboard руу хандахгүй). Partner key байхгүй бол
 * `available: false` — UI consent замаа л харуулна.
 */
export async function getQpayProvisionPreview(): Promise<
  ActionResult<{ available: boolean; problems: string[]; type: "company" | "person" | null; ownerEmail: string; provisionedAt: string | null }>
> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "read");
    if (!qpayPartnerConfigured()) return { available: false, problems: [], type: null, ownerEmail: "", provisionedAt: null };
    const ctx = await loadOrgProvisionContext(orgId, userId);
    const plan = provisionPlanFromContext(orgId, ctx);
    return {
      available: true,
      problems: plan.ok ? [] : plan.problems,
      type: plan.ok ? plan.type : null,
      ownerEmail: ctx.owner.email,
      provisionedAt: ctx.settings.qpayProvisionedAt?.toISOString() ?? null,
    };
  } catch (caught) {
    return actionError("getQpayProvisionPreview", caught, "QPay бүртгэлийн шалгалт уншигдсангүй");
  }
}

/**
 * Байгууллагыг QPay мерчант болгоно (Entry сервер → dashboard Partner API):
 * компанийн мэдээлэл + данс → мерчант + dashboard хэрэглэгч (эзний и-мэйл) →
 * api key + webhook secret шифртэй → хэлбэр/данс seed → readiness → асна.
 * Компанийн мэдээлэл = тохиргоо тул admin+ ба pos:post. Дахин дуудахад
 * (`rotate`) dashboard key-ээ солино — хуучин интеграци хүчингүй.
 */
export async function provisionQpayMerchant(
  data: { rotate?: boolean } = {}
): Promise<ActionResult<{ outcome: ProvisionOutcome }>> {
  try {
    const { orgId, userId } = await requireModuleAction(POS_MODULE_KEY, "post");
    await requireRole("admin");
    const outcome = await provisionQpayMerchantForOrg(orgId, userId, { rotate: data.rotate });
    revalidateQpay();
    revalidatePath("/settings/company");
    return { outcome };
  } catch (caught) {
    return actionError("provisionQpayMerchant", caught, "QPay мерчантын бүртгэл амжилтгүй");
  }
}

/** Аймгийн сумдын QPay код — компанийн мэдээллийн сонгогчид (УБ-ын дүүрэг статик). */
export async function getQpayDistricts(data: { cityCode: string }): Promise<ActionResult<{ districts: QpayReferenceOption[] }>> {
  try {
    const { orgId, userId } = await requireRole("admin");
    if (!qpayPartnerConfigured()) return { districts: [] };
    const settings = await ensurePosSettings(orgId, userId);
    return { districts: await partnerDistricts(settings.qpayApiUrl, data.cityCode.trim()) };
  } catch (caught) {
    return actionError("getQpayDistricts", caught, "Дүүрэг/сумын жагсаалт уншигдсангүй");
  }
}

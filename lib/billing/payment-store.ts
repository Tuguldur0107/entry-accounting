// Багцын QPay төлбөрийн DB давхарга (энгийн модуль, "use server" БИШ) — action
// (lib/actions/billing-payment.ts) ба webhook route хоёулаа эндээс.
// Цэвэр дүрэм lib/billing/self-pay.ts. docs/billing/00-proposal.md §6a.
//
// Мөнгө Entry-ийн ӨӨРИЙН QPay мерчант руу орно (ENTRY_BILLING_QPAY_* env) —
// харилцагчийн POS-ийн QPay тохиргоо (pos_settings.qpay*) энд ХЭРЭГЛЭГДЭХГҮЙ.
// Төлөгдмөгц subscription НЭГ транзакцаар сунгагдана; webhook ба гар шалгалт
// хоёулаа markBillingPaymentPaid-аар (идемпотент).

import { and, desc, eq } from "drizzle-orm";

import { logAuditEvent } from "@/lib/audit";
import { getEntitlements, countSeatsUsed } from "@/lib/billing/load";
import { trialEndFor } from "@/lib/billing/entitlements";
import { PLAN_LABELS, isPlanId, type PlanId } from "@/lib/billing/plans";
import { loadPlanPricesAt } from "@/lib/billing/pricing-store";
import {
  applyPaidSubscription,
  BILLING_PAYMENT_STATUS_LABELS,
  BILLING_PAYMENT_TTL_MINUTES,
  isSelfPayPlan,
  planBillingPayment,
  selfPayOptions,
  type BillingPaymentStatus,
  type BillingPaymentView,
  type SelfPayOptions,
  type SelfPaySubscription,
} from "@/lib/billing/self-pay";
import { db } from "@/lib/db";
import { billingPayments, organizationSubscriptions, organizations } from "@/lib/db/schema";
import { deploymentMode } from "@/lib/deployment-mode";
import {
  cancelDashboardInvoice,
  checkDashboardPayment,
  createDashboardInvoice,
  type QpayClientConfig,
} from "@/lib/qpay/client";
import { QPAY_DEFAULT_API_URL } from "@/lib/qpay/constants";
import { amountMatches, checkAllowed } from "@/lib/qpay/intent";

export type { BillingPaymentView } from "@/lib/billing/self-pay";

/** Entry-ийн webhook хүлээн авагчийн зам (NEXT_PUBLIC_APP_URL + энэ). */
export const BILLING_WEBHOOK_PATH = "/api/billing/qpay/webhook";

export type BillingQpayConfig = QpayClientConfig & { webhookSecret: string; appUrl: string };

/**
 * Entry-ийн QPay мерчантын тохиргоо (env) — дутуу бол null ба шалтгаан.
 * Нууцыг хэзээ ч буцаахгүй/логлохгүй.
 */
export function billingQpayConfig(): { config: BillingQpayConfig | null; missing: string[] } {
  const apiKey = process.env.ENTRY_BILLING_QPAY_API_KEY?.trim() ?? "";
  const webhookSecret = process.env.ENTRY_BILLING_QPAY_WEBHOOK_SECRET?.trim() ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ?? "";
  const apiUrl = process.env.ENTRY_BILLING_QPAY_API_URL?.trim() || QPAY_DEFAULT_API_URL;
  const missing: string[] = [];
  if (!apiKey) missing.push("ENTRY_BILLING_QPAY_API_KEY");
  if (!webhookSecret) missing.push("ENTRY_BILLING_QPAY_WEBHOOK_SECRET");
  if (!appUrl) missing.push("NEXT_PUBLIC_APP_URL");
  if (deploymentMode() !== "saas") missing.push("ENTRY_DEPLOYMENT_MODE=saas");
  return { config: missing.length ? null : { apiUrl, apiKey, webhookSecret, appUrl }, missing };
}

type PaymentRow = typeof billingPayments.$inferSelect;

function toView(row: PaymentRow): BillingPaymentView {
  return {
    id: row.id,
    status: row.status as BillingPaymentStatus,
    planId: row.planId,
    planLabel: isPlanId(row.planId) ? PLAN_LABELS[row.planId] : row.planId,
    seats: row.seats,
    months: row.months,
    pricePerSeatMnt: row.pricePerSeatMnt,
    amount: row.amount,
    qpayInvoiceId: row.qpayInvoiceId,
    // QR зөвхөн төлбөр хүлээж байхад хэрэгтэй — бусад төлөвт буцаахгүй.
    qrText: row.status === "open" ? row.qrText : null,
    qrImage: row.status === "open" ? row.qrImage : null,
    urls: row.status === "open" && Array.isArray(row.urls) ? (row.urls as BillingPaymentView["urls"]) : [],
    expiresAt: row.expiresAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Мөргүй (trial) байгууллагад ч нэг хэлбэрийн subscription — self-pay-ийн оролт. */
async function loadSelfPaySubscription(orgId: string, executor: typeof db = db): Promise<{
  subscription: SelfPaySubscription;
  hasRow: boolean;
}> {
  const [row, org] = await Promise.all([
    executor.query.organizationSubscriptions.findFirst({
      where: eq(organizationSubscriptions.organizationId, orgId),
    }),
    executor.query.organizations.findFirst({ where: eq(organizations.id, orgId), columns: { createdAt: true } }),
  ]);
  if (row)
    return {
      hasRow: true,
      subscription: {
        planId: row.planId,
        status: row.status,
        seats: row.seats,
        currentPeriodEnd: row.currentPeriodEnd,
        trialEndsAt: row.trialEndsAt,
        pricePerSeatMnt: row.pricePerSeatMnt,
      },
    };
  return {
    hasRow: false,
    subscription: {
      planId: "trial",
      status: "trialing",
      seats: null,
      currentPeriodEnd: null,
      trialEndsAt: trialEndFor(org?.createdAt ?? new Date()),
      pricePerSeatMnt: null,
    },
  };
}

/** Энэ байгууллага одоо юуг төлж болох вэ (UI + action хоёулаа). */
export async function loadSelfPayOptions(orgId: string, now = new Date()): Promise<SelfPayOptions> {
  const [ent, { subscription }, seatsUsed, prices] = await Promise.all([
    getEntitlements(orgId, now),
    loadSelfPaySubscription(orgId),
    countSeatsUsed(orgId),
    loadPlanPricesAt(),
  ]);
  return selfPayOptions({ ent, subscription, seatsUsed, prices, now });
}

/** Сүүлийн төлбөрүүд — хугацаа нь дууссан `open`-ыг замдаа expired болгоно. */
export async function listBillingPayments(orgId: string, limit = 10): Promise<BillingPaymentView[]> {
  await expireStaleBillingPayments(orgId);
  const rows = await db
    .select()
    .from(billingPayments)
    .where(eq(billingPayments.organizationId, orgId))
    .orderBy(desc(billingPayments.createdAt))
    .limit(limit);
  return rows.map(toView);
}

async function expireStaleBillingPayments(orgId: string, now = new Date()): Promise<void> {
  const rows = await db
    .select({ id: billingPayments.id, expiresAt: billingPayments.expiresAt })
    .from(billingPayments)
    .where(and(eq(billingPayments.organizationId, orgId), eq(billingPayments.status, "open")));
  const stale = rows.filter((row) => row.expiresAt.getTime() <= now.getTime());
  for (const row of stale)
    await db
      .update(billingPayments)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(billingPayments.id, row.id), eq(billingPayments.status, "open")));
}

async function loadPayment(orgId: string, paymentId: string): Promise<PaymentRow> {
  const row = await db.query.billingPayments.findFirst({
    where: and(eq(billingPayments.id, paymentId), eq(billingPayments.organizationId, orgId)),
  });
  if (!row) throw new Error("Төлбөр олдсонгүй");
  return row;
}

export async function getBillingPayment(orgId: string, paymentId: string): Promise<BillingPaymentView> {
  const row = await loadPayment(orgId, paymentId);
  if (row.status === "open" && row.expiresAt.getTime() <= Date.now()) {
    await expireStaleBillingPayments(orgId);
    return toView(await loadPayment(orgId, paymentId));
  }
  return toView(row);
}

/**
 * Төлбөр үүсгэх: сонголтыг шалгаж (selfPayOptions + planBillingPayment) мөр
 * бичээд Entry-ийн QPay-д нэхэмжлэх үүсгэнэ. QPay унавал мөр `failed` +
 * шалтгаантай үлдэж, алдаа ШИДЭГДЭНЭ (action { error } болгоно).
 */
export async function createBillingPayment(
  orgId: string,
  userId: string,
  input: { planId: unknown; seats: unknown; months: unknown },
  now = new Date()
): Promise<BillingPaymentView> {
  const { config, missing } = billingQpayConfig();
  if (!config) {
    console.warn("[billing-qpay] тохируулаагүй:", missing.join(", "));
    throw new Error("Онлайн төлбөр одоогоор тохируулагдаагүй байна — support@entry.mn-тэй холбогдоно уу.");
  }
  const options = await loadSelfPayOptions(orgId, now);
  const plan = planBillingPayment(options, input);

  // Нэг байгууллагад нэг л нээлттэй төлбөр — хуучныг цуцална (давхар төлөхөөс).
  await expireStaleBillingPayments(orgId, now);
  const openRows = await db
    .select({ id: billingPayments.id, qpayInvoiceId: billingPayments.qpayInvoiceId })
    .from(billingPayments)
    .where(and(eq(billingPayments.organizationId, orgId), eq(billingPayments.status, "open")));
  for (const row of openRows) await cancelOpen(config, row.id, row.qpayInvoiceId, now);

  const [row] = await db
    .insert(billingPayments)
    .values({
      organizationId: orgId,
      userId,
      planId: plan.planId,
      seats: plan.seats,
      months: plan.months,
      pricePerSeatMnt: plan.pricePerSeatMnt,
      amount: plan.amount,
      status: "open",
      expiresAt: new Date(now.getTime() + BILLING_PAYMENT_TTL_MINUTES * 60_000),
    })
    .returning();

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId), columns: { name: true } });
  try {
    const invoice = await createDashboardInvoice(config, {
      senderInvoiceNo: `ENTRY-${row.id.slice(0, 8).toUpperCase()}`,
      amount: plan.amount,
      description: `Entry ${PLAN_LABELS[plan.planId]} — ${plan.seats} суудал × ${plan.months} сар (${org?.name ?? orgId})`.slice(0, 250),
      callbackUrl: `${config.appUrl}${BILLING_WEBHOOK_PATH}?payment=${row.id}`,
    });
    const [updated] = await db
      .update(billingPayments)
      .set({
        qpayInvoiceId: invoice.invoiceId,
        qrText: invoice.qrText || null,
        qrImage: invoice.qrImage,
        urls: invoice.urls,
        updatedAt: new Date(),
      })
      .where(eq(billingPayments.id, row.id))
      .returning();
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "payment_created",
      entityType: "subscription",
      entityId: row.id,
      summary: `QPay нэхэмжлэх — ${PLAN_LABELS[plan.planId]}, ${plan.seats} суудал × ${plan.months} сар, ${plan.amount.toLocaleString("en-US")}₮`,
    });
    return toView(updated);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "QPay нэхэмжлэх үүссэнгүй";
    await db
      .update(billingPayments)
      .set({ status: "failed", lastError: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(billingPayments.id, row.id));
    throw new Error(`QPay нэхэмжлэх үүссэнгүй: ${message}`);
  }
}

async function cancelOpen(config: QpayClientConfig, id: string, invoiceId: string | null, now: Date) {
  if (invoiceId) {
    try {
      await cancelDashboardInvoice(config, invoiceId);
    } catch (caught) {
      // QPay талд цуцлагдаагүй ч төлөгдвөл webhook paid болгоно (мөнгө алдагдахгүй).
      console.warn("[billing-qpay] нэхэмжлэх цуцлагдсангүй:", invoiceId, caught instanceof Error ? caught.message : caught);
    }
  }
  await db
    .update(billingPayments)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(billingPayments.id, id), eq(billingPayments.status, "open")));
}

export async function cancelBillingPayment(orgId: string, paymentId: string): Promise<BillingPaymentView> {
  const row = await loadPayment(orgId, paymentId);
  if (row.status !== "open") return toView(row);
  const { config } = billingQpayConfig();
  if (config) await cancelOpen(config, row.id, row.qpayInvoiceId, new Date());
  else
    await db
      .update(billingPayments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(billingPayments.id, row.id), eq(billingPayments.status, "open")));
  return toView(await loadPayment(orgId, paymentId));
}

/**
 * [Шалгах] — QPay-руу гар шалгалт (10 сек-д нэг; ККТТ тогтмол polling хориглодог).
 * Төлөгдсөн бол markBillingPaymentPaid.
 */
export async function checkBillingPayment(orgId: string, paymentId: string): Promise<BillingPaymentView> {
  const row = await loadPayment(orgId, paymentId);
  if (row.status === "paid" || !row.qpayInvoiceId) return toView(row);
  const now = new Date();
  if (!checkAllowed(row.lastCheckAt, now)) throw new Error("Хэдэн секундын дараа дахин шалгана уу");
  const { config } = billingQpayConfig();
  if (!config) throw new Error("Онлайн төлбөр одоогоор тохируулагдаагүй байна");
  await db.update(billingPayments).set({ lastCheckAt: now }).where(eq(billingPayments.id, row.id));
  const check = await checkDashboardPayment(config, row.qpayInvoiceId);
  if (check.paid)
    await markBillingPaymentPaid(row.id, {
      paidAmount: check.paidAmount ?? row.amount,
      paymentId: null,
      paidAt: now,
      source: "check",
    });
  return toView(await loadPayment(orgId, paymentId));
}

export type MarkPaidResult = { status: BillingPaymentStatus; changed: boolean; reason?: string };

/**
 * Төлбөр төлөгдсөн (webhook / гар шалгалт) — ИДЕМПОТЕНТ, НЭГ транзакц:
 * мөрийг түгжээд дүнг тулгаж subscription-ийг сунгана. `expired`/`cancelled`
 * мөрөнд ч мөнгө бодитоор орсон тул paid болгоно (хэзээ ч чимээгүй алдахгүй);
 * зөвхөн дүн зөрвөл `failed` + шалтгаан (Console-оос гараар шийднэ).
 */
export async function markBillingPaymentPaid(
  paymentId: string,
  input: { paidAmount: number | null; paymentId: string | null; paidAt: Date | null; source: "webhook" | "check" }
): Promise<MarkPaidResult> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(billingPayments)
      .where(eq(billingPayments.id, paymentId))
      .for("update");
    if (!row) throw new Error("Төлбөр олдсонгүй");
    if (row.status === "paid" || row.status === "failed")
      return { status: row.status as BillingPaymentStatus, changed: false };
    const now = new Date();

    if (!amountMatches(row.amount, input.paidAmount)) {
      const reason = `Төлсөн дүн (${input.paidAmount ?? "—"}₮) нэхэмжлэхийн дүнтэй (${row.amount}₮) таарсангүй`;
      await tx
        .update(billingPayments)
        .set({ status: "failed", lastError: reason, paidAmount: input.paidAmount === null ? null : Math.round(input.paidAmount), updatedAt: now })
        .where(eq(billingPayments.id, row.id));
      await logAuditEvent(
        {
          userId: row.userId ?? "",
          organizationId: row.organizationId,
          action: "payment_amount_mismatch",
          entityType: "subscription",
          entityId: row.id,
          summary: `QPay төлбөр: ${reason} (${input.source})`,
        },
        tx
      );
      return { status: "failed", changed: true, reason };
    }

    if (!isSelfPayPlan(row.planId)) throw new Error(`Танигдаагүй багц: ${row.planId}`);
    // Subscription мөрийг түгжинэ — зэрэг ирсэн хоёр төлбөр хугацааг зөв хураана.
    await tx
      .select({ id: organizationSubscriptions.id })
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, row.organizationId))
      .for("update");
    const { subscription, hasRow } = await loadSelfPaySubscription(row.organizationId, tx as unknown as typeof db);
    const currentPlanId: PlanId = isPlanId(subscription.planId) ? subscription.planId : "standard";
    const next = applyPaidSubscription({
      subscription,
      currentPlanId,
      payment: { planId: row.planId, seats: row.seats, months: row.months },
      now,
    });
    const note = `QPay-ээр төлсөн — ${next.currentPeriodEnd.toISOString().slice(0, 10)} хүртэл`;
    if (hasRow)
      await tx
        .update(organizationSubscriptions)
        .set({
          planId: next.planId,
          status: next.status,
          seats: next.seats,
          currentPeriodEnd: next.currentPeriodEnd,
          note,
          updatedBy: row.userId,
          updatedAt: now,
        })
        .where(eq(organizationSubscriptions.organizationId, row.organizationId));
    else
      await tx.insert(organizationSubscriptions).values({
        organizationId: row.organizationId,
        planId: next.planId,
        status: next.status,
        seats: next.seats,
        currentPeriodEnd: next.currentPeriodEnd,
        note,
        updatedBy: row.userId,
      });

    await tx
      .update(billingPayments)
      .set({
        status: "paid",
        paidAmount: Math.round(input.paidAmount ?? row.amount),
        paymentId: input.paymentId,
        paidAt: input.paidAt ?? now,
        periodStart: next.periodStart,
        periodEnd: next.currentPeriodEnd,
        lastError:
          row.status === "open"
            ? null
            : `Нэхэмжлэх «${BILLING_PAYMENT_STATUS_LABELS[row.status as BillingPaymentStatus]}» төлөвтэй байхад төлөгдсөн — хүлээн авав`,
        updatedAt: now,
      })
      .where(eq(billingPayments.id, row.id));
    await logAuditEvent(
      {
        userId: row.userId ?? "",
        organizationId: row.organizationId,
        action: "paid",
        entityType: "subscription",
        entityId: row.id,
        summary: `QPay төлбөр төлөгдлөө (${input.source}) — ${PLAN_LABELS[next.planId]}, ${next.seats} суудал × ${row.months} сар, ${row.amount.toLocaleString("en-US")}₮ → ${next.currentPeriodEnd.toISOString().slice(0, 10)} хүртэл`,
      },
      tx
    );
    return { status: "paid", changed: true };
  });
}

/** Webhook-д — төлбөрийн мөр (org шалгалтгүй: org нь мөрөөс, эрх нь гарын үсгээс). */
export async function findBillingPayment(paymentId: string): Promise<PaymentRow | null> {
  return (await db.query.billingPayments.findFirst({ where: eq(billingPayments.id, paymentId) })) ?? null;
}

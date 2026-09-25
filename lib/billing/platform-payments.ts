// Багцын QPay төлбөр — Entry Console-д (ЗӨВХӨН унших). Дуудагч нь
// app/api/platform/billing-payments route (platformGate-ийн ард).
// QR, deeplink, webhook-ийн нууц ХЭЗЭЭ Ч буцаахгүй — дүн, төлөв, хугацаа л.

import { and, desc, eq, type SQL } from "drizzle-orm";

import { BILLING_PAYMENT_STATUSES, type BillingPaymentStatus } from "@/lib/billing/self-pay";
import { db } from "@/lib/db";
import { billingPayments, organizations, users } from "@/lib/db/schema";

export type PlatformBillingPaymentRow = {
  id: string;
  organizationId: string;
  orgName: string;
  payerEmail: string | null;
  planId: string;
  seats: number;
  months: number;
  pricePerSeatMnt: number;
  amount: number;
  status: BillingPaymentStatus;
  qpayInvoiceId: string | null;
  paymentId: string | null;
  paidAmount: number | null;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  lastError: string | null;
  createdAt: string;
};

export const PLATFORM_PAYMENTS_DEFAULT_LIMIT = 200;
export const PLATFORM_PAYMENTS_MAX_LIMIT = 1000;

export async function listPlatformBillingPayments(filter: {
  organizationId?: string | null;
  status?: string | null;
  limit?: number | null;
}): Promise<PlatformBillingPaymentRow[]> {
  const conditions: SQL[] = [];
  if (filter.organizationId) {
    if (!/^[0-9a-f-]{36}$/i.test(filter.organizationId)) throw new Error("organizationId буруу");
    conditions.push(eq(billingPayments.organizationId, filter.organizationId));
  }
  if (filter.status) {
    if (!(BILLING_PAYMENT_STATUSES as readonly string[]).includes(filter.status))
      throw new Error(`status танигдсангүй: ${filter.status}`);
    conditions.push(eq(billingPayments.status, filter.status));
  }
  const limit = Math.min(
    PLATFORM_PAYMENTS_MAX_LIMIT,
    Math.max(1, Math.round(Number(filter.limit) || PLATFORM_PAYMENTS_DEFAULT_LIMIT))
  );
  const rows = await db
    .select({
      id: billingPayments.id,
      organizationId: billingPayments.organizationId,
      orgName: organizations.name,
      payerEmail: users.email,
      planId: billingPayments.planId,
      seats: billingPayments.seats,
      months: billingPayments.months,
      pricePerSeatMnt: billingPayments.pricePerSeatMnt,
      amount: billingPayments.amount,
      status: billingPayments.status,
      qpayInvoiceId: billingPayments.qpayInvoiceId,
      paymentId: billingPayments.paymentId,
      paidAmount: billingPayments.paidAmount,
      paidAt: billingPayments.paidAt,
      periodStart: billingPayments.periodStart,
      periodEnd: billingPayments.periodEnd,
      lastError: billingPayments.lastError,
      createdAt: billingPayments.createdAt,
    })
    .from(billingPayments)
    .innerJoin(organizations, eq(organizations.id, billingPayments.organizationId))
    .leftJoin(users, eq(users.id, billingPayments.userId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(billingPayments.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    status: row.status as BillingPaymentStatus,
    payerEmail: row.payerEmail ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    periodStart: row.periodStart?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

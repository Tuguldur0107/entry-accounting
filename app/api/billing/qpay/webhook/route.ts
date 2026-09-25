// Entry-ийн ӨӨРИЙН QPay мерчант → багцын төлбөрийн webhook (docs/billing/00-proposal.md §6a).
// URL нь нэхэмжлэх үүсгэхэд `callback_url=…/api/billing/qpay/webhook?payment=<id>`
// хэлбэрээр өгөгддөг. Гарын үсэг = hex HMAC-SHA256(rawBody,
// ENTRY_BILLING_QPAY_WEBHOOK_SECRET) — ТҮҮХИЙ body дээр (POS-ийн webhook-тэй ижил
// гэрээ, өөр нууц). Нэвтрэлтгүй: org нь төлбөрийн мөрөөс, эрх нь гарын үсгээс.
// 4xx → dashboard дахин оролдохгүй; 5xx → дахин оролдоно. Идемпотент.

import { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/audit";
import { billingQpayConfig, findBillingPayment, markBillingPaymentPaid } from "@/lib/billing/payment-store";
import { parseWebhookPayload } from "@/lib/qpay/intent";
import { verifyWebhookSignature } from "@/lib/qpay/webhook-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const paymentId = new URL(request.url).searchParams.get("payment")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return NextResponse.json({ error: "payment required" }, { status: 400 });
  const rawBody = await request.text();

  try {
    const { config } = billingQpayConfig();
    if (!config) return NextResponse.json({ error: "billing qpay not configured" }, { status: 403 });
    const payment = await findBillingPayment(paymentId);
    if (!payment) return NextResponse.json({ error: "unknown payment" }, { status: 404 });

    if (!verifyWebhookSignature(rawBody, request.headers.get("x-webhook-signature"), config.webhookSecret)) {
      await logAuditEvent({
        userId: payment.userId ?? "",
        organizationId: payment.organizationId,
        action: "webhook_rejected",
        entityType: "subscription",
        entityId: payment.id,
        summary: "Багцын QPay webhook гарын үсэг таарсангүй",
      });
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }

    let body: unknown = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      body = null;
    }
    const payload = parseWebhookPayload(body);
    if (!payload) return NextResponse.json({ error: "unsupported payload" }, { status: 422 });
    if (payment.qpayInvoiceId && payload.invoiceId !== payment.qpayInvoiceId)
      return NextResponse.json({ error: "invoice mismatch" }, { status: 409 });

    const result = await markBillingPaymentPaid(payment.id, {
      paidAmount: Number.isFinite(payload.amount) ? payload.amount : null,
      paymentId: payload.paymentId,
      paidAt: validDate(payload.paidAt),
      source: "webhook",
    });
    // Дүн зөрсөн нь dashboard-ын алдаа биш — 200 (дахин илгээх нь юу ч засахгүй).
    return NextResponse.json({ ok: true, status: result.status, changed: result.changed });
  } catch (error) {
    console.error("[billing qpay webhook]", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

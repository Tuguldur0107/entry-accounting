// QPay dashboard → Entry webhook (docs/pos/04-qpay-integration-plan.md §3.3, §3.5).
// URL нь нэхэмжлэх үүсгэхэд `callback_url=…/api/pos/qpay/webhook?intent=<id>`
// хэлбэрээр өгөгддөг. Гарын үсэг = hex HMAC-SHA256(rawBody, мерчантын webhook
// secret) — ТҮҮХИЙ body дээр; дүнг intent-тэй тулгана. Webhook = дохио
// (dashboard `verifyAndMarkPaid` QPay-ээс баталгаажуулсан), идемпотент.
// 4xx → dashboard дахин оролдохгүй; 5xx → 3 оролдлого.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { posQpayIntents, posSettings } from "@/lib/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { parseWebhookPayload } from "@/lib/qpay/intent";
import { verifyWebhookSignature } from "@/lib/qpay/webhook-signature";
import { markIntentPaid, resolveQpayWebhookSecret } from "@/lib/qpay/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const intentId = new URL(request.url).searchParams.get("intent")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(intentId)) return NextResponse.json({ error: "intent required" }, { status: 400 });
  const rawBody = await request.text();

  try {
    const intent = await db.query.posQpayIntents.findFirst({ where: eq(posQpayIntents.id, intentId) });
    if (!intent) return NextResponse.json({ error: "unknown intent" }, { status: 404 });
    const settings = await db.query.posSettings.findFirst({
      where: eq(posSettings.organizationId, intent.organizationId),
      columns: { qpayWebhookSecretEnc: true },
    });
    const secret = settings ? resolveQpayWebhookSecret(settings) : null;
    if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 403 });
    if (!verifyWebhookSignature(rawBody, request.headers.get("x-webhook-signature"), secret)) {
      await logAuditEvent({
        userId: intent.cashierUserId ?? "",
        organizationId: intent.organizationId,
        action: "webhook_rejected",
        entityType: "pos_qpay_intent",
        entityId: intent.id,
        summary: "QPay webhook гарын үсэг таарсангүй",
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
    if (intent.qpayInvoiceId && payload.invoiceId !== intent.qpayInvoiceId)
      return NextResponse.json({ error: "invoice mismatch" }, { status: 409 });

    const result = await markIntentPaid(intent.organizationId, intent.id, {
      paidAmount: Number.isFinite(payload.amount) ? payload.amount : null,
      paymentId: payload.paymentId,
      paidAt: payload.paidAt ? new Date(payload.paidAt) : null,
      source: "webhook",
    });
    if (result.changed) {
      await logAuditEvent({
        userId: intent.cashierUserId ?? "",
        organizationId: intent.organizationId,
        action: result.status === "paid" ? "paid" : "webhook_amount_mismatch",
        entityType: "pos_qpay_intent",
        entityId: intent.id,
        summary:
          result.status === "paid"
            ? `QPay төлөгдлөө (webhook) — ${payload.invoiceId}, ${Number(intent.amount).toLocaleString("en-US")}₮`
            : `QPay webhook: ${result.reason ?? "дүн зөрсөн"} — ${payload.invoiceId}`,
      });
    }
    // Дүн зөрсөн нь dashboard-ын алдаа биш — 200 (дахин илгээх нь юу ч засахгүй).
    return NextResponse.json({ ok: true, status: result.status, changed: result.changed });
  } catch (error) {
    console.error("[qpay webhook]", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

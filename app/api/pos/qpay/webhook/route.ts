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
import { acceptsPayment, parseWebhookPayload } from "@/lib/qpay/intent";
import type { QpayIntentStatus } from "@/lib/qpay/constants";
import { verifyWebhookSignature } from "@/lib/qpay/webhook-signature";
import { recoverQpayCredentials } from "@/lib/qpay/partner";
import { markIntentPaid, resolveQpayWebhookSecret } from "@/lib/qpay/store";
import { QPAY_ARAP_PURPOSE, settleArapIntent, systemActor } from "@/lib/qpay/arap";

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
    const signature = request.headers.get("x-webhook-signature");
    let verified = verifyWebhookSignature(rawBody, signature, secret);
    if (!verified && acceptsPayment(intent.status as QpayIntentStatus)) {
      // Dashboard-аас webhook secret солигдсон байж болно — Partner API-аар
      // ОДООГИЙН secret-ийг авч дахин шалгана. Зөвхөн төлбөр хүлээж авах intent-д
      // (open, эсвэл хоцорсон төлбөрт cancelled / expired),
      // cooldown байгууллагад минутад нэг — дур мэдэн илгээсэн хүсэлт secret-ийг
      // задлахгүй (Entry л хадгална), давтамжаар key солиулж чадахгүй.
      const fresh = await recoverQpayCredentials(intent.organizationId, {
        reason: "webhook_signature",
        userId: intent.cashierUserId ?? "",
      });
      const freshSecret = fresh ? resolveQpayWebhookSecret(fresh) : null;
      verified = !!freshSecret && verifyWebhookSignature(rawBody, signature, freshSecret);
    }
    if (!verified) {
      await logAuditEvent({
        // Нэхэмжлэхийн QPay (purpose arap) кассчингүй — owner-ийн нэрээр; webhook
        // бол систем тул мэдэгдэл тэр хүнд ч очно (lib/audit.ts `system`).
        userId: intent.cashierUserId ?? (await systemActor(intent.organizationId)),
        system: true,
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
      const amount = `${Number(intent.amount).toLocaleString("en-US")}₮`;
      const late = result.late ? " — QR хаагдсаны дараа (хоцорсон төлбөр)" : "";
      await logAuditEvent({
        // Нэхэмжлэхийн QPay (purpose arap) кассчингүй — owner-ийн нэрээр; webhook
        // бол систем тул мэдэгдэл тэр хүнд ч очно (lib/audit.ts `system`).
        userId: intent.cashierUserId ?? (await systemActor(intent.organizationId)),
        system: true,
        organizationId: intent.organizationId,
        // rules.ts: late_paid ба webhook_amount_mismatch → шууд мэдэгдэл (мөнгө санаандгүй орсон).
        action: result.status !== "paid" ? "webhook_amount_mismatch" : result.late ? "late_paid" : "paid",
        entityType: "pos_qpay_intent",
        entityId: intent.id,
        summary:
          result.status === "paid"
            ? `QPay төлөгдлөө (webhook) — ${payload.invoiceId}, ${amount}${late}`
            : `QPay webhook: ${result.reason ?? "дүн зөрсөн"} — ${payload.invoiceId}${late}`,
      });
    }
    // Нэхэмжлэхийн линкээс (purpose arap) — сагсгүй тул ШУУД орлогын баримт
    // (settleArapIntent шидэхгүй; бүртгэж чадаагүй бол paid + шалтгаан → баннер/мэдэгдэл).
    if (result.changed && result.status === "paid" && intent.purpose === QPAY_ARAP_PURPOSE)
      await settleArapIntent(intent.organizationId, intent.id);
    // Дүн зөрсөн нь dashboard-ын алдаа биш — 200 (дахин илгээх нь юу ч засахгүй).
    return NextResponse.json({ ok: true, status: result.status, changed: result.changed });
  } catch (error) {
    console.error("[qpay webhook]", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

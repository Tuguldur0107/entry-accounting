import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  amountMatches,
  canTransition,
  checkAllowed,
  clampInvoiceTtl,
  invoiceAmountOf,
  isExpired,
  isTerminalStatus,
  parseWebhookPayload,
  secondsLeft,
} from "../lib/qpay/intent";
import { verifyWebhookSignature } from "../lib/qpay/webhook-signature";

test("шилжилт — open→paid→finalized; эцсийн төлөвөөс гарахгүй", () => {
  assert.equal(canTransition("open", "paid"), true);
  assert.equal(canTransition("open", "cancelled"), true);
  assert.equal(canTransition("open", "expired"), true);
  assert.equal(canTransition("paid", "finalized"), true);
  assert.equal(canTransition("paid", "cancelled"), false); // мөнгө орсон — цуцлахгүй
  assert.equal(canTransition("open", "finalized"), false); // төлөгдөөгүй байж бүртгэхгүй
  assert.equal(canTransition("finalized", "paid"), false);
  assert.equal(isTerminalStatus("finalized"), true);
  assert.equal(isTerminalStatus("open"), false);
});

test("TTL хязгаар, хугацаа дуусалт, таймер", () => {
  assert.equal(clampInvoiceTtl(undefined), 180);
  assert.equal(clampInvoiceTtl(10), 60);
  assert.equal(clampInvoiceTtl(5000), 900);
  assert.equal(clampInvoiceTtl("240"), 240);
  const now = new Date("2026-09-20T10:00:00Z");
  assert.equal(isExpired({ status: "open", expiresAt: "2026-09-20T09:59:59Z" }, now), true);
  assert.equal(isExpired({ status: "open", expiresAt: "2026-09-20T10:00:01Z" }, now), false);
  assert.equal(isExpired({ status: "paid", expiresAt: "2026-09-20T09:00:00Z" }, now), false);
  assert.equal(secondsLeft("2026-09-20T10:01:30Z", now), 90);
  assert.equal(secondsLeft("2026-09-20T09:00:00Z", now), 0);
});

test("QPay-руу шалгах зай ≥ 10 сек (ККТТ cron хориг)", () => {
  const now = new Date("2026-09-20T10:00:10Z");
  assert.equal(checkAllowed(null, now), true);
  assert.equal(checkAllowed(new Date("2026-09-20T10:00:05Z"), now), false);
  assert.equal(checkAllowed(new Date("2026-09-20T10:00:00Z"), now), true);
});

test("дүнгийн тулгалт — бүхэл ₮, 0.5 дотор; гажиг → таарахгүй", () => {
  assert.equal(amountMatches(15000, 15000), true);
  assert.equal(amountMatches(15000.4, 15000), true);
  assert.equal(amountMatches(15000, 14999), false);
  assert.equal(amountMatches(15000, null), false);
  assert.equal(amountMatches(15000, NaN), false);
  assert.equal(invoiceAmountOf(300.4), 300);
  assert.equal(invoiceAmountOf(0), null);
  assert.equal(invoiceAmountOf(-5), null);
});

test("webhook гарын үсэг — түүхий body, timing-safe, буруу/хоосон татгалзана", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ event: "payment.paid", invoice_id: "abc", amount: 100 });
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyWebhookSignature(body, sig, secret), true);
  assert.equal(verifyWebhookSignature(body, sig.toUpperCase(), secret), true);
  assert.equal(verifyWebhookSignature(body + " ", sig, secret), false);
  assert.equal(verifyWebhookSignature(body, "deadbeef", secret), false);
  assert.equal(verifyWebhookSignature(body, null, secret), false);
  assert.equal(verifyWebhookSignature(body, sig, ""), false);
});

test("webhook payload задлалт — зөвхөн payment.paid + invoice_id", () => {
  const ok = parseWebhookPayload({
    event: "payment.paid",
    invoice_id: " inv-1 ",
    sender_invoice_no: "POS-1",
    amount: "15000",
    payment_id: "p1",
    paid_at: "2026-09-20T10:00:00Z",
  });
  assert.deepEqual(ok, {
    event: "payment.paid",
    invoiceId: "inv-1",
    senderInvoiceNo: "POS-1",
    amount: 15000,
    paymentId: "p1",
    paidAt: "2026-09-20T10:00:00Z",
  });
  assert.equal(parseWebhookPayload({ event: "payment.refunded", invoice_id: "x" }), null);
  assert.equal(parseWebhookPayload({ event: "payment.paid" }), null);
  assert.equal(parseWebhookPayload("nope"), null);
  assert.ok(Number.isNaN(parseWebhookPayload({ event: "payment.paid", invoice_id: "x", amount: "abc" })!.amount));
});

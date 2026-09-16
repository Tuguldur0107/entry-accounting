// И-мэйл илгээгчийн цэвэр логик — resolve дараалал (tenant → env → алдаа),
// Resend алдааны орчуулга, нэхэмжлэхийн payload (PDF хавсралт + линк).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DOMAIN_NOT_VERIFIED_MSG,
  SENDER_NOT_CONFIGURED_MSG,
  buildInvoiceEmailPayload,
  resolveInvoiceSender,
  translateResendError,
  type InvoiceEmailData,
} from "@/lib/email/sender";

const verifiedTenant = {
  invoiceFromEmail: "billing@chipmo.mn",
  invoiceReplyTo: null,
  emailDomainVerified: true,
  companyName: "Чипмо ХХК",
};

describe("resolveInvoiceSender", () => {
  it("tenant тохиргоо env-ээс түрүүлнэ (нэртэй from)", () => {
    const sender = resolveInvoiceSender(verifiedTenant, {
      RESEND_FROM_EMAIL: "noreply@entry.mn",
    });
    assert.equal(sender.from, "Чипмо ХХК <billing@chipmo.mn>");
    assert.equal(sender.replyTo, undefined);
  });

  it("tenant reply-to env-ээс түрүүлнэ", () => {
    const sender = resolveInvoiceSender(
      { ...verifiedTenant, invoiceReplyTo: "info@chipmo.mn" },
      { RESEND_REPLY_TO: "support@entry.mn" }
    );
    assert.equal(sender.replyTo, "info@chipmo.mn");
  });

  it("verify хийгдээгүй tenant домэйн → ойлгомжтой алдаа, илгээхгүй", () => {
    assert.throws(
      () =>
        resolveInvoiceSender(
          { ...verifiedTenant, emailDomainVerified: false },
          { RESEND_FROM_EMAIL: "noreply@entry.mn" }
        ),
      (e: Error) => e.message === DOMAIN_NOT_VERIFIED_MSG
    );
  });

  it("tenant хоосон бол env RESEND_FROM_EMAIL + NAME", () => {
    const sender = resolveInvoiceSender(null, {
      RESEND_FROM_EMAIL: "billing@entry.mn",
      RESEND_FROM_NAME: "Entry Accounting",
      RESEND_REPLY_TO: "support@entry.mn",
    });
    assert.equal(sender.from, "Entry Accounting <billing@entry.mn>");
    assert.equal(sender.replyTo, "support@entry.mn");
  });

  it("нэргүй env → зөвхөн хаяг", () => {
    const sender = resolveInvoiceSender(null, {
      RESEND_FROM_EMAIL: "billing@entry.mn",
    });
    assert.equal(sender.from, "billing@entry.mn");
  });

  it("хуучин RESEND_FROM форматыг хүндэтгэнэ", () => {
    const sender = resolveInvoiceSender(null, {
      RESEND_FROM: "Entry <no-reply@entry.mn>",
    });
    assert.equal(sender.from, "Entry <no-reply@entry.mn>");
  });

  it("юу ч тохируулаагүй бол алдаа (sandbox fallback ҮГҮЙ)", () => {
    assert.throws(
      () => resolveInvoiceSender(null, {}),
      (e: Error) => e.message === SENDER_NOT_CONFIGURED_MSG
    );
  });

  it("tenant талбар нь хоосон/null бол env руу унана", () => {
    const sender = resolveInvoiceSender(
      {
        invoiceFromEmail: "  ",
        invoiceReplyTo: null,
        emailDomainVerified: false,
        companyName: "X",
      },
      { RESEND_FROM_EMAIL: "billing@entry.mn" }
    );
    assert.equal(sender.from, "billing@entry.mn");
  });

  it("буруу форматын tenant хаяг → алдаа", () => {
    assert.throws(() =>
      resolveInvoiceSender(
        { ...verifiedTenant, invoiceFromEmail: "буруу-хаяг" },
        {}
      )
    );
  });

  it("display нэрний < > \" тэмдэгт цэвэрлэгдэнэ", () => {
    const sender = resolveInvoiceSender(
      { ...verifiedTenant, companyName: 'Evil <x@y.z>"' },
      {}
    );
    assert.equal(sender.from, "Evil x@y.z <billing@chipmo.mn>");
  });
});

describe("translateResendError", () => {
  it("sandbox алдааг таньж монгол зөвлөмж өгнө", () => {
    const message =
      "You can only send testing emails to your own email address (tuguldur.e@chipmo.mn). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.";
    const translated = translateResendError(message);
    assert.ok(translated.includes("баталгаажаагүй"));
    assert.ok(translated.includes("resend.com/domains"));
  });

  it("domain is not verified алдааг мөн таньдаг", () => {
    const translated = translateResendError(
      "The chipmo.mn domain is not verified."
    );
    assert.ok(translated.includes("баталгаажаагүй"));
  });

  it("бусад алдааг залгилгүй дамжуулна", () => {
    const translated = translateResendError("Rate limit exceeded");
    assert.equal(translated, "И-мэйл илгээгдсэнгүй: Rate limit exceeded");
  });
});

describe("buildInvoiceEmailPayload", () => {
  const invoice: InvoiceEmailData = {
    documentNo: "AR-20260915-CAD8E5",
    companyName: "Чипмо ХХК",
    totalAmount: 1_250_000,
    currency: "MNT",
    dueDate: "2026-10-01",
    bankAccounts: [
      { bankName: "Хаан банк", accountNo: "5000000000", accountName: "Чипмо ХХК" },
    ],
  };

  it("PDF хавсралт {documentNo}.pdf нэртэй, base64 агуулгатай", () => {
    const pdf = Buffer.from("%PDF-1.4 fake");
    const payload = buildInvoiceEmailPayload({
      invoice,
      to: "customer@example.mn",
      from: "Чипмо ХХК <billing@chipmo.mn>",
      viewUrl: "https://app.entry.mn/invoice/tok-123",
      pdf,
    });
    assert.equal(payload.attachments.length, 1);
    assert.equal(payload.attachments[0].filename, "AR-20260915-CAD8E5.pdf");
    assert.equal(payload.attachments[0].content, pdf.toString("base64"));
  });

  it("public линк body-д ХЭВЭЭР үлдэнэ (хавсралтын нөөц зам)", () => {
    const payload = buildInvoiceEmailPayload({
      invoice,
      to: "customer@example.mn",
      from: "billing@chipmo.mn",
      viewUrl: "https://app.entry.mn/invoice/tok-123",
      pdf: Buffer.from("%PDF"),
    });
    assert.ok(payload.text.includes("https://app.entry.mn/invoice/tok-123"));
    assert.ok(payload.text.includes("Хаан банк"));
    assert.equal(
      payload.subject,
      "Нэхэмжлэх № AR-20260915-CAD8E5 — Чипмо ХХК"
    );
  });

  it("replyTo өгвөл payload-д орно, өгөхгүй бол талбар байхгүй", () => {
    const withReply = buildInvoiceEmailPayload({
      invoice,
      to: "a@b.mn",
      from: "billing@chipmo.mn",
      replyTo: "info@chipmo.mn",
      viewUrl: "https://x/invoice/t",
      pdf: Buffer.from("%PDF"),
    });
    assert.equal(withReply.replyTo, "info@chipmo.mn");
    const without = buildInvoiceEmailPayload({
      invoice,
      to: "a@b.mn",
      from: "billing@chipmo.mn",
      viewUrl: "https://x/invoice/t",
      pdf: Buffer.from("%PDF"),
    });
    assert.ok(!("replyTo" in without));
  });
});

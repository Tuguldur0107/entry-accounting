"use server";

// Нэхэмжлэх илгээх — и-мэйл (Resend, PDF хавсралттай) эсвэл public линк.
// Зөвхөн БИЧИГДСЭН (posted) нэхэмжлэх илгээнэ — ноорог илгээхийг хориглоно
// (human-in-the-loop зарчим). Илгээлт бүр arApInvoiceSends-д бүртгэгдэнэ.

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Resend } from "resend";

import { getActiveOrg, requireRole } from "@/lib/auth";
import { loadInvoicePayload } from "@/lib/arap/invoice-payload";
import { db } from "@/lib/db";
import { arApDocuments, arApInvoiceSends } from "@/lib/db/schema";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";



/** Public линкний суурь URL — тохируулаагүй бол localhost. */
function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

async function assertSendable(orgId: string, documentId: string) {
  const document = await db.query.arApDocuments.findFirst({
    where: and(
      eq(arApDocuments.id, documentId),
      eq(arApDocuments.organizationId, orgId)
    ),
  });
  if (!document) throw new Error("Нэхэмжлэх олдсонгүй");
  if (document.documentType !== "ar_invoice")
    throw new Error("Зөвхөн авлагын нэхэмжлэх илгээнэ");
  if (document.status !== "posted")
    throw new Error("Зөвхөн бичигдсэн (posted) нэхэмжлэх илгээнэ — эхлээд батална уу");
  return document;
}

/** Линкний хугацааны зөвшөөрөгдсөн сонголтууд (хоногоор). */
const LINK_EXPIRY_DAYS = [7, 30, 90] as const;

/**
 * Public линк үүсгэнэ (болон бүртгэнэ) — и-мэйлгүй харилцагчид хуваалцахад.
 * expiryDays: 7 | 30 | 90 хоног, null = хугацаагүй. Default 90 хоног.
 */
export async function createInvoiceLink(
  documentId: string,
  options?: { expiryDays?: number | null }
) {
  const { orgId, userId } = await requireRole("accountant");
  await assertSendable(orgId, documentId);

  const expiryDays = options?.expiryDays === undefined ? 90 : options.expiryDays;
  if (
    expiryDays !== null &&
    !LINK_EXPIRY_DAYS.includes(expiryDays as (typeof LINK_EXPIRY_DAYS)[number])
  )
    throw new Error("Линкний хугацааны сонголт буруу байна (7/30/90 хоног эсвэл хугацаагүй)");
  const expiresAt =
    expiryDays === null
      ? null
      : new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

  const [send] = await db
    .insert(arApInvoiceSends)
    .values({ userId, organizationId: orgId, documentId, channel: "link", expiresAt })
    .returning({ token: arApInvoiceSends.token });

  revalidatePath("/receivables/documents");
  return { url: `${appBaseUrl()}/invoice/${send.token}` };
}

/** И-мэйлээр илгээнэ — PDF хавсралт + public линк хоёулаа орно. */
export async function sendInvoiceEmail(documentId: string, recipient: string) {
  const { orgId, userId } = await requireRole("accountant");
  const document = await assertSendable(orgId, documentId);

  const email = recipient.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("И-мэйл хаяг буруу байна");

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey)
    throw new Error(
      "И-мэйл илгээх тохиргоо хийгдээгүй — .env.local-д RESEND_API_KEY нэмнэ үү. Түр зуур «Линк үүсгэх»-ийг ашиглаж болно."
    );

  const invoice = await loadInvoicePayload(orgId, documentId);
  if (!invoice) throw new Error("Нэхэмжлэх олдсонгүй");
  if (!invoice.company.name)
    throw new Error(
      "Компанийн нэр тохируулаагүй — Тохиргоо → Компанийн мэдээлэл хэсгийг бөглөнө үү"
    );

  // Линк + и-мэйлийг НЭГ бүртгэлээр — линк нь мэйл доторх "онлайнаар үзэх".
  const [send] = await db
    .insert(arApInvoiceSends)
    .values({ userId, organizationId: orgId, documentId, channel: "email", recipient: email })
    .returning({ token: arApInvoiceSends.token });
  const viewUrl = `${appBaseUrl()}/invoice/${send.token}`;

  const pdf = await renderInvoicePdf(invoice);
  const resend = new Resend(apiKey);
  const from =
    process.env.RESEND_FROM ?? "Entry Accounting <onboarding@resend.dev>";

  const { error } = await resend.emails.send({
    from,
    to: email,
    subject: `Нэхэмжлэх № ${invoice.documentNo} — ${invoice.company.name}`,
    text: [
      `Сайн байна уу,`,
      ``,
      `${invoice.company.name}-с илгээсэн № ${invoice.documentNo} нэхэмжлэхийг хавсаргав.`,
      ``,
      `Дүн: ${invoice.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${invoice.currency}`,
      `Төлөх огноо: ${invoice.dueDate}`,
      ``,
      `Онлайнаар үзэх: ${viewUrl}`,
      ``,
      invoice.company.bankAccounts.length
        ? `Төлбөр хүлээн авах данс:\n${invoice.company.bankAccounts
            .map((account) => `  ${account.bankName} · ${account.accountNo} · ${account.accountName}`)
            .join("\n")}`
        : "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
    attachments: [
      {
        filename: `invoice-${invoice.documentNo}.pdf`,
        content: pdf.toString("base64"),
      },
    ],
  });

  if (error) {
    // Илгээлт бүтэлгүйтвэл бүртгэлээ цуцалж, жинхэнэ төлөвөө үнэнчээр үлдээнэ.
    await db
      .update(arApInvoiceSends)
      .set({ revokedAt: new Date() })
      .where(eq(arApInvoiceSends.token, send.token));
    throw new Error(`И-мэйл илгээгдсэнгүй: ${error.message}`);
  }

  revalidatePath("/receivables/documents");
  return { sentTo: email, documentNo: document.documentNo };
}

/** Илгээх dialog-ийн контекст — харилцагчийн и-мэйл + илгээлтийн түүх. */
export async function getInvoiceSendContext(documentId: string) {
  const { orgId } = await getActiveOrg();
  const document = await db.query.arApDocuments.findFirst({
    where: and(
      eq(arApDocuments.id, documentId),
      eq(arApDocuments.organizationId, orgId)
    ),
    with: { counterparty: true },
  });
  if (!document) throw new Error("Нэхэмжлэх олдсонгүй");
  return {
    counterpartyEmail: document.counterparty.email,
    counterpartyName: document.counterparty.name,
    sends: await listInvoiceSends(documentId),
  };
}

/** Баримтын илгээлтийн түүх — panel-д үзүүлнэ. */
export async function listInvoiceSends(documentId: string) {
  const { orgId } = await getActiveOrg();
  const rows = await db.query.arApInvoiceSends.findMany({
    where: and(
      eq(arApInvoiceSends.documentId, documentId),
      eq(arApInvoiceSends.organizationId, orgId)
    ),
    orderBy: [desc(arApInvoiceSends.sentAt)],
  });
  return rows.map((row) => {
    const expired =
      !!row.expiresAt && row.expiresAt.getTime() < Date.now();
    return {
      id: row.id,
      channel: row.channel as "email" | "link",
      recipient: row.recipient,
      url:
        row.revokedAt || expired
          ? null
          : `${appBaseUrl()}/invoice/${row.token}`,
      sentAt: row.sentAt.toISOString(),
      viewedAt: row.viewedAt?.toISOString() ?? null,
      revoked: !!row.revokedAt,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      expired,
    };
  });
}

/** Линкийг хүчингүй болгоно — цаашид нээгдэхгүй. */
export async function revokeInvoiceSend(sendId: string) {
  const { orgId } = await requireRole("accountant");
  await db
    .update(arApInvoiceSends)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(arApInvoiceSends.id, sendId),
        eq(arApInvoiceSends.organizationId, orgId)
      )
    );
  revalidatePath("/receivables/documents");
}

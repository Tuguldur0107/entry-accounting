// Нэхэмжлэхийн хүчинтэй нийтийн линк (ar_ap_invoice_sends) — PDF ба хэвлэх
// хуудасны QR-д. Линк ҮҮСГЭХГҮЙ: нийтийн линк нь хэрэглэгчийн ИЛ үйлдлээр л
// (Линк үүсгэх / И-мэйлээр илгээх). Хөнгөн модуль — АР loader-ууд импортолно.

import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

import { publicAppUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import { arApInvoiceSends } from "@/lib/db/schema";

/** Баримтын хамгийн сүүлийн хүчинтэй (цуцлаагүй, дуусаагүй) линкийн токен. */
export async function activeInvoiceLinkToken(orgId: string, documentId: string): Promise<string | null> {
  const row = await db.query.arApInvoiceSends.findFirst({
    where: and(
      eq(arApInvoiceSends.organizationId, orgId),
      eq(arApInvoiceSends.documentId, documentId),
      isNull(arApInvoiceSends.revokedAt),
      or(isNull(arApInvoiceSends.expiresAt), gt(arApInvoiceSends.expiresAt, new Date()))
    ),
    orderBy: [desc(arApInvoiceSends.sentAt)],
    columns: { token: true },
  });
  return row?.token ?? null;
}

/** Хүчинтэй линкийн бүтэн URL — линк эсвэл NEXT_PUBLIC_APP_URL байхгүй бол null. */
export async function activeInvoiceLinkUrl(orgId: string, documentId: string): Promise<string | null> {
  const base = publicAppUrl();
  if (!base) return null;
  const token = await activeInvoiceLinkToken(orgId, documentId);
  return token ? `${base}/invoice/${token}` : null;
}

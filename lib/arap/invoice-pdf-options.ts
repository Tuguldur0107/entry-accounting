// Нэхэмжлэхийн PDF дээрх линкийн QR (lib/pdf/invoice-pdf.tsx `LinkQr`) — харилцагч
// утсаараа уншуулж нээлттэй линкийг нээгээд, QPay идэвхтэй бол шууд төлнө.
// Линк ҮҮСГЭХГҮЙ: нийтийн линк нь хэрэглэгчийн ИЛ үйлдлээр л (Линк үүсгэх /
// И-мэйлээр илгээх) гарна — PDF татахад далдаар гадагш нээгдэхгүй.

import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { arApDocuments, arApInvoiceSends } from "@/lib/db/schema";
import type { InvoicePdfOptions } from "@/lib/pdf/invoice-pdf";
import { invoiceQpayAvailable } from "@/lib/qpay/arap";
import { publicAppUrl } from "@/lib/qpay/store";

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

/**
 * PDF-ийн QR-ын сонголт. Нийтийн URL (NEXT_PUBLIC_APP_URL) тохируулаагүй бол
 * QR-гүй — localhost-ын QR харилцагчид хэрэггүй. Шидэхгүй: QR нь нэмэлт.
 */
export async function invoicePdfOptions(
  orgId: string,
  documentId: string,
  token: string | null
): Promise<InvoicePdfOptions> {
  const base = publicAppUrl();
  if (!base || !token) return {};
  const document = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, documentId), eq(arApDocuments.organizationId, orgId)),
  });
  const qpay = document ? await invoiceQpayAvailable(orgId, document).catch(() => false) : false;
  return { payUrl: `${base}/invoice/${token}`, qpay };
}

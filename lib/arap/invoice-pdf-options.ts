// Нэхэмжлэхийн PDF дээрх линкийн QR (lib/pdf/invoice-pdf.tsx `LinkQr`) — харилцагч
// утсаараа уншуулж нээлттэй линкийг нээгээд, QPay идэвхтэй бол шууд төлнө.
// Линк ҮҮСГЭХГҮЙ: нийтийн линк нь хэрэглэгчийн ИЛ үйлдлээр л (Линк үүсгэх /
// И-мэйлээр илгээх) гарна — PDF татахад далдаар гадагш нээгдэхгүй.

import { and, eq } from "drizzle-orm";

import { publicAppUrl } from "@/lib/app-url";
import { activeInvoiceLinkToken } from "@/lib/arap/invoice-link";
import { db } from "@/lib/db";
import { arApDocuments } from "@/lib/db/schema";
import type { InvoicePdfOptions } from "@/lib/pdf/invoice-pdf";
import { invoiceQpayAvailable } from "@/lib/qpay/arap";

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

export { activeInvoiceLinkToken };

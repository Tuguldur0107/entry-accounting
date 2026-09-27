// Нэхэмжлэхийн PDF — нэвтэрсэн хэрэглэгч өөрийн баримтаа татна.
// Public хувилбар нь /invoice/[token] замаар (токеноор) явдаг.

import { requireAnyModuleAction } from "@/lib/auth";
import { loadInvoicePayload } from "@/lib/arap/invoice-payload";
import { activeInvoiceLinkToken, invoicePdfOptions } from "@/lib/arap/invoice-pdf-options";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  // Нэвтрэлт + АР/АП-ийн аль нэгд унших эрх (эрхгүй гишүүн PDF татахгүй).
  const active = await requireAnyModuleAction([["ar", "read"], ["ap", "read"]]).catch(
    () => null
  );
  if (!active)
    return new Response("Нэвтрэх эсвэл унших эрх шаардлагатай", { status: 401 });

  const { documentId } = await params;
  const invoice = await loadInvoicePayload(active.orgId, documentId);
  if (!invoice) return new Response("Нэхэмжлэх олдсонгүй", { status: 404 });

  // Хүчинтэй линк байвал QR (харилцагч уншуулж нээх / QPay-ээр төлөх); линкгүй
  // бол QR-гүй — PDF татах нь нийтийн линк ҮҮСГЭХГҮЙ.
  const token = await activeInvoiceLinkToken(active.orgId, documentId);
  const pdf = await renderInvoicePdf(invoice, await invoicePdfOptions(active.orgId, documentId, token));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.documentNo}.pdf"`,
    },
  });
}

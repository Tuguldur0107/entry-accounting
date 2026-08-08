// Нэхэмжлэхийн PDF — нэвтэрсэн хэрэглэгч өөрийн баримтаа татна.
// Public хувилбар нь /invoice/[token] замаар (токеноор) явдаг.

import { getActiveOrg } from "@/lib/auth";
import { loadInvoicePayload } from "@/lib/arap/invoice-payload";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const active = await getActiveOrg().catch(() => null);
  if (!active)
    return new Response("Нэвтрэх шаардлагатай", { status: 401 });

  const { documentId } = await params;
  const invoice = await loadInvoicePayload(active.orgId, documentId);
  if (!invoice) return new Response("Нэхэмжлэх олдсонгүй", { status: 404 });

  const pdf = await renderInvoicePdf(invoice);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${invoice.documentNo}.pdf"`,
    },
  });
}

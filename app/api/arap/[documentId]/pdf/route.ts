// Нэхэмжлэхийн PDF — нэвтэрсэн хэрэглэгч өөрийн баримтаа татна.
// Public хувилбар нь /invoice/[token] замаар (токеноор) явдаг.

import { requireAnyModuleAction } from "@/lib/auth";
import { loadInvoicePayload } from "@/lib/arap/invoice-payload";
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

  const pdf = await renderInvoicePdf(invoice);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.documentNo}.pdf"`,
    },
  });
}

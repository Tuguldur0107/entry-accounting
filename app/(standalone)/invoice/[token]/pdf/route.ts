// Public PDF — токеноор (нэвтрэлтгүй). Хүчингүй болгосон линк 404.

import { and, eq, isNull } from "drizzle-orm";

import { loadInvoicePayload } from "@/lib/arap/invoice-payload";
import { db } from "@/lib/db";
import { arApInvoiceSends } from "@/lib/db/schema";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/.test(token))
    return new Response("Олдсонгүй", { status: 404 });

  const send = await db.query.arApInvoiceSends.findFirst({
    where: and(eq(arApInvoiceSends.token, token), isNull(arApInvoiceSends.revokedAt)),
  });
  if (!send) return new Response("Олдсонгүй", { status: 404 });

  const invoice = await loadInvoicePayload(send.userId, send.documentId);
  if (!invoice) return new Response("Олдсонгүй", { status: 404 });

  const pdf = await renderInvoicePdf(invoice);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${invoice.documentNo}.pdf"`,
    },
  });
}

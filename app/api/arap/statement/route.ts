// Тооцоо нийлсэн актын PDF (docs/dev/arap.md §5i) — нэвтэрсэн, АР эсвэл АП-д
// унших эрхтэй гишүүн. ?counterpartyId=&from=YYYY-MM-DD&to=YYYY-MM-DD

import { requireAnyModuleAction } from "@/lib/auth";
import { loadCounterpartyStatement } from "@/lib/arap/statement-db";
import { renderStatementPdf } from "@/lib/pdf/statement-pdf";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const active = await requireAnyModuleAction([["ar", "read"], ["ap", "read"]]).catch(() => null);
  if (!active) return new Response("Нэвтрэх эсвэл унших эрх шаардлагатай", { status: 401 });

  const params = new URL(request.url).searchParams;
  const counterpartyId = params.get("counterpartyId") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(counterpartyId) || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to)
    return new Response("Харилцагч эсвэл огноо буруу", { status: 400 });

  const statement = await loadCounterpartyStatement(active.orgId, counterpartyId, from, to);
  if (!statement) return new Response("Харилцагч олдсонгүй", { status: 404 });
  const pdf = await renderStatementPdf(statement);
  const filename = encodeURIComponent(`Тооцоо нийлсэн акт — ${statement.counterparty.name} ${to}.pdf`);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${filename}`,
    },
  });
}

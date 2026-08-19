import { and, asc, eq } from "drizzle-orm";

import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { bankStatementLines, bankStatements } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * Импортлогдсон хуулгын мөрүүд — түүхийн drill-down. Мөр бүр үүсгэсэн кассын
 * баримтынхаа төлөвтэй хамт ирнэ: панелиас нь «Буцаах» хийж болно (undo зам).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ statementId: string }> }
) {
  let orgId: string;
  try {
    ({ orgId } = await getActiveOrg());
  } catch {
    return Response.json({ error: "Нэвтрэх шаардлагатай" }, { status: 401 });
  }

  const { statementId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      statementId
    )
  )
    return Response.json({ error: "Хуулга олдсонгүй" }, { status: 404 });

  try {
    const statement = await db.query.bankStatements.findFirst({
      where: and(
        eq(bankStatements.id, statementId),
        eq(bankStatements.organizationId, orgId)
      ),
      columns: { id: true, fileName: true },
    });
    if (!statement)
      return Response.json({ error: "Хуулга олдсонгүй" }, { status: 404 });

    const lines = await db.query.bankStatementLines.findMany({
      where: eq(bankStatementLines.statementId, statementId),
      with: {
        cashDocument: { columns: { id: true, documentNo: true, status: true } },
      },
      orderBy: [asc(bankStatementLines.rowNumber)],
    });

    return Response.json({
      fileName: statement.fileName,
      lines: lines.map((line) => ({
        id: line.id,
        rowNumber: line.rowNumber,
        transactionDate: line.transactionDate,
        description: line.description,
        counterparty: line.counterparty,
        income: Number(line.income),
        expense: Number(line.expense),
        cashDocumentId: line.cashDocument?.id ?? null,
        documentNo: line.cashDocument?.documentNo ?? null,
        documentStatus: line.cashDocument?.status ?? null,
      })),
    });
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Мөрүүд ачаалж чадсангүй";
    return Response.json({ error: message }, { status: 400 });
  }
}

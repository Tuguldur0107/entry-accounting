import { and, desc, eq, inArray } from "drizzle-orm";

import { auth } from "@/lib/auth";
import {
  buildHistoricalPatterns,
  type MatchContext,
} from "@/lib/cash/statement-matching";
import { db } from "@/lib/db";
import { arApDocuments, bankStatementLines, bankStatements } from "@/lib/db/schema";

export const runtime = "nodejs";

const OPEN_INVOICE_LIMIT = 500;
const HISTORY_LINE_LIMIT = 5000;

/**
 * Хуулгын импортын саналын лавлах дата:
 *   - нээлттэй АР/АП нэхэмжлэхүүд (posted | partially_paid, үлдэгдэлтэй)
 *   - өмнөх баталгаажсан хуулгын мөрүүдээс гарсан харилцагч → данс загварууд
 * Хоёул userId-аар хамгаалагдсан. Тулгалтын логик нь client талд цэвэр
 * функцээр (lib/cash/statement-matching.ts) ажиллана.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId)
    return Response.json({ error: "Нэвтрэх шаардлагатай" }, { status: 401 });

  try {
    const [invoices, historyLines] = await Promise.all([
      db.query.arApDocuments.findMany({
        where: and(
          eq(arApDocuments.userId, userId),
          inArray(arApDocuments.status, ["posted", "partially_paid"])
        ),
        with: { counterparty: { columns: { name: true } } },
        orderBy: [desc(arApDocuments.date)],
        limit: OPEN_INVOICE_LIMIT,
      }),
      db
        .select({
          counterparty: bankStatementLines.counterparty,
          income: bankStatementLines.income,
          expense: bankStatementLines.expense,
          debitAccountNumber: bankStatementLines.debitAccountNumber,
          creditAccountNumber: bankStatementLines.creditAccountNumber,
        })
        .from(bankStatementLines)
        .innerJoin(
          bankStatements,
          eq(bankStatementLines.statementId, bankStatements.id)
        )
        .where(eq(bankStatements.userId, userId))
        .orderBy(desc(bankStatementLines.createdAt))
        .limit(HISTORY_LINE_LIMIT),
    ]);

    const context: MatchContext = {
      openInvoices: invoices
        .map((invoice) => ({
          id: invoice.id,
          documentNo: invoice.documentNo,
          counterpartyName: invoice.counterparty.name,
          totalAmount: Number(invoice.totalAmount),
          paidAmount: Number(invoice.paidAmount),
          documentType: invoice.documentType as "ar_invoice" | "ap_bill",
          controlAccountNumber: invoice.controlAccountNumber,
        }))
        .filter((invoice) => invoice.totalAmount - invoice.paidAmount > 0),
      historicalPatterns: buildHistoricalPatterns(
        historyLines.map((line) => ({
          counterparty: line.counterparty,
          income: Number(line.income),
          expense: Number(line.expense),
          debitAccountNumber: line.debitAccountNumber,
          creditAccountNumber: line.creditAccountNumber,
        }))
      ),
    };

    return Response.json(context);
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Саналын дата ачаалж чадсангүй";
    return Response.json({ error: message }, { status: 400 });
  }
}

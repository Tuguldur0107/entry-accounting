import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { getActiveOrg } from "@/lib/auth";
import type { BankRule, BankRuleMode, BankRuleSide } from "@/lib/cash/bank-rules";
import {
  buildHistoricalPatterns,
  type MatchContext,
} from "@/lib/cash/statement-matching";
import { db } from "@/lib/db";
import {
  arApDocuments,
  bankRules,
  bankStatementLines,
  bankStatements,
} from "@/lib/db/schema";

export const runtime = "nodejs";

const OPEN_INVOICE_LIMIT = 500;
const HISTORY_LINE_LIMIT = 5000;

/**
 * Хуулгын импортын саналын лавлах дата:
 *   - нээлттэй АР/АП нэхэмжлэхүүд (posted | partially_paid, үлдэгдэлтэй)
 *   - өмнөх баталгаажсан хуулгын мөрүүдээс гарсан харилцагч → данс загварууд
 * Хоёул байгууллагаар (organizationId) хамгаалагдсан. Тулгалтын логик нь
 * client талд цэвэр функцээр (lib/cash/statement-matching.ts) ажиллана.
 */
export async function GET() {
  let orgId: string;
  try {
    ({ orgId } = await getActiveOrg());
  } catch {
    return Response.json({ error: "Нэвтрэх шаардлагатай" }, { status: 401 });
  }

  try {
    const [invoices, historyLines, ruleRows] = await Promise.all([
      db.query.arApDocuments.findMany({
        where: and(
          eq(arApDocuments.organizationId, orgId),
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
        .where(eq(bankStatements.organizationId, orgId))
        .orderBy(desc(bankStatementLines.createdAt))
        .limit(HISTORY_LINE_LIMIT),
      // П8 — хэрэглэгчийн идэвхтэй дүрмүүд: клиент талд мөр бүрд тулгаж
      // (lib/cash/bank-rules.ts) нэхэмжлэх/түүхэн саналын ӨМНӨ давхарлана.
      db.query.bankRules.findMany({
        where: and(
          eq(bankRules.organizationId, orgId),
          eq(bankRules.isActive, true)
        ),
        orderBy: [asc(bankRules.priority), asc(bankRules.name)],
      }),
    ]);

    const rules: BankRule[] = ruleRows.map((row) => ({
      id: row.id,
      name: row.name,
      matchText: row.matchText,
      side: row.side as BankRuleSide,
      minAmount: row.minAmount == null ? null : Number(row.minAmount),
      maxAmount: row.maxAmount == null ? null : Number(row.maxAmount),
      counterAccountNumber: row.counterAccountNumber,
      setCounterparty: row.setCounterparty,
      setDescription: row.setDescription,
      mode: row.mode as BankRuleMode,
      priority: row.priority,
      isActive: row.isActive,
    }));

    const context: MatchContext & { rules: BankRule[] } = {
      rules,
      openInvoices: invoices
        .map((invoice) => ({
          id: invoice.id,
          documentNo: invoice.documentNo,
          counterpartyName: invoice.counterparty.name,
          totalAmount: Number(invoice.totalAmount),
          paidAmount: Number(invoice.paidAmount),
          documentType: invoice.documentType as "ar_invoice" | "ap_bill",
          controlAccountNumber: invoice.controlAccountNumber,
          // Валют зөрсөн нэхэмжлэх санал болохгүй — client талд банкны
          // дансны валютаар шүүнэ (save route мөн хориглодог).
          currency: invoice.currency,
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

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { loadAdvanceSettings, type AdvanceSettings } from "@/lib/arap/advances";
import { requireModuleAction } from "@/lib/auth";
import type { BankRule, BankRuleMode, BankRuleSide } from "@/lib/cash/bank-rules";
import type { EwalletSettlementMethod } from "@/lib/cash/ewallet-settlement";
import { buildInvoiceAccountHints, type InvoiceAccountHints } from "@/lib/cash/bank-row-preview";
import { loadEwalletSettlementContext } from "@/lib/cash/ewallet-settlement-data";
import {
  buildHistoricalPatterns,
  type MatchContext,
} from "@/lib/cash/statement-matching";
import { db } from "@/lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  bankRules,
  bankStatementLines,
  bankStatements,
  counterparties,
} from "@/lib/db/schema";
import { loadVatSettings } from "@/lib/vat/settings";

export const runtime = "nodejs";

const OPEN_INVOICE_LIMIT = 500;
const HISTORY_LINE_LIMIT = 5000;
const INVOICE_LINE_HISTORY_LIMIT = 3000;

/**
 * Хуулгын импортын саналын лавлах дата:
 *   - нээлттэй АР/АП нэхэмжлэхүүд (posted | partially_paid, үлдэгдэлтэй)
 *   - өмнөх баталгаажсан хуулгын мөрүүдээс гарсан харилцагч → данс загварууд
 *   - э-хэтэвчийн (QPay) хэлбэрүүд + түр дансны тулгагдаагүй орлогууд (settlement)
 *   - идэвхтэй харилцагчид + урьдчилгааны дансны роль (мөрийн бүртгэлийн
 *     төрөл, docs/dev/arap.md §5l)
 *   - нэхэмжлэх үүсгэх мөрийн харьцах дансны санал (өмнөх нэхэмжлэхээс,
 *     lib/cash/bank-row-preview.ts)
 * Бүгд байгууллагаар (organizationId) хамгаалагдсан. Тулгалтын логик нь
 * client талд цэвэр функцээр (lib/cash/statement-matching.ts) ажиллана.
 */
export async function GET() {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireModuleAction("cash", "read"));
  } catch {
    return Response.json({ error: "Нэвтрэх эсвэл унших эрх шаардлагатай" }, { status: 401 });
  }

  try {
    const [
      invoices,
      historyLines,
      ruleRows,
      ewallet,
      counterpartyRows,
      advanceSettings,
      invoiceLines,
      vatSettings,
    ] = await Promise.all([
      db.query.arApDocuments.findMany({
        where: and(
          eq(arApDocuments.organizationId, orgId),
          inArray(arApDocuments.status, ["posted", "partially_paid"]),
          // Кредит нэхэмжлэл / дебит нэхэмжлэх банкаар хаагдахгүй (буруу чиглэл).
          inArray(arApDocuments.documentType, ["ar_invoice", "ap_bill"])
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
      loadEwalletSettlementContext(orgId),
      db.query.counterparties.findMany({
        where: and(eq(counterparties.organizationId, orgId), eq(counterparties.isActive, true)),
        // bankAccountNo — хуулгын харьцсан дансаар автоматаар холбоход.
        columns: { id: true, name: true, counterpartyType: true, bankAccountNo: true },
        orderBy: [asc(counterparties.name)],
      }),
      loadAdvanceSettings(orgId),
      // Нэхэмжлэх үүсгэх мөрийн харьцах дансны санал — харилцагчийн сүүлийн
      // нэхэмжлэх, байгууллагын хамгийн их хэрэглэсэн орлого / зардлын данс (данс ЗОХИОХГҮЙ).
      db
        .select({
          counterpartyId: arApDocuments.counterpartyId,
          documentType: arApDocuments.documentType,
          accountNumber: arApDocumentLines.accountNumber,
        })
        .from(arApDocumentLines)
        .innerJoin(arApDocuments, eq(arApDocumentLines.documentId, arApDocuments.id))
        .where(
          and(
            eq(arApDocuments.organizationId, orgId),
            inArray(arApDocuments.documentType, ["ar_invoice", "ap_bill"]),
            inArray(arApDocuments.status, ["posted", "partially_paid", "paid"])
          )
        )
        .orderBy(desc(arApDocuments.date), desc(arApDocuments.createdAt), asc(arApDocumentLines.sortOrder))
        .limit(INVOICE_LINE_HISTORY_LIMIT),
      // НӨАТ-ын мөрийг дансны саналаас хасахад.
      loadVatSettings(orgId, userId),
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

    const context: MatchContext & {
      rules: BankRule[];
      ewalletMethods: EwalletSettlementMethod[];
      counterparties: { id: string; name: string; counterpartyType: string; bankAccountNo: string | null }[];
      advanceSettings: AdvanceSettings;
      invoiceAccountHints: InvoiceAccountHints;
    } = {
      rules,
      ewalletMethods: ewallet.methods,
      counterparties: counterpartyRows,
      invoiceAccountHints: buildInvoiceAccountHints(
        invoiceLines.filter((line): line is typeof line & { counterpartyId: string } => !!line.counterpartyId),
        [vatSettings.outputVatAccountNumber, vatSettings.inputVatAccountNumber]
      ),
      advanceSettings: {
        customerAdvanceAccountNumber: advanceSettings.customerAdvanceAccountNumber,
        supplierAdvanceAccountNumber: advanceSettings.supplierAdvanceAccountNumber,
      },
      openInvoices: invoices
        .map((invoice) => ({
          id: invoice.id,
          documentNo: invoice.documentNo,
          counterpartyId: invoice.counterpartyId,
          counterpartyName: invoice.counterparty.name,
          totalAmount: Number(invoice.totalAmount),
          paidAmount: Number(invoice.paidAmount),
          documentType: invoice.documentType as "ar_invoice" | "ap_bill",
          controlAccountNumber: invoice.controlAccountNumber,
          // Валют зөрсөн нэхэмжлэх санал болохгүй — client талд банкны
          // дансны валютаар шүүнэ (save route мөн хориглодог).
          currency: invoice.currency,
          // Огнооны зөрүүгээр санал сулруулна (ENT-056).
          dueDate: invoice.dueDate,
          // Нэхэмжлэх сонгох цонхонд (огноогоор эрэмбэлэх, харуулах).
          date: invoice.date,
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

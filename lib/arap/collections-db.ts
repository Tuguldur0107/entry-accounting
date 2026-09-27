// Авлагын цуглуулалтын самбарын DB ачаалагч (docs/dev/arap.md §5j) — нэг
// байгууллагын нээлттэй авлага, 90 хоногийн борлуулалт, цуглуулалт, сануулга,
// давтамжтай нэхэмжлэх → `lib/arap/collections.ts`. Server-only (orgId параметртэй).

import { and, between, eq, gte, inArray, isNotNull, lte, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocuments,
  arApSettlements,
  arInvoiceReminders,
  arRecurringInvoices,
  counterparties,
} from "@/lib/db/schema";
import { todayInUlaanbaatar } from "@/lib/periods/selection";

import {
  DSO_WINDOW_DAYS,
  daysSalesOutstanding,
  expectedInflow,
  reminderEffect,
  topOverdueCustomers,
  type CollectionsOverview,
} from "./collections";
import { addDays } from "./recurring";
import { loadReminderSettings } from "./reminders-run";

export * from "./collections";

const num = (value: unknown) => Number(value ?? 0) || 0;
const round = (value: number) => Math.round(value * 100) / 100;

const ubDate = (value: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);

function monthRange(today: string, offset: number): [string, string] {
  const [year, month] = today.split("-").map(Number);
  const index = year * 12 + (month - 1) + offset;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, "0")}`];
}

export async function loadCollectionsOverview(orgId: string, today = todayInUlaanbaatar()): Promise<CollectionsOverview> {
  const base = sql<string>`coalesce(${arApDocuments.baseTotalAmount}, ${arApDocuments.totalAmount})`;
  const paid = sql<string>`coalesce(${arApDocuments.basePaidAmount}, ${arApDocuments.paidAmount})`;
  // Хуучин тооцооны мөрд baseAmount 0 байж болно — тэр үед гүйлгээний дүн (₮ баримт).
  const settledBase = sql<string>`coalesce(nullif(${arApSettlements.baseAmount}, 0), ${arApSettlements.amount})`;
  const [thisMonth, lastMonth] = [monthRange(today, 0), monthRange(today, -1)];

  const [open, sales, collected, reminders, settings, recurring] = await Promise.all([
    db
      .select({
        documentType: arApDocuments.documentType,
        counterpartyId: arApDocuments.counterpartyId,
        counterpartyName: counterparties.name,
        dueDate: arApDocuments.dueDate,
        balance: sql<string>`${base} - ${paid}`,
      })
      .from(arApDocuments)
      .innerJoin(counterparties, eq(counterparties.id, arApDocuments.counterpartyId))
      .where(
        and(
          eq(arApDocuments.organizationId, orgId),
          inArray(arApDocuments.documentType, ["ar_invoice", "ar_credit_note"]),
          inArray(arApDocuments.status, ["posted", "partially_paid"])
        )
      ),
    db
      .select({ documentType: arApDocuments.documentType, total: sql<string>`sum(${base})` })
      .from(arApDocuments)
      .where(
        and(
          eq(arApDocuments.organizationId, orgId),
          inArray(arApDocuments.documentType, ["ar_invoice", "ar_credit_note"]),
          notInArray(arApDocuments.status, ["draft", "reversed"]),
          between(arApDocuments.date, addDays(today, -(DSO_WINDOW_DAYS - 1)), today)
        )
      )
      .groupBy(arApDocuments.documentType),
    db
      .select({
        thisMonth: sql<string>`coalesce(sum(case when ${arApSettlements.settlementDate} between ${thisMonth[0]} and ${thisMonth[1]} then ${settledBase} end), 0)`,
        lastMonth: sql<string>`coalesce(sum(case when ${arApSettlements.settlementDate} between ${lastMonth[0]} and ${lastMonth[1]} then ${settledBase} end), 0)`,
      })
      .from(arApSettlements)
      .innerJoin(arApDocuments, eq(arApDocuments.id, arApSettlements.documentId))
      .where(
        and(
          eq(arApSettlements.organizationId, orgId),
          eq(arApDocuments.documentType, "ar_invoice"),
          isNotNull(arApSettlements.cashDocumentId),
          gte(arApSettlements.settlementDate, lastMonth[0])
        )
      ),
    db
      .select({ documentId: arInvoiceReminders.documentId, sentAt: arInvoiceReminders.sentAt })
      .from(arInvoiceReminders)
      .where(
        and(
          eq(arInvoiceReminders.organizationId, orgId),
          eq(arInvoiceReminders.status, "sent"),
          gte(arInvoiceReminders.sentAt, new Date(Date.parse(`${addDays(today, -30)}T00:00:00+08:00`)))
        )
      ),
    loadReminderSettings(orgId),
    db
      .select({ count: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${arRecurringInvoices.totalAmount}), 0)` })
      .from(arRecurringInvoices)
      .where(
        and(
          eq(arRecurringInvoices.organizationId, orgId),
          eq(arRecurringInvoices.status, "active"),
          lte(arRecurringInvoices.nextRunDate, addDays(today, 30))
        )
      ),
  ]);

  const invoices = open
    .filter((row) => row.documentType === "ar_invoice")
    .map((row) => ({ ...row, balance: round(num(row.balance)) }));
  const receivable = round(
    open.reduce((sum, row) => sum + (row.documentType === "ar_credit_note" ? -1 : 1) * num(row.balance), 0)
  );
  const creditSales = round(
    sales.reduce((sum, row) => sum + (row.documentType === "ar_credit_note" ? -1 : 1) * num(row.total), 0)
  );

  const sent = reminders
    .filter((row) => row.sentAt)
    .map((row) => ({ documentId: row.documentId, sentDate: ubDate(row.sentAt!) }));
  const payments =
    sent.length === 0
      ? []
      : await db
          .select({ documentId: arApSettlements.documentId, date: arApSettlements.settlementDate })
          .from(arApSettlements)
          .where(
            and(
              eq(arApSettlements.organizationId, orgId),
              inArray(
                arApSettlements.documentId,
                [...new Set(sent.map((row) => row.documentId))]
              ),
              isNotNull(arApSettlements.cashDocumentId)
            )
          );

  return {
    today,
    receivable,
    dso: daysSalesOutstanding(receivable, creditSales),
    creditSales90: creditSales,
    collectedThisMonth: round(num(collected[0]?.thisMonth)),
    collectedLastMonth: round(num(collected[0]?.lastMonth)),
    expected: expectedInflow(invoices, today),
    topOverdue: topOverdueCustomers(invoices, today),
    reminders: { ...reminderEffect(sent, payments), enabled: settings.enabled },
    recurring: { count: recurring[0]?.count ?? 0, amount: round(num(recurring[0]?.amount)) },
  };
}

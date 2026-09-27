// Авлагын цуглуулалтын самбар (docs/dev/arap.md §5j) — ЦЭВЭР тооцоо (DB импортгүй,
// client-safe): DSO, хүлээгдэж буй орлого (төлөх огноогоор), хамгийн их хэтэрсэн
// харилцагчид, сануулгын үр дүн. Тест: tests/ar-collections.test.ts.

import { daysBetween } from "./reminders";

export const DSO_WINDOW_DAYS = 90;
export const REMINDER_EFFECT_DAYS = 7;

export interface OpenInvoice {
  counterpartyId: string;
  counterpartyName: string;
  dueDate: string;
  /** Нээлттэй үлдэгдэл, ₮. */
  balance: number;
}

export interface ExpectedInflow {
  overdue: number;
  overdueCount: number;
  next7: number;
  next7Count: number;
  next30: number;
  next30Count: number;
  later: number;
  laterCount: number;
}

export interface OverdueCustomer {
  counterpartyId: string;
  name: string;
  amount: number;
  invoices: number;
  maxDaysOverdue: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** DSO = авлага / сүүлийн 90 хоногийн зээлийн борлуулалт × 90 (борлуулалтгүй бол null). */
export function daysSalesOutstanding(receivable: number, creditSales: number, windowDays = DSO_WINDOW_DAYS): number | null {
  if (!(creditSales > 0.005)) return null;
  return Math.round((Math.max(receivable, 0) / creditSales) * windowDays);
}

/** Нээлттэй авлага төлөх огноогоор: хэтэрсэн / 7 хоногт / 8–30 / 30-аас хойш. */
export function expectedInflow(invoices: OpenInvoice[], today: string): ExpectedInflow {
  const out: ExpectedInflow = { overdue: 0, overdueCount: 0, next7: 0, next7Count: 0, next30: 0, next30Count: 0, later: 0, laterCount: 0 };
  for (const invoice of invoices) {
    if (!(invoice.balance > 0.005)) continue;
    const days = daysBetween(today, invoice.dueDate);
    if (days < 0) {
      out.overdue += invoice.balance;
      out.overdueCount += 1;
    } else if (days <= 7) {
      out.next7 += invoice.balance;
      out.next7Count += 1;
    } else if (days <= 30) {
      out.next30 += invoice.balance;
      out.next30Count += 1;
    } else {
      out.later += invoice.balance;
      out.laterCount += 1;
    }
  }
  return { ...out, overdue: round(out.overdue), next7: round(out.next7), next30: round(out.next30), later: round(out.later) };
}

/** Хэтэрсэн дүнгээр эрэмбэлсэн эхний `limit` харилцагч. */
export function topOverdueCustomers(invoices: OpenInvoice[], today: string, limit = 5): OverdueCustomer[] {
  const byCustomer = new Map<string, OverdueCustomer>();
  for (const invoice of invoices) {
    const overdueDays = daysBetween(invoice.dueDate, today);
    if (overdueDays <= 0 || !(invoice.balance > 0.005)) continue;
    const row = byCustomer.get(invoice.counterpartyId) ?? {
      counterpartyId: invoice.counterpartyId,
      name: invoice.counterpartyName,
      amount: 0,
      invoices: 0,
      maxDaysOverdue: 0,
    };
    row.amount = round(row.amount + invoice.balance);
    row.invoices += 1;
    row.maxDaysOverdue = Math.max(row.maxDaysOverdue, overdueDays);
    byCustomer.set(invoice.counterpartyId, row);
  }
  return [...byCustomer.values()].sort((a, b) => b.amount - a.amount || b.maxDaysOverdue - a.maxDaysOverdue).slice(0, limit);
}

/**
 * Сануулгын үр дүн: илгээсэн сануулга бүрийн дараа `REMINDER_EFFECT_DAYS`
 * хоногт тэр нэхэмжлэхэд төлбөр орсон эсэх (хувь нь жишиг — шалтгаан биш).
 */
export function reminderEffect(
  reminders: { documentId: string; sentDate: string }[],
  payments: { documentId: string; date: string }[],
  days = REMINDER_EFFECT_DAYS
): { sent: number; paid: number; rate: number | null } {
  let paid = 0;
  for (const reminder of reminders) {
    const hit = payments.some((payment) => {
      if (payment.documentId !== reminder.documentId) return false;
      const after = daysBetween(reminder.sentDate, payment.date);
      return after >= 0 && after <= days;
    });
    if (hit) paid += 1;
  }
  return { sent: reminders.length, paid, rate: reminders.length ? Math.round((paid / reminders.length) * 100) : null };
}

export interface CollectionsOverview {
  today: string;
  receivable: number;
  dso: number | null;
  creditSales90: number;
  collectedThisMonth: number;
  collectedLastMonth: number;
  expected: ExpectedInflow;
  topOverdue: OverdueCustomer[];
  reminders: { sent: number; paid: number; rate: number | null; enabled: boolean };
  recurring: { count: number; amount: number };
}

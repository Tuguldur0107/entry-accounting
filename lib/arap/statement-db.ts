// Тооцоо нийлсэн актын DB ачаалагч (docs/dev/arap.md §5i) — нэг харилцагчийн
// БАТЛАГДСАН АР/АП баримт, тэдгээрийн тооцоо (төлбөр, хасалт), нэхэмжлэхгүй
// мөнгөн гүйлгээ (урьдчилгаа) → `buildStatement`. Дүн нь MNT (гүйлгээний ханшаар).
// Server-only (orgId параметртэй) — action / API route эрхийг шалгасны дараа дуудна.

import { and, eq, inArray, isNull, lte, notInArray } from "drizzle-orm";
import { loadAdvanceApplicationVoucherIds, loadAdvanceSettings } from "@/lib/arap/advances";

import { db } from "@/lib/db";
import {
  arApDocuments,
  arApSettlements,
  cashDocuments,
  counterparties,
  journalVouchers,
  organizationProfile,
} from "@/lib/db/schema";
import { documentTypeLabel } from "@/lib/arap/document-kind";
import { extractMainAccount } from "@/lib/reports/balances";

import {
  buildStatement,
  statementConclusion,
  statementDocumentSign,
  type CounterpartyStatement,
  type StatementEntry,
} from "./statement";

export * from "./statement";

const round = (value: number) => Math.round(value * 100) / 100;

export async function loadCounterpartyStatement(
  orgId: string,
  counterpartyId: string,
  from: string,
  to: string
): Promise<CounterpartyStatement | null> {
  const counterparty = await db.query.counterparties.findFirst({
    where: and(eq(counterparties.id, counterpartyId), eq(counterparties.organizationId, orgId)),
  });
  if (!counterparty) return null;

  const documents = await db
    .select()
    .from(arApDocuments)
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.counterpartyId, counterpartyId),
        notInArray(arApDocuments.status, ["draft", "reversed"]),
        lte(arApDocuments.date, to)
      )
    );
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const baseOf = (doc: typeof arApDocuments.$inferSelect, amount: number) =>
    doc.currency === "MNT" ? amount : round(amount * Number(doc.exchangeRate || 1));

  const entries: StatementEntry[] = documents.map((doc) => ({
    date: doc.date,
    reference: doc.documentNo,
    description: `${documentTypeLabel(doc.documentType)}${doc.description ? ` — ${doc.description}` : ""}`,
    amount: statementDocumentSign(doc.documentType) * (Number(doc.baseTotalAmount) || baseOf(doc, Number(doc.totalAmount))),
    order: 0,
  }));

  if (documents.length > 0) {
    const settlements = await db
      .select({
        settlement: arApSettlements,
        cashNo: cashDocuments.documentNo,
        voucherNo: journalVouchers.documentNo,
      })
      .from(arApSettlements)
      .leftJoin(cashDocuments, eq(cashDocuments.id, arApSettlements.cashDocumentId))
      .leftJoin(journalVouchers, eq(journalVouchers.id, arApSettlements.voucherId))
      .where(
        and(
          eq(arApSettlements.organizationId, orgId),
          inArray(
            arApSettlements.documentId,
            documents.map((doc) => doc.id)
          ),
          lte(arApSettlements.settlementDate, to)
        )
      );
    // Кассгүй тооцоо (кредит нэхэмжлэлийн тооцоо, АР↔АП суутгал) нь нэг
    // voucher-т хос мөр — энэ харилцагчийн дотор нийлбэр 0 бол үлдэгдэлд
    // нөлөөгүй тул актаас хасна (хасалт г.м. ганц мөрийг үлдээнэ).
    const signed = settlements.map((row) => {
      const doc = byId.get(row.settlement.documentId)!;
      const amount = Number(row.settlement.baseAmount) || baseOf(doc, Number(row.settlement.amount));
      return { ...row, doc, signedAmount: -statementDocumentSign(doc.documentType) * amount };
    });
    // Урьдчилгааны суутгал (docs/dev/arap.md §5l) нь дотоод дахин ангилал —
    // урьдчилгааны мөнгө доорх «нэхэмжлэхгүй мөнгөн гүйлгээ»-нд аль хэдийн
    // тооцогдсон тул давхар хасахгүй.
    const applicationVouchers = await loadAdvanceApplicationVoucherIds(orgId, counterpartyId);
    const voucherNet = new Map<string, number>();
    for (const row of signed)
      if (!row.settlement.cashDocumentId && row.settlement.voucherId)
        voucherNet.set(row.settlement.voucherId, (voucherNet.get(row.settlement.voucherId) ?? 0) + row.signedAmount);
    for (const row of signed) {
      const voucherId = row.settlement.voucherId;
      if (voucherId && applicationVouchers.has(voucherId)) continue;
      if (!row.settlement.cashDocumentId && voucherId && Math.abs(voucherNet.get(voucherId) ?? 0) < 0.005) continue;
      entries.push({
        date: row.settlement.settlementDate,
        reference: row.cashNo ?? row.voucherNo ?? "—",
        description: row.settlement.cashDocumentId
          ? `${row.signedAmount < 0 ? "Төлбөр хүлээн авсан" : "Төлбөр төлсөн"} — ${row.doc.documentNo}`
          : `Тооцоо (хасалт / суутгал) — ${row.doc.documentNo}`,
        amount: row.signedAmount,
        order: 1,
      });
    }
  }

  // Нэхэмжлэхгүй мөнгөн гүйлгээ (урьдчилгаа) — харилцагчийн хяналтын данс
  // эсвэл урьдчилгааны дансны роль (урьдчилж орсон / төлсөн, §5l).
  const advanceSettings = await loadAdvanceSettings(orgId);
  const controlAccounts = new Set(
    [
      ...documents.map((doc) => doc.controlAccountNumber),
      counterparty.defaultReceivableAccountNumber,
      counterparty.defaultPayableAccountNumber,
      advanceSettings.customerAdvanceAccountNumber,
      advanceSettings.supplierAdvanceAccountNumber,
    ]
      .filter((account): account is string => !!account)
      .map(extractMainAccount)
  );
  if (controlAccounts.size > 0) {
    const cash = await db
      .select()
      .from(cashDocuments)
      .where(
        and(
          eq(cashDocuments.organizationId, orgId),
          eq(cashDocuments.counterpartyId, counterpartyId),
          eq(cashDocuments.status, "posted"),
          isNull(cashDocuments.arApDocumentId),
          inArray(cashDocuments.documentType, ["receipt", "payment"]),
          lte(cashDocuments.date, to)
        )
      );
    for (const doc of cash) {
      if (!doc.counterAccountNumber || !controlAccounts.has(extractMainAccount(doc.counterAccountNumber))) continue;
      const amount = Number(doc.baseAmount ?? doc.amount);
      entries.push({
        date: doc.date,
        reference: doc.documentNo,
        description: `${doc.documentType === "receipt" ? "Урьдчилгаа / төлбөр хүлээн авсан" : "Урьдчилгаа / төлбөр төлсөн"}${doc.description ? ` — ${doc.description}` : ""}`,
        amount: doc.documentType === "receipt" ? -amount : amount,
        order: 1,
      });
    }
  }

  const profile = await db.query.organizationProfile.findFirst({
    where: eq(organizationProfile.organizationId, orgId),
    columns: { name: true, registerNo: true, address: true, phone: true },
  });
  const statement = buildStatement(entries, from, to);
  const companyName = profile?.name || "Байгууллага";
  return {
    ...statement,
    counterparty: {
      id: counterparty.id,
      name: counterparty.name,
      registerNo: counterparty.registerNo,
      email: counterparty.email,
    },
    company: {
      name: companyName,
      registerNo: profile?.registerNo ?? null,
      address: profile?.address ?? null,
      phone: profile?.phone ?? null,
    },
    conclusion: statementConclusion(statement.closing, to, companyName, counterparty.name),
  };
}

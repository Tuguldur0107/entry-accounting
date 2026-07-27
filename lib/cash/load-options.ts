// Мөнгөн гүйлгээ бичихэд хэрэгтэй сонголтын өгөгдлийн НЭГДСЭН ачаалагч —
// transactions хуудас (Server Component) болон cash-new панелийн server
// action хоёулаа ЭНЭ функцийг дууддаг тул query давхардахгүй.
//
// Balance нь БҮХ батлагдсан баримтаас бодогдоно (дансны сонголтод харагдана);
// хуудасны жагсаалт огноогоор шүүгдсэн тусдаа query хэвээр.

import { and, eq, inArray } from "drizzle-orm";

import { calculateCashBalances } from "@/lib/cash/balances";
import type {
  CashAccountView,
  CashDocumentView,
  CashFlowOption,
  CashGlAccountOption,
} from "@/lib/cash/types";
import { db } from "@/lib/db";
import {
  arApDocuments,
  cashDocuments,
  cashAccounts,
  segmentValues,
  type CashAccount,
  type CashDocument,
} from "@/lib/db/schema";
import { loadSegmentPickerData } from "@/lib/gl/segment-picker-data";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

/** Нээлттэй (төлөгдөөгүй / хагас төлөгдсөн) АР/АП баримт — төлөлтөөр хаагдана. */
export interface CashArApSettlementTarget {
  id: string;
  documentNo: string;
  documentType: "ar_invoice" | "ap_bill";
  counterpartyName: string;
  date: string;
  currency: string;
  controlAccountNumber: string;
  balance: number;
  description: string;
}

export interface CashTransactionOptions {
  accounts: CashAccountView[];
  glAccounts: CashGlAccountOption[];
  cashFlowOptions: CashFlowOption[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  arApOpenDocuments: CashArApSettlementTarget[];
}

/** 10-part dotted кодоос үндсэн дансыг салгана (энгийн код бол өөрийг нь). */
export function mainAccountOf(accountNumber: string) {
  const parts = accountNumber.split(".");
  return parts.length === 10 ? parts[2] : accountNumber;
}

/** Хуудас + панелийн НЭГ мөрийн mapper — DB row → client view. */
export function toCashDocumentView(
  document: CashDocument & {
    fromAccount: CashAccount | null;
    toAccount: CashAccount | null;
  }
): CashDocumentView {
  return {
    id: document.id,
    documentNo: document.documentNo,
    documentType: document.documentType,
    date: document.date,
    fromCashAccountId: document.fromCashAccountId,
    fromAccountName: document.fromAccount?.name ?? null,
    toCashAccountId: document.toCashAccountId,
    toAccountName: document.toAccount?.name ?? null,
    counterAccountNumber: document.counterAccountNumber,
    cashFlowCode: document.cashFlowCode,
    counterparty: document.counterparty,
    description: document.description,
    amount: Number(document.amount),
    currency: document.currency,
    exchangeRate: Number(document.exchangeRate ?? 1),
    baseAmount: Number(document.baseAmount ?? document.amount),
    status: document.status,
    voucherId: document.voucherId,
    sourceVoucherId: document.sourceVoucherId,
  };
}

export async function loadCashTransactionOptions(
  userId: string
): Promise<CashTransactionOptions> {
  const [accounts, postedDocuments, cashFlowValues, openArApDocs, segmentData] =
    await Promise.all([
      db.query.cashAccounts.findMany({
        where: eq(cashAccounts.userId, userId),
        orderBy: (account, { asc }) => [asc(account.name)],
      }),
      // Зөвхөн balance бодоход — calculateCashBalances posted-оос бусдыг
      // алгасдаг тул статусаар нь шүүж татна.
      db.query.cashDocuments.findMany({
        where: and(
          eq(cashDocuments.userId, userId),
          eq(cashDocuments.status, "posted")
        ),
      }),
      db.query.segmentValues.findMany({
        where: and(
          eq(segmentValues.userId, userId),
          eq(segmentValues.segmentId, 8),
          eq(segmentValues.isEnabled, true)
        ),
        orderBy: (value, { asc }) => [asc(value.code)],
      }),
      // Нээлттэй АР/АП баримтууд — төлөлтийн сонголт ба `?arap=` deep link.
      db.query.arApDocuments.findMany({
        where: and(
          eq(arApDocuments.userId, userId),
          inArray(arApDocuments.status, ["posted", "partially_paid"])
        ),
        with: { counterparty: true },
        orderBy: (doc, { asc }) => [asc(doc.dueDate), asc(doc.date)],
      }),
      loadSegmentPickerData(userId),
    ]);

  const balanceMap = calculateCashBalances(accounts, postedDocuments);

  return {
    accounts: accounts.map((account) => ({
      ...account,
      openingBalance: Number(account.openingBalance),
      balance: balanceMap.get(account.id) ?? 0,
    })),
    // S3 сонголт = идэвхтэй дансны жагсаалт (number-ээр эрэмбэлэгдсэн) —
    // тусдаа chartOfAccounts query давтахгүй.
    glAccounts: (segmentData.segmentOptions[3] ?? []).map((option) => ({
      number: option.code,
      name: option.name,
    })),
    cashFlowOptions: cashFlowValues.map((option) => ({
      code: option.code,
      name: option.name,
    })),
    activeSegIds: segmentData.activeSegIds,
    segmentOptions: segmentData.segmentOptions,
    defaultSegments: segmentData.defaultSegments,
    arApOpenDocuments: openArApDocs.map((doc) => ({
      id: doc.id,
      documentNo: doc.documentNo,
      documentType: doc.documentType as "ar_invoice" | "ap_bill",
      counterpartyName: doc.counterparty.name,
      date: doc.date,
      currency: doc.currency,
      controlAccountNumber: mainAccountOf(doc.controlAccountNumber),
      balance:
        Math.round(
          (Number(doc.totalAmount) - Number(doc.paidAmount)) * 100
        ) / 100,
      description: doc.description,
    })),
  };
}

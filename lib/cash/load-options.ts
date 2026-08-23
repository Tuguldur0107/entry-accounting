// Нэг эх сурвалж: үндсэн дансны салгагч. Хуучин нэрээр re-export.
export { extractMainAccount as mainAccountOf } from "@/lib/reports/balances";
import { extractMainAccount } from "@/lib/reports/balances";
// Мөнгөн гүйлгээ бичихэд хэрэгтэй сонголтын өгөгдлийн НЭГДСЭН ачаалагч —
// transactions хуудас (Server Component) болон cash-new панелийн server
// action хоёулаа ЭНЭ функцийг дууддаг тул query давхардахгүй.
//
// Balance нь БҮХ батлагдсан баримтаас бодогдоно (дансны сонголтод харагдана);
// хуудасны жагсаалт огноогоор шүүгдсэн тусдаа query хэвээр.

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

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

// Фаз 01 multi-tenancy: параметр нь идэвхтэй байгууллагын ID (orgId).
export async function loadCashTransactionOptions(
  orgId: string
): Promise<CashTransactionOptions> {
  const [accounts, outflows, inflows, cashFlowValues, openArApDocs, segmentData] =
    await Promise.all([
      db.query.cashAccounts.findMany({
        where: eq(cashAccounts.organizationId, orgId),
        orderBy: (account, { asc }) => [asc(account.name)],
      }),
      // Balance = нээлт + орлого − зарлага. Баримт бүрийг клиент рүү татаж
      // давтахын оронд SQL-ээр данс тус бүрд нийлбэрлэнэ (баримтын тоо
      // өссөн ч энэ хоёр query тогтмол жинтэй). Семантик нь
      // calculateCashBalances-тай яг ижил: payment/transfer → from дансаас
      // хасна, receipt/transfer → to дансанд нэмнэ, зөвхөн posted.
      db
        .select({
          accountId: cashDocuments.fromCashAccountId,
          total: sql<string>`sum(${cashDocuments.amount})`,
        })
        .from(cashDocuments)
        .where(
          and(
            eq(cashDocuments.organizationId, orgId),
            eq(cashDocuments.status, "posted"),
            inArray(cashDocuments.documentType, ["payment", "transfer"]),
            isNotNull(cashDocuments.fromCashAccountId)
          )
        )
        .groupBy(cashDocuments.fromCashAccountId),
      db
        .select({
          accountId: cashDocuments.toCashAccountId,
          total: sql<string>`sum(${cashDocuments.amount})`,
        })
        .from(cashDocuments)
        .where(
          and(
            eq(cashDocuments.organizationId, orgId),
            eq(cashDocuments.status, "posted"),
            inArray(cashDocuments.documentType, ["receipt", "transfer"]),
            isNotNull(cashDocuments.toCashAccountId)
          )
        )
        .groupBy(cashDocuments.toCashAccountId),
      db.query.segmentValues.findMany({
        where: and(
          eq(segmentValues.organizationId, orgId),
          eq(segmentValues.segmentId, 8),
          eq(segmentValues.isEnabled, true)
        ),
        orderBy: (value, { asc }) => [asc(value.code)],
      }),
      // Нээлттэй АР/АП баримтууд — төлөлтийн сонголт ба `?arap=` deep link.
      db.query.arApDocuments.findMany({
        where: and(
          eq(arApDocuments.organizationId, orgId),
          inArray(arApDocuments.status, ["posted", "partially_paid"])
        ),
        with: { counterparty: true },
        orderBy: (doc, { asc }) => [asc(doc.dueDate), asc(doc.date)],
      }),
      loadSegmentPickerData(orgId),
    ]);

  const balanceMap = new Map(
    accounts.map((account) => [account.id, Number(account.openingBalance)])
  );
  for (const row of outflows) {
    if (!row.accountId) continue;
    balanceMap.set(
      row.accountId,
      (balanceMap.get(row.accountId) ?? 0) - Number(row.total ?? 0)
    );
  }
  for (const row of inflows) {
    if (!row.accountId) continue;
    balanceMap.set(
      row.accountId,
      (balanceMap.get(row.accountId) ?? 0) + Number(row.total ?? 0)
    );
  }

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
      controlAccountNumber: extractMainAccount(doc.controlAccountNumber),
      balance:
        Math.round(
          (Number(doc.totalAmount) - Number(doc.paidAmount)) * 100
        ) / 100,
      description: doc.description,
    })),
  };
}

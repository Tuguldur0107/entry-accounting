// Нэг эх сурвалж: үндсэн дансны салгагч. Хуучин нэрээр re-export.
export { extractMainAccount as mainAccountOf } from "@/lib/reports/balances";
import type { ArApDocumentType } from "@/lib/arap/document-kind";
import { extractMainAccount } from "@/lib/reports/balances";
// Мөнгөн гүйлгээ бичихэд хэрэгтэй сонголтын өгөгдлийн НЭГДСЭН ачаалагч —
// transactions хуудас (Server Component) болон cash-new панелийн server
// action хоёулаа ЭНЭ функцийг дууддаг тул query давхардахгүй.
//
// Balance нь БҮХ батлагдсан баримтаас бодогдоно (дансны сонголтод харагдана);
// хуудасны жагсаалт огноогоор шүүгдсэн тусдаа query хэвээр.

import { and, eq, inArray } from "drizzle-orm";

import type { CounterpartyView } from "@/lib/arap/types";
import { loadArApCounterparties } from "@/lib/arap/load-data";
import { cashAccountGlLabel } from "@/lib/cash/list-columns";
import type {
  CashAccountView,
  CashDocumentView,
  CashFlowOption,
  CashGlAccountOption,
} from "@/lib/cash/types";
import { loadCashBalancesFast } from "@/lib/cash/period-balances";
import { db } from "@/lib/db";
import {
  arApDocuments,
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
  documentType: ArApDocumentType;
  counterpartyId: string;
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
  /** Харилцагчийн бүртгэл — cash-new формын сонгогч (CounterpartySelect). */
  counterparties: CounterpartyView[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  arApOpenDocuments: CashArApSettlementTarget[];
}


/** Мөрийн mapper-ийн оролт — `with: { fromAccount, toAccount, counterpartyRef, voucher }`. */
export type CashDocumentRow = CashDocument & {
  fromAccount: CashAccount | null;
  toAccount: CashAccount | null;
  /** Харилцагчийн бүртгэл (сонголтоор — дашбоард ачаалахгүй байж болно). */
  counterpartyRef?: { name: string; code: string | null } | null;
  /** Холбогдсон GL журнал — дугаар нь "Журналын дугаар" багана. */
  voucher?: { documentNo: string | null } | null;
};

/**
 * Хуудас + панелийн НЭГ мөрийн mapper — DB row → client view.
 * `cashFlowNames` = S8 код → нэр (МГ нэр багана); өгөхгүй бол null.
 */
export function toCashDocumentView(
  document: CashDocumentRow,
  cashFlowNames?: ReadonlyMap<string, string>
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
    cashFlowName:
      (document.cashFlowCode && cashFlowNames?.get(document.cashFlowCode)) ||
      null,
    // Бүртгэлтэй харилцагчийн нэр нь бүртгэлээс (нэр солигдвол дагана).
    counterparty: document.counterpartyRef?.name ?? document.counterparty,
    counterpartyId: document.counterpartyId,
    counterpartyCode: document.counterpartyRef?.code ?? null,
    cashAccountGlNumber: cashAccountGlLabel({
      documentType: document.documentType,
      fromGlNumber: document.fromAccount?.glAccountNumber ?? null,
      toGlNumber: document.toAccount?.glAccountNumber ?? null,
    }),
    description: document.description,
    amount: Number(document.amount),
    currency: document.currency,
    exchangeRate: Number(document.exchangeRate ?? 1),
    baseAmount: Number(document.baseAmount ?? document.amount),
    status: document.status,
    voucherId: document.voucherId,
    voucherNo: document.voucher?.documentNo ?? null,
    sourceVoucherId: document.sourceVoucherId,
  };
}

/** Жагсаалтын query-д ӨГӨХ `with` — mapper-ийн шаарддаг холбоосууд НЭГ газар. */
export const CASH_DOCUMENT_LIST_WITH = {
  fromAccount: true,
  toAccount: true,
  counterpartyRef: { columns: { name: true, code: true } },
  voucher: { columns: { documentNo: true } },
} as const;

// Фаз 01 multi-tenancy: параметр нь идэвхтэй байгууллагын ID (orgId).
export async function loadCashTransactionOptions(
  orgId: string
): Promise<CashTransactionOptions> {
  const [accounts, cashFlowValues, openArApDocs, segmentData, counterpartyList] =
    await Promise.all([
      db.query.cashAccounts.findMany({
        where: eq(cashAccounts.organizationId, orgId),
        orderBy: (account, { asc }) => [asc(account.name)],
      }),
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
      loadArApCounterparties(orgId),
    ]);

  // Үлдэгдэл = snapshot + delta (lib/cash/period-balances.ts) — семантик
  // calculateCashBalances-тай ижил, баримт JS-д ачаалагдахгүй.
  const balanceMap = await loadCashBalancesFast(orgId, accounts);

  return {
    accounts: accounts.map((account) => ({
      ...account,
      openingBalance: Number(account.openingBalance),
      openingRate: account.openingRate === null ? null : Number(account.openingRate),
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
    counterparties: counterpartyList,
    activeSegIds: segmentData.activeSegIds,
    segmentOptions: segmentData.segmentOptions,
    defaultSegments: segmentData.defaultSegments,
    arApOpenDocuments: openArApDocs.map((doc) => ({
      id: doc.id,
      documentNo: doc.documentNo,
      documentType: doc.documentType as ArApDocumentType,
      counterpartyId: doc.counterpartyId,
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

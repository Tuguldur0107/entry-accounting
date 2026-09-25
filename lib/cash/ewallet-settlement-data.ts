// Э-хэтэвчийн settlement-ийн ЛАВЛАХ дата (DB) — саналын endpoint, хуулгын
// хадгалалт (import-statement.ts), MCP import_bank_statement гурвуулаа ЭНЭ
// loader-ийг дуудна. Тулгалтын логик нь lib/cash/ewallet-settlement.ts (ЦЭВЭР).

import { and, eq, inArray } from "drizzle-orm";

import {
  unsettledReceipts,
  type EwalletSettlementMethod,
} from "@/lib/cash/ewallet-settlement";
import { db } from "@/lib/db";
import { cashDocuments, posPaymentMethods } from "@/lib/db/schema";
import { ensurePosSettings } from "@/lib/pos/load-data";

export type EwalletSettlementContext = {
  methods: EwalletSettlementMethod[];
  /** Шимтгэлийн зардлын данс (pos_settings.ewalletFeeAccountNumber). */
  feeAccountNumber: string;
};

/**
 * Идэвхтэй `ewallet` хэлбэрүүд (түр данстай) + тус бүрийн түр дансны
 * тулгагдаагүй орлогууд. Түр дансны үлдэгдэлд суурилсан FIFO: орлого (posted
 * receipt → түр данс) − гарсан (payment / transfer ← түр данс) = тулгагдаагүй.
 * Нэг түр дансыг хэд хэдэн хэлбэр хуваалцаж болно — данс бүрд нэг л удаа уншина.
 */
export async function loadEwalletSettlementContext(
  orgId: string
): Promise<EwalletSettlementContext> {
  const [settings, methodRows] = await Promise.all([
    ensurePosSettings(orgId),
    db.query.posPaymentMethods.findMany({
      where: and(
        eq(posPaymentMethods.organizationId, orgId),
        eq(posPaymentMethods.kind, "ewallet"),
        eq(posPaymentMethods.isActive, true)
      ),
      with: { cashAccount: true },
    }),
  ]);
  const linked = methodRows.filter(
    (row) => row.cashAccountId && row.cashAccount && row.cashAccount.isActive
  );
  const cashAccountIds = [...new Set(linked.map((row) => row.cashAccountId as string))];
  if (cashAccountIds.length === 0) return { methods: [], feeAccountNumber: settings.ewalletFeeAccountNumber };

  const docs = await db.query.cashDocuments.findMany({
    where: and(
      eq(cashDocuments.organizationId, orgId),
      eq(cashDocuments.status, "posted"),
      inArray(cashDocuments.toCashAccountId, cashAccountIds)
    ),
    columns: { id: true, date: true, amount: true, documentType: true, toCashAccountId: true },
  });
  const outflows = await db.query.cashDocuments.findMany({
    where: and(
      eq(cashDocuments.organizationId, orgId),
      eq(cashDocuments.status, "posted"),
      inArray(cashDocuments.fromCashAccountId, cashAccountIds)
    ),
    columns: { amount: true, fromCashAccountId: true },
  });

  const receiptsByAccount = new Map<string, { id: string; date: string; amount: number }[]>();
  for (const doc of docs) {
    // Түр данс руу орсон бүх орлого (POS-ийн QPay + гар залруулга); түр данс
    // руу ШИЛЖҮҮЛЭГ орох нь ховор — мөн орлого гэж тоолно.
    const list = receiptsByAccount.get(doc.toCashAccountId as string) ?? [];
    list.push({ id: doc.id, date: doc.date, amount: Number(doc.amount) });
    receiptsByAccount.set(doc.toCashAccountId as string, list);
  }
  const settledByAccount = new Map<string, number>();
  for (const doc of outflows) {
    const key = doc.fromCashAccountId as string;
    settledByAccount.set(key, (settledByAccount.get(key) ?? 0) + Number(doc.amount));
  }

  const methods: EwalletSettlementMethod[] = linked.map((row) => {
    const cashAccountId = row.cashAccountId as string;
    return {
      paymentMethodId: row.id,
      methodCode: row.code,
      methodName: row.name,
      provider: row.provider ?? null,
      cashAccountId,
      cashAccountName: row.cashAccount!.name,
      glAccountNumber: row.cashAccount!.glAccountNumber,
      feePercent: row.feePercent == null ? null : Number(row.feePercent),
      openReceipts: unsettledReceipts(
        receiptsByAccount.get(cashAccountId) ?? [],
        settledByAccount.get(cashAccountId) ?? 0
      ),
    };
  });
  return { methods, feeAccountNumber: settings.ewalletFeeAccountNumber };
}

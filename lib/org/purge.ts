// Байгууллагыг бүх өгөгдлийнх нь хамт устгах — ЦОРЫН ГАНЦ зам (DB давхарга).
// Дараалал ба шалтгаан: lib/org/purge-order.ts. Эрх, нэрийн баталгаажуулалт,
// лог нь дуудагчид (lib/actions/org.ts, demo.ts) — энд шалгахгүй.

import { eq, getTableName } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  arApDocuments,
  arApSettlements,
  arapWriteOffs,
  bankStatements,
  cashDocuments,
  cashFxRevaluations,
  costAllocations,
  costEntries,
  faDepreciationEntries,
  goodsReceipts,
  inventoryMovements,
  organizations,
  payrollRuns,
  posSales,
  posShifts,
  posStoreCredits,
  purchaseOrders,
} from "@/lib/db/schema";
import { ORG_PURGE_ORDER, type OrgPurgeTable } from "./purge-order";

/** Хүснэгтийн нэр → drizzle объект. Түлхүүр нь ORG_PURGE_ORDER-тэй ЯГ тэнцүү (төрлөөр). */
const PURGE_TABLES = {
  pos_sales: posSales,
  pos_store_credits: posStoreCredits,
  pos_shifts: posShifts,
  cost_allocations: costAllocations,
  cost_entries: costEntries,
  arap_write_offs: arapWriteOffs,
  ar_ap_settlements: arApSettlements,
  cash_fx_revaluations: cashFxRevaluations,
  cash_documents: cashDocuments,
  bank_statements: bankStatements,
  goods_receipts: goodsReceipts,
  ar_ap_documents: arApDocuments,
  purchase_orders: purchaseOrders,
  inventory_movements: inventoryMovements,
  payroll_runs: payrollRuns,
  fa_depreciation_entries: faDepreciationEntries,
} satisfies Record<OrgPurgeTable, unknown>;

for (const [name, table] of Object.entries(PURGE_TABLES)) {
  if (getTableName(table) !== name)
    throw new Error(`PURGE_TABLES: "${name}" ≠ ${getTableName(table)}`);
}

/**
 * Байгууллага ба түүний БҮХ өгөгдлийг НЭГ транзакцаар устгана: гүйлгээний
 * хүснэгтүүдийг `ORG_PURGE_ORDER` дарааллаар, үлдсэнийг байгууллагын
 * cascade-аар. Аль нэг алхам унавал юу ч устгагдахгүй.
 */
export async function purgeOrganization(orgId: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const name of ORG_PURGE_ORDER) {
      const table = PURGE_TABLES[name];
      await tx.delete(table).where(eq(table.organizationId, orgId));
    }
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });
}

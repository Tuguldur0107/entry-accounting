// Журнал → кассын баримтын S8 (мөнгөн гүйлгээний ангилал) код — SIM2-043.
// S8 сегмент идэвхгүй байгууллагад код журналын мөрөнд ордоггүй тул
// мөнгөн гүйлгээний тайлан кассын баримтаас уншина. Буцаалтын журнал эхийнхээ
// кодыг авна (урсгал нь эсрэг тэмдгээр ИЖИЛ мөрөнд). Plain server модуль.

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { cashDocuments } from "@/lib/db/schema";

export async function loadVoucherCfCodes(orgId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({
      voucherId: cashDocuments.voucherId,
      reversalVoucherId: cashDocuments.reversalVoucherId,
      code: cashDocuments.cashFlowCode,
    })
    .from(cashDocuments)
    .where(and(eq(cashDocuments.organizationId, orgId), isNotNull(cashDocuments.cashFlowCode)));
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (!row.code) continue;
    if (row.voucherId) map[row.voucherId] = row.code;
    if (row.reversalVoucherId) map[row.reversalVoucherId] = row.code;
  }
  return map;
}

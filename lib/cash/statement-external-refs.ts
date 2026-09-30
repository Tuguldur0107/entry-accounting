// Банкны API-аас татсан хуулгын мөрийн давхардлын шалгалт (externalRef) —
// татах (lib/bank/golomt/connection.ts) ба хадгалах (import-statement.ts) хоёул
// ЭНЭ НЭГ функцээр. Шалгалт байгууллагын түвшинд.

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { bankStatementLines, bankStatements } from "@/lib/db/schema";

export async function loadImportedExternalRefs(
  orgId: string,
  refs: string[]
): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = [...new Set(refs.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 500) {
    const chunk = unique.slice(index, index + 500);
    const rows = await db
      .select({ ref: bankStatementLines.externalRef })
      .from(bankStatementLines)
      .innerJoin(
        bankStatements,
        eq(bankStatements.id, bankStatementLines.statementId)
      )
      .where(
        and(
          eq(bankStatements.organizationId, orgId),
          inArray(bankStatementLines.externalRef, chunk)
        )
      );
    for (const row of rows) if (row.ref) found.add(row.ref);
  }
  return found;
}

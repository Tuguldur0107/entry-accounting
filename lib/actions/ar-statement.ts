"use server";

// Тооцоо нийлсэн акт (docs/dev/arap.md §5i) — нэг харилцагчийн авлага + өглөгийн
// нэгдсэн хуулга. PDF нь /api/arap/statement.

import { and, eq } from "drizzle-orm";

import { actionError, type ActionResult } from "@/lib/action-result";
import { requireAnyModuleAction } from "@/lib/auth";
import { loadCounterpartyStatement, type CounterpartyStatement } from "@/lib/arap/statement-db";
import { db } from "@/lib/db";
import { counterparties } from "@/lib/db/schema";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function getCounterpartyStatement(
  counterpartyId: string,
  from: string,
  to: string
): Promise<ActionResult<{ statement: CounterpartyStatement }>> {
  try {
    const { orgId } = await requireAnyModuleAction([["ar", "read"], ["ap", "read"]]);
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return { error: "Огнооны муж буруу" };
    const statement = await loadCounterpartyStatement(orgId, counterpartyId, from, to);
    if (!statement) return { error: "Харилцагч олдсонгүй" };
    return { statement };
  } catch (caught) {
    return actionError("getCounterpartyStatement", caught, "Акт уншигдсангүй");
  }
}

/** Актын харилцагч сонгогч — идэвхтэй харилцагчид (нэр, төрөл). */
export async function listStatementCounterparties(): Promise<
  ActionResult<{ counterparties: { id: string; name: string; type: string }[] }>
> {
  try {
    const { orgId } = await requireAnyModuleAction([["ar", "read"], ["ap", "read"]]);
    const rows = await db
      .select({ id: counterparties.id, name: counterparties.name, type: counterparties.counterpartyType })
      .from(counterparties)
      .where(and(eq(counterparties.organizationId, orgId), eq(counterparties.isActive, true)))
      .orderBy(counterparties.name);
    return { counterparties: rows };
  } catch (caught) {
    return actionError("listStatementCounterparties", caught, "Харилцагч уншигдсангүй");
  }
}

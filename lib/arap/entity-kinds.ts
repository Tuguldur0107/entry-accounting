// Харилцагчийн ДИНАМИК төрлийн DB давхарга ("use server" БИШ — action, AI
// tool, ачаалагч бүгд шууд дуудна). Цэвэр логик: lib/arap/counterparty-kind.ts.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { counterpartyEntityKinds } from "@/lib/db/schema";
import { resolveEntityKinds, type EntityKindOption } from "./counterparty-kind";

/** Байгууллагын төрлүүд (систем 2 + нэмсэн) — мөргүй бол зөвхөн систем. */
export async function loadEntityKinds(orgId: string): Promise<EntityKindOption[]> {
  const rows = await db.query.counterpartyEntityKinds.findMany({
    where: eq(counterpartyEntityKinds.organizationId, orgId),
    columns: { code: true, name: true, baseKind: true, isActive: true, sortOrder: true },
  });
  return resolveEntityKinds(rows);
}

import { and, asc, eq } from "drizzle-orm";

import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  counterparties,
  inventoryItems,
} from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * П5 — палитр/picker-ийн лавлах дата: идэвхтэй данс, харилцагч, бараа.
 * Клиент талд lib/reference/client-cache.ts нэг удаа ачаалж кэшилнэ.
 */
export async function GET() {
  let orgId: string;
  try {
    ({ orgId } = await getActiveOrg());
  } catch {
    return Response.json({ error: "Нэвтрэх шаардлагатай" }, { status: 401 });
  }

  try {
    const [accounts, partners, items] = await Promise.all([
      db.query.chartOfAccounts.findMany({
        where: and(
          eq(chartOfAccounts.organizationId, orgId),
          eq(chartOfAccounts.isEnabled, true)
        ),
        columns: { number: true, name: true },
        orderBy: [asc(chartOfAccounts.number)],
      }),
      db.query.counterparties.findMany({
        where: and(
          eq(counterparties.organizationId, orgId),
          eq(counterparties.isActive, true)
        ),
        columns: { id: true, name: true, counterpartyType: true },
        orderBy: [asc(counterparties.name)],
        limit: 2000,
      }),
      db.query.inventoryItems.findMany({
        where: and(
          eq(inventoryItems.organizationId, orgId),
          eq(inventoryItems.isActive, true)
        ),
        columns: { id: true, code: true, name: true },
        orderBy: [asc(inventoryItems.code)],
        limit: 2000,
      }),
    ]);

    return Response.json({
      accounts,
      counterparties: partners,
      items,
    });
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Лавлах ачаалж чадсангүй";
    return Response.json({ error: message }, { status: 400 });
  }
}

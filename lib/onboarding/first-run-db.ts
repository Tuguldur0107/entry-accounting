// Анхны туршилтын картын DB давхарга — дохиог ХӨНГӨН exists асуулгаар уншина
// (нүүр хуудас бүрд ачаалагддаг). Шийдвэр нь ЦЭВЭР first-run.ts-д.

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { apiTokens, counterparties, employees, inventoryItems, oauthTokens, users } from "@/lib/db/schema";
import { DEMO_ORG_NAME, type FirstRunSignals } from "./first-run";

/**
 * Хэрэглэгчийн түвшний дохио (ChatGPT / Claude-ийн холболт — OAuth ба token, АЛЬ Ч
 * байгууллагад; хаасан эсэх) + одоогийн байгууллагын мастер дата. Журнал бий
 * эсэх, туршилт эсэхийг дуудагч өгнө (нүүр хуудас аль хэдийн уншсан).
 */
export async function loadFirstRunSignals(input: {
  userId: string;
  orgId: string;
  orgName: string | null;
  orgHasActivity: boolean;
  isTrial: boolean;
}): Promise<FirstRunSignals> {
  const { userId, orgId } = input;
  const [flagsRows, user] = await Promise.all([
    // Хоёр EXISTS-ийг НЭГ асуулгаар — индекстэй (user_id / organization_id) шалгалт.
    db.execute(sql`
      select
        (exists (select 1 from ${oauthTokens} where ${oauthTokens.userId} = ${userId})
          or exists (select 1 from ${apiTokens} where ${apiTokens.userId} = ${userId})) as "connected",
        (exists (select 1 from ${counterparties} where ${counterparties.organizationId} = ${orgId})
          or exists (select 1 from ${inventoryItems} where ${inventoryItems.organizationId} = ${orgId})
          or exists (select 1 from ${employees} where ${employees.organizationId} = ${orgId})) as "masterData"
    `),
    db.query.users.findFirst({
      where: and(eq(users.id, userId), isNotNull(users.welcomeDismissedAt)),
      columns: { id: true },
    }),
  ]);
  const flags = (flagsRows as unknown as { connected: boolean; masterData: boolean }[])[0];
  return {
    isDemoOrg: input.orgName === DEMO_ORG_NAME,
    connected: flags?.connected === true,
    orgHasMasterData: flags?.masterData === true,
    orgHasActivity: input.orgHasActivity,
    isTrial: input.isTrial,
    dismissed: !!user,
  };
}

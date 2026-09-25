// Анхны туршилтын картын DB давхарга — дохиог ХӨНГӨН exists/count асуулгаар
// уншина (нүүр хуудас бүрд ачаалагддаг). Шийдвэр нь ЦЭВЭР first-run.ts-д.

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { apiTokens, memberships, oauthTokens, organizations, users } from "@/lib/db/schema";
import { DEMO_ORG_NAME, type FirstRunSignals } from "./first-run";

/**
 * Хэрэглэгчийн түвшний дохио: демо компанийн гишүүнчлэл, ChatGPT / Claude-ийн
 * холболт (OAuth ба token — АЛЬ Ч байгууллагад), MCP-ийн анхны дуудлага, хаасан
 * эсэх. Байгууллагын түвшний (идэвхжил, туршилт, демо мөн эсэх) нь дуудагчаас.
 */
export async function loadFirstRunSignals(input: {
  userId: string;
  orgName: string | null;
  orgHasActivity: boolean;
  isTrial: boolean;
}): Promise<FirstRunSignals> {
  const { userId } = input;
  const [[demo], [oauth], [pat], user] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.userId, userId), eq(organizations.name, DEMO_ORG_NAME))),
    db
      .select({
        n: sql<number>`count(*)::int`,
        used: sql<number>`count(*) filter (where ${oauthTokens.lastUsedAt} is not null)::int`,
      })
      .from(oauthTokens)
      .where(eq(oauthTokens.userId, userId)),
    db
      .select({
        n: sql<number>`count(*)::int`,
        used: sql<number>`count(*) filter (where ${apiTokens.lastUsedAt} is not null)::int`,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId)),
    db.query.users.findFirst({
      where: and(eq(users.id, userId), isNotNull(users.welcomeDismissedAt)),
      columns: { id: true },
    }),
  ]);
  return {
    hasDemoOrg: (demo?.n ?? 0) > 0,
    isDemoOrg: input.orgName === DEMO_ORG_NAME,
    orgHasActivity: input.orgHasActivity,
    connected: (oauth?.n ?? 0) + (pat?.n ?? 0) > 0,
    toolUsed: (oauth?.used ?? 0) + (pat?.used ?? 0) > 0,
    isTrial: input.isTrial,
    dismissed: !!user,
  };
}

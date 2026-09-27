// «AI холболт» хуудасны холболтын төлөв — DB давхарга. Шийдвэр ЦЭВЭР
// lib/ai/connector-clients.ts-д (ангилал, нэгтгэл). OAuth нь байгууллагад
// уягддаг тул ЭНЭ хэрэглэгч × ЭНЭ байгууллагын token-ууд л.

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { oauthClients, oauthTokens } from "@/lib/db/schema";
import { summarizeAiConnections, type AiConnectionView } from "./connector-clients";

export async function loadAiConnections(userId: string, orgId: string): Promise<AiConnectionView[]> {
  const rows = await db
    .select({
      clientName: oauthClients.name,
      redirectUris: oauthClients.redirectUris,
      createdAt: oauthTokens.createdAt,
      lastUsedAt: oauthTokens.lastUsedAt,
    })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthTokens.clientId))
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.organizationId, orgId)));
  return summarizeAiConnections(
    rows.map((row) => ({
      clientName: row.clientName,
      redirectUris: row.redirectUris,
      createdAt: row.createdAt ? row.createdAt.toISOString() : null,
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    }))
  );
}

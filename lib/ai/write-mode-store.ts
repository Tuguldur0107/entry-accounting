// AI бичилтийн горимын DB давхарга (ЭНГИЙН модуль, "use server" БИШ) —
// MCP server, REST v1, /ai хуудас гурвуул НЭГ уншигчаар. Эрхийн шалгалт
// БАЙХГҮЙ — дуудагч (token context / getActiveOrg) хариуцна.
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";

import { DEFAULT_AI_WRITE_MODE, isAiWriteMode, type AiWriteMode } from "./write-mode";

export async function loadAiWriteMode(userId: string, orgId: string): Promise<AiWriteMode> {
  const settings = await db.query.aiSettings.findFirst({
    where: and(eq(aiSettings.userId, userId), eq(aiSettings.organizationId, orgId)),
    columns: { writeMode: true },
  });
  return settings && isAiWriteMode(settings.writeMode) ? settings.writeMode : DEFAULT_AI_WRITE_MODE;
}

export async function storeAiWriteMode(userId: string, orgId: string, mode: AiWriteMode): Promise<void> {
  await db
    .insert(aiSettings)
    .values({ userId, organizationId: orgId, writeMode: mode, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [aiSettings.userId, aiSettings.organizationId],
      set: { writeMode: mode, updatedAt: new Date() },
    });
}

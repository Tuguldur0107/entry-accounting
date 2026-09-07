import { eq } from "drizzle-orm";

import { ModuleSettings } from "@/components/settings/module-settings";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { moduleConfigs } from "@/lib/db/schema";

// Модулийн тохиргоо — Ерөнхий журналын тохиргооноос тусдаа хуудас
// (систем-түвшний сонголт, дансны тохиргоо биш).

export default async function ModuleSettingsPage() {
  const { orgId } = await getActiveOrg();
  const configs = await db.query.moduleConfigs.findMany({
    where: eq(moduleConfigs.organizationId, orgId),
    columns: { moduleKey: true, isEnabled: true },
  });
  return <ModuleSettings configs={configs} />;
}

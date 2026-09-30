import { AiConnectView } from "@/components/ai/ai-connect-view";
import { aiAccountantStatus } from "@/lib/ai/accountant-setup";
import { listApiTokens } from "@/lib/actions/mcp-tokens";
import { resolveAiPostLimit } from "@/lib/ai/post-limit";
import { loadAiWriteMode } from "@/lib/ai/write-mode-store";
import { loadAiConnections } from "@/lib/ai/connector-status";
import { getActiveOrg, requireModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationProfile, organizations } from "@/lib/db/schema";
import { mcpEndpointUrl } from "@/lib/mcp/endpoint";
import { hasFeature } from "@/lib/billing/entitlements";
import { getEntitlements } from "@/lib/billing/load";
import { KNOWLEDGE_DAILY_READ_LIMIT } from "@/lib/knowledge/catalog";
import { countKnowledgeReadsToday, knowledgeStats } from "@/lib/knowledge/store";
import { startersFor } from "@/lib/onboarding/first-run";
import { eq } from "drizzle-orm";

/**
 * /settings/ai — «AI холболт» (ChatGPT / Claude-д MCP-ээр холбох, «AI нягтлан»
 * — багцад үнэгүй мэдлэгийн сан + төслийн заавар, бичилтийн горим, token).
 */
export default async function AiConnectPage() {
  const { userId, orgId } = await getActiveOrg();
  const [mcpUrl, writeMode, mcpTokens, canWrite, profile, entitlements, aiConnections, org, readsToday, stats] = await Promise.all([
    mcpEndpointUrl(),
    loadAiWriteMode(userId, orgId),
    listApiTokens(),
    requireModuleAction("ai", "write").then(
      () => true,
      () => false
    ),
    db.query.organizationProfile.findFirst({
      where: eq(organizationProfile.organizationId, orgId),
      columns: { aiPostLimitMnt: true },
    }),
    getEntitlements(orgId),
    loadAiConnections(userId, orgId),
    db.query.organizations.findFirst({ where: eq(organizations.id, orgId), columns: { name: true } }),
    countKnowledgeReadsToday(orgId),
    knowledgeStats(),
  ]);

  return (
    <AiConnectView
      mcpUrl={mcpUrl}
      writeMode={writeMode}
      canWrite={canWrite}
      postLimitMnt={resolveAiPostLimit(profile?.aiPostLimitMnt)}
      mcpTokens={mcpTokens}
      aiConnections={aiConnections}
      orgName={org?.name ?? null}
      aiAccountant={aiAccountantStatus({
        ent: entitlements,
        readsToday,
        dailyLimit: KNOWLEDGE_DAILY_READ_LIMIT,
        sections: stats.sections,
      })}
      starterPrompts={startersFor({
        accounting: hasFeature(entitlements, "accounting"),
        knowledge: hasFeature(entitlements, "knowledge"),
      })}
    />
  );
}

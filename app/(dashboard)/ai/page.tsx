import { AiConnectView } from "@/components/ai/ai-connect-view";
import { listApiTokens } from "@/lib/actions/mcp-tokens";
import { resolveAiPostLimit } from "@/lib/ai/post-limit";
import { loadAiWriteMode } from "@/lib/ai/write-mode-store";
import { getActiveOrg, requireModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationProfile } from "@/lib/db/schema";
import { mcpEndpointUrl } from "@/lib/mcp/endpoint";
import { hasFeature } from "@/lib/billing/entitlements";
import { getEntitlements } from "@/lib/billing/load";
import { startersFor } from "@/lib/onboarding/first-run";
import { eq } from "drizzle-orm";

/** /ai — «AI холболт» (ChatGPT / Claude-д MCP-ээр холбох, бичилтийн горим, token). */
export default async function AiConnectPage() {
  const { userId, orgId } = await getActiveOrg();
  const [mcpUrl, writeMode, mcpTokens, canWrite, profile, entitlements] = await Promise.all([
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
  ]);

  return (
    <AiConnectView
      mcpUrl={mcpUrl}
      writeMode={writeMode}
      canWrite={canWrite}
      postLimitMnt={resolveAiPostLimit(profile?.aiPostLimitMnt)}
      mcpTokens={mcpTokens}
      starterPrompts={startersFor({
        accounting: hasFeature(entitlements, "accounting"),
        knowledge: hasFeature(entitlements, "knowledge"),
      })}
    />
  );
}

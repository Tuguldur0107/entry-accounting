"use server";

// Авлагын цуглуулалтын самбар (docs/dev/arap.md §5j) — уншилт л.

import { actionError, type ActionResult } from "@/lib/action-result";
import { requireModuleAction } from "@/lib/auth";
import { loadCollectionsOverview, type CollectionsOverview } from "@/lib/arap/collections-db";

export async function getCollectionsOverview(): Promise<ActionResult<{ overview: CollectionsOverview }>> {
  try {
    const { orgId } = await requireModuleAction("ar", "read");
    return { overview: await loadCollectionsOverview(orgId) };
  } catch (caught) {
    return actionError("getCollectionsOverview", caught, "Цуглуулалтын мэдээлэл уншигдсангүй");
  }
}

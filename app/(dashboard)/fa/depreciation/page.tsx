import { eq } from "drizzle-orm";

import {
  FaDepreciationView,
  type DepreciationEntryView,
} from "@/components/fa/fa-depreciation-view";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { faDepreciationEntries } from "@/lib/db/schema";
import { getPeriodSelection } from "@/lib/periods/selection";

export default async function FaDepreciationPage() {
  const { orgId } = await getActiveOrg();

  // П2 — бие даасан fetch-үүд зэрэгцээ (waterfall арилгав).
  const [entries, period] = await Promise.all([
    db.query.faDepreciationEntries.findMany({
      where: eq(faDepreciationEntries.organizationId, orgId),
      with: { asset: true },
      orderBy: (entry, { desc }) => [desc(entry.periodMonth), desc(entry.createdAt)],
    }),
    getPeriodSelection(),
  ]);

  const views: DepreciationEntryView[] = entries.map((entry) => ({
    id: entry.id,
    assetCode: entry.asset.code,
    assetName: entry.asset.name,
    periodMonth: entry.periodMonth,
    amount: Number(entry.amount),
    status: entry.status,
  }));

  // Элэгдлийн сар нь topbar-ийн периодын сонголтын зангуу сар.
  return <FaDepreciationView entries={views} defaultMonth={period.periodCode} />;
}

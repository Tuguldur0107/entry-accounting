import { eq } from "drizzle-orm";

import {
  FaDepreciationView,
  type DepreciationEntryView,
} from "@/components/fa/fa-depreciation-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { faDepreciationEntries } from "@/lib/db/schema";
import { getPeriodSelection } from "@/lib/periods/selection";

export default async function FaDepreciationPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const entries = await db.query.faDepreciationEntries.findMany({
    where: eq(faDepreciationEntries.userId, userId),
    with: { asset: true },
    orderBy: (entry, { desc }) => [desc(entry.periodMonth), desc(entry.createdAt)],
  });

  const views: DepreciationEntryView[] = entries.map((entry) => ({
    id: entry.id,
    assetCode: entry.asset.code,
    assetName: entry.asset.name,
    periodMonth: entry.periodMonth,
    amount: Number(entry.amount),
    status: entry.status,
  }));

  // Элэгдлийн сар нь topbar-ийн периодын сонголтын зангуу сар.
  const period = await getPeriodSelection();
  return <FaDepreciationView entries={views} defaultMonth={period.periodCode} />;
}

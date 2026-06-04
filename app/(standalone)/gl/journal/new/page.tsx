import { db } from "@/lib/db";
import { chartOfAccounts, segmentConfigs, segmentValues } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { computeActiveSegIds } from "@/lib/segments";
import { JournalEntryForm } from "@/components/gl/journal-entry-form";

export default async function NewJournalPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [accounts, rawSegConfigs, rawSegValues] = await Promise.all([
    db.query.chartOfAccounts.findMany({
      where: and(eq(chartOfAccounts.userId, userId), eq(chartOfAccounts.isEnabled, true)),
      orderBy: (a, { asc }) => [asc(a.number)],
    }),
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.userId, userId) }),
    db.query.segmentValues.findMany({
      where: and(eq(segmentValues.userId, userId), eq(segmentValues.isEnabled, true)),
      orderBy: (v, { asc }) => [asc(v.segmentId), asc(v.code)],
    }),
  ]);

  // S3 always shows. Others: enabled unless explicitly disabled (тохиргоо байхгүй → идэвхтэй).
  const activeSegIds = computeActiveSegIds(rawSegConfigs);

  // §7.4 — S1 auto-fill: if only one company, pre-fill all lines
  const defaultSegments: Record<number, string> = {};
  if (activeSegIds.includes(1)) {
    const s1Values = rawSegValues.filter((sv) => sv.segmentId === 1);
    if (s1Values.length === 1) defaultSegments[1] = s1Values[0].code;
  }

  return (
    <JournalEntryForm
      accounts={accounts}
      activeSegIds={activeSegIds}
      segmentValues={rawSegValues}
      defaultSegments={defaultSegments}
    />
  );
}

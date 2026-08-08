import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { chartOfAccounts, segmentConfigs, segmentValues } from "@/lib/db/schema";
import { auth, getActiveOrg } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { JournalEntryForm } from "@/components/gl/journal-entry-form";

export default async function NewJournalPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { orgId } = await getActiveOrg();

  const [accounts, rawSegConfigs, rawSegValues] = await Promise.all([
    db.query.chartOfAccounts.findMany({
      where: and(eq(chartOfAccounts.organizationId, orgId), eq(chartOfAccounts.isEnabled, true)),
      orderBy: (a, { asc }) => [asc(a.number)],
    }),
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.organizationId, orgId) }),
    db.query.segmentValues.findMany({
      where: and(eq(segmentValues.organizationId, orgId), eq(segmentValues.isEnabled, true)),
      orderBy: (v, { asc }) => [asc(v.segmentId), asc(v.code)],
    }),
  ]);

  const segConfigMap = new Map(rawSegConfigs.map((c) => [c.segmentId, c]));

  // S3 always shows. Others: only if isEnabled=true in segmentConfigs.
  const activeSegIds = SEGMENT_DEFS
    .filter((def) => def.id === 3 || segConfigMap.get(def.id)?.isEnabled === true)
    .map((def) => def.id);

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

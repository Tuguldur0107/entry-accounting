import { db } from "@/lib/db";
import { journalVouchers, segmentConfigs } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { computeActiveSegIds } from "@/lib/segments";
import { JournalList } from "@/components/gl/journal-list";

export default async function JournalPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [vouchers, rawSegConfigs] = await Promise.all([
    db.query.journalVouchers.findMany({
      where: eq(journalVouchers.userId, userId),
      with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
      orderBy: [desc(journalVouchers.date), desc(journalVouchers.createdAt)],
    }),
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.userId, userId) }),
  ]);

  const activeSegIds = computeActiveSegIds(rawSegConfigs);

  return <JournalList vouchers={vouchers} activeSegIds={activeSegIds} />;
}

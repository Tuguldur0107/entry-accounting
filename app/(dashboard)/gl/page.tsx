import { and, eq, like, sql } from "drizzle-orm";

import {
  GlDashboard,
  type GlRecentVoucherRow,
} from "@/components/gl/gl-dashboard";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  journalLines,
  journalVouchers,
} from "@/lib/db/schema";

export default async function GlDashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const month = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Ulaanbaatar",
  }).slice(0, 7);

  // Нийлбэрүүдийг SQL-ээр — мөрүүдийг санах ойд ачаалахгүй.
  const [statusCounts, [totals], [monthTotals], [accounts], recentRows] =
    await Promise.all([
      db
        .select({
          status: journalVouchers.status,
          count: sql<number>`count(*)::int`,
        })
        .from(journalVouchers)
        .where(eq(journalVouchers.userId, userId))
        .groupBy(journalVouchers.status),
      db
        .select({
          debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
          credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
        })
        .from(journalLines)
        .innerJoin(
          journalVouchers,
          eq(journalLines.voucherId, journalVouchers.id)
        )
        .where(
          and(
            eq(journalVouchers.userId, userId),
            eq(journalVouchers.status, "posted")
          )
        ),
      db
        .select({
          debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
        })
        .from(journalLines)
        .innerJoin(
          journalVouchers,
          eq(journalLines.voucherId, journalVouchers.id)
        )
        .where(
          and(
            eq(journalVouchers.userId, userId),
            eq(journalVouchers.status, "posted"),
            like(journalVouchers.date, `${month}%`)
          )
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.userId, userId),
            eq(chartOfAccounts.isEnabled, true)
          )
        ),
      db.query.journalVouchers.findMany({
        where: eq(journalVouchers.userId, userId),
        orderBy: (voucher, { desc }) => [
          desc(voucher.date),
          desc(voucher.createdAt),
        ],
        limit: 10,
        with: { lines: { columns: { debit: true } } },
      }),
    ]);

  const countByStatus = new Map(
    statusCounts.map((row) => [row.status, row.count])
  );

  const recent: GlRecentVoucherRow[] = recentRows.map((voucher) => ({
    id: voucher.id,
    date: voucher.date,
    description: voucher.description,
    amount:
      Math.round(
        voucher.lines.reduce((sum, line) => sum + Number(line.debit), 0) * 100
      ) / 100,
    status: voucher.status,
  }));

  return (
    <GlDashboard
      postedCount={countByStatus.get("posted") ?? 0}
      draftCount={countByStatus.get("draft") ?? 0}
      monthLabel={month}
      monthTotal={Number(monthTotals?.debit ?? 0)}
      totalDebit={Number(totals?.debit ?? 0)}
      totalCredit={Number(totals?.credit ?? 0)}
      accountCount={accounts?.count ?? 0}
      recent={recent}
    />
  );
}

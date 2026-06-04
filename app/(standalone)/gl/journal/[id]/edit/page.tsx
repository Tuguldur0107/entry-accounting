import { db } from "@/lib/db";
import { chartOfAccounts, journalVouchers, segmentConfigs, segmentValues } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { computeActiveSegIds } from "@/lib/segments";
import { JournalEntryForm } from "@/components/gl/journal-entry-form";
import { notFound } from "next/navigation";

export default async function EditJournalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;

  const [voucher, accounts, rawSegConfigs, rawSegValues] = await Promise.all([
    db.query.journalVouchers.findFirst({
      where: and(eq(journalVouchers.id, id), eq(journalVouchers.userId, userId)),
      with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
    }),
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

  if (!voucher || voucher.status === "posted") notFound();

  const activeSegIds = computeActiveSegIds(rawSegConfigs);

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
      voucherId={voucher.id}
      initialVoucher={{
        date: voucher.date,
        description: voucher.description,
        lines: voucher.lines.map((l) => ({
          account: l.accountNumber,
          debit: Number(l.debit) > 0 ? String(Number(l.debit)) : "",
          credit: Number(l.credit) > 0 ? String(Number(l.credit)) : "",
          description: l.description ?? "",
        })),
      }}
    />
  );
}

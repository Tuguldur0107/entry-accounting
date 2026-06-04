import { db } from "@/lib/db";
import { journalVouchers, chartOfAccounts } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { ReportsView } from "@/components/gl/reports-view";

export default async function ReportsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [vouchers, accounts] = await Promise.all([
    db.query.journalVouchers.findMany({
      where: and(eq(journalVouchers.userId, userId), eq(journalVouchers.status, "posted")),
      with: { lines: true },
    }),
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.userId, userId),
    }),
  ]);

  // Тайлан сегментийг ашиглахгүй — үндсэн данс (S3)-аар нийлбэрлэнэ (reports-view дотор).
  return <ReportsView vouchers={vouchers} accounts={accounts} />;
}

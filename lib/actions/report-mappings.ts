"use server";

import { db } from "@/lib/db";
import { reportLineMappings } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type ReportType = "balance-sheet" | "income-statement" | "cash-flow";

export async function getReportMappings(reportType: ReportType) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return [];

  const rows = await db.query.reportLineMappings.findMany({
    where: and(
      eq(reportLineMappings.userId, userId),
      eq(reportLineMappings.reportType, reportType)
    ),
  });
  return rows;
}

export async function saveReportMapping(
  reportType: ReportType,
  lineKey: string,
  accountNumbers: string[]
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: "Нэвтрээгүй" };

  const csv = accountNumbers.map((a) => a.trim()).filter(Boolean).join(",");

  // Upsert via raw match: try update first, insert if no row.
  const existing = await db.query.reportLineMappings.findFirst({
    where: and(
      eq(reportLineMappings.userId, userId),
      eq(reportLineMappings.reportType, reportType),
      eq(reportLineMappings.lineKey, lineKey)
    ),
  });

  if (existing) {
    await db
      .update(reportLineMappings)
      .set({ accountNumbers: csv, updatedAt: new Date() })
      .where(eq(reportLineMappings.id, existing.id));
  } else {
    await db.insert(reportLineMappings).values({
      userId,
      reportType,
      lineKey,
      accountNumbers: csv,
    });
  }

  revalidatePath("/gl/reports");
  return { ok: true };
}

export async function clearReportMapping(reportType: ReportType, lineKey: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: "Нэвтрээгүй" };

  await db
    .delete(reportLineMappings)
    .where(
      and(
        eq(reportLineMappings.userId, userId),
        eq(reportLineMappings.reportType, reportType),
        eq(reportLineMappings.lineKey, lineKey)
      )
    );

  revalidatePath("/gl/reports");
  return { ok: true };
}

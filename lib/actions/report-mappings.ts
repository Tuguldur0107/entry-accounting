"use server";

import { db } from "@/lib/db";
import { reportLineMappings } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

export type ReportType = "balance-sheet" | "income-statement" | "cash-flow";

async function requireUserId() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Нэвтрээгүй");
  return userId;
}

export async function getReportMappings(reportType: ReportType) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return [];
  return db.query.reportLineMappings.findMany({
    where: and(
      eq(reportLineMappings.userId, userId),
      eq(reportLineMappings.reportType, reportType)
    ),
  });
}

// Helper: upsert by (userId, reportType, lineKey).
async function upsertLine(
  userId: string,
  reportType: ReportType,
  lineKey: string,
  patch: Partial<{
    accountNumbers: string;
    isHidden: boolean;
    customLabel: string | null;
    customGroup: string | null;
    sortOrder: number;
  }>
) {
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
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(reportLineMappings.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(reportLineMappings)
    .values({
      userId,
      reportType,
      lineKey,
      accountNumbers: patch.accountNumbers ?? "",
      isHidden: patch.isHidden ?? false,
      customLabel: patch.customLabel ?? null,
      customGroup: patch.customGroup ?? null,
      sortOrder: patch.sortOrder ?? 0,
    })
    .returning({ id: reportLineMappings.id });
  return row.id;
}

export async function saveReportMapping(
  reportType: ReportType,
  lineKey: string,
  accountNumbers: string[]
) {
  try {
    const userId = await requireUserId();
    const csv = accountNumbers.map((a) => a.trim()).filter(Boolean).join(",");
    await upsertLine(userId, reportType, lineKey, { accountNumbers: csv });
    revalidatePath("/gl/reports");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Хадгалах үед алдаа" };
  }
}

export async function clearReportMapping(reportType: ReportType, lineKey: string) {
  try {
    const userId = await requireUserId();
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
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Алдаа" };
  }
}

export async function setLineHidden(
  reportType: ReportType,
  lineKey: string,
  isHidden: boolean
) {
  try {
    const userId = await requireUserId();
    await upsertLine(userId, reportType, lineKey, { isHidden });
    revalidatePath("/gl/reports");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Алдаа" };
  }
}

export async function renameLine(
  reportType: ReportType,
  lineKey: string,
  customLabel: string | null
) {
  try {
    const userId = await requireUserId();
    const trimmed = customLabel?.trim() || null;
    await upsertLine(userId, reportType, lineKey, { customLabel: trimmed });
    revalidatePath("/gl/reports");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Алдаа" };
  }
}

export async function addCustomLine(
  reportType: ReportType,
  customGroup: string,
  customLabel: string
) {
  try {
    const userId = await requireUserId();
    const label = customLabel.trim();
    if (!label) return { error: "Гарчиг хоосон байна" };

    // Position the new line at the end of its group.
    const existing = await db.query.reportLineMappings.findMany({
      where: and(
        eq(reportLineMappings.userId, userId),
        eq(reportLineMappings.reportType, reportType)
      ),
    });
    const maxOrder = existing
      .filter((r) => r.customGroup === customGroup)
      .reduce((m, r) => Math.max(m, r.sortOrder), 0);

    const lineKey = `custom-${nanoid(10)}`;
    await db.insert(reportLineMappings).values({
      userId,
      reportType,
      lineKey,
      accountNumbers: "",
      customLabel: label,
      customGroup,
      sortOrder: maxOrder + 10,
    });
    revalidatePath("/gl/reports");
    return { ok: true, lineKey };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Алдаа" };
  }
}

export async function removeCustomLine(reportType: ReportType, lineKey: string) {
  try {
    if (!lineKey.startsWith("custom-")) {
      return { error: "Зөвхөн нэмсэн мөрийг устгана" };
    }
    const userId = await requireUserId();
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
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Алдаа" };
  }
}

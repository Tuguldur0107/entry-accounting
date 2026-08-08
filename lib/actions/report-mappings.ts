"use server";

import { db } from "@/lib/db";
import { reportLineMappings } from "@/lib/db/schema";
import { getActiveOrg, requireRole } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

export type ReportType = "balance-sheet" | "income-statement" | "cash-flow";

async function ctx() {
  // Тайлангийн mapping = тохиргоо — унших нь гишүүн бүр, засах admin.
  const { orgId, userId } = await getActiveOrg();
  return { orgId, userId };
}

export async function getReportMappings(reportType: ReportType) {
  const { orgId } = await ctx();
  return db.query.reportLineMappings.findMany({
    where: and(
      eq(reportLineMappings.organizationId, orgId),
      eq(reportLineMappings.reportType, reportType)
    ),
  });
}

// Helper: upsert by (orgId, reportType, lineKey).
async function upsertLine(
  ctx0: { orgId: string; userId: string },
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
  const { orgId, userId } = ctx0;
  const existing = await db.query.reportLineMappings.findFirst({
    where: and(
      eq(reportLineMappings.organizationId, orgId),
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
      organizationId: orgId,
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
    const { orgId, userId } = await ctx();
    const csv = accountNumbers.map((a) => a.trim()).filter(Boolean).join(",");
    await upsertLine({ orgId, userId }, reportType, lineKey, { accountNumbers: csv });
    revalidatePath("/gl/reports");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Хадгалах үед алдаа" };
  }
}

export async function clearReportMapping(reportType: ReportType, lineKey: string) {
  try {
    const { orgId, userId } = await ctx();
    await db
      .delete(reportLineMappings)
      .where(
        and(
          eq(reportLineMappings.organizationId, orgId),
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
    const { orgId, userId } = await ctx();
    await upsertLine({ orgId, userId }, reportType, lineKey, { isHidden });
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
    const { orgId, userId } = await ctx();
    const trimmed = customLabel?.trim() || null;
    await upsertLine({ orgId, userId }, reportType, lineKey, { customLabel: trimmed });
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
    const { orgId, userId } = await ctx();
    const label = customLabel.trim();
    if (!label) return { error: "Гарчиг хоосон байна" };

    // Position the new line at the end of its group.
    const existing = await db.query.reportLineMappings.findMany({
      where: and(
        eq(reportLineMappings.organizationId, orgId),
        eq(reportLineMappings.reportType, reportType)
      ),
    });
    const maxOrder = existing
      .filter((r) => r.customGroup === customGroup)
      .reduce((m, r) => Math.max(m, r.sortOrder), 0);

    const lineKey = `custom-${nanoid(10)}`;
    await db.insert(reportLineMappings).values({
      userId,
      organizationId: orgId,
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
    const { orgId, userId } = await ctx();
    await db
      .delete(reportLineMappings)
      .where(
        and(
          eq(reportLineMappings.organizationId, orgId),
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

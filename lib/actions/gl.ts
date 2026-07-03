"use server";

import { db } from "@/lib/db";
import {
  chartOfAccounts,
  journalVouchers,
  journalLines,
  moduleConfigs,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { eq, and, sql } from "drizzle-orm";
import {
  STANDARD_ACCOUNTS,
  SEGMENT_DEFS,
} from "@/lib/constants/standard-accounts";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Нэвтрэх шаардлагатай");
  return session.user.id;
}

// ─── Chart of Accounts ───────────────────────────────────────────────────────

export async function createAccount(data: { number: string; name: string }) {
  const userId = await requireUser();

  const existing = await db.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.userId, userId),
      eq(chartOfAccounts.number, data.number)
    ),
  });
  if (existing) return { error: "Энэ дугаартай данс аль хэдийн байна" };

  await db.insert(chartOfAccounts).values({ userId, ...data });
  revalidatePath("/settings/gl");
  revalidatePath("/gl/journal");
}

export async function deleteAccount(id: string) {
  const userId = await requireUser();
  await db
    .delete(chartOfAccounts)
    .where(and(eq(chartOfAccounts.id, id), eq(chartOfAccounts.userId, userId)));
  revalidatePath("/settings/gl");
  revalidatePath("/gl/journal");
}

export async function toggleAccount(id: string, isEnabled: boolean) {
  const userId = await requireUser();
  await db
    .update(chartOfAccounts)
    .set({ isEnabled })
    .where(and(eq(chartOfAccounts.id, id), eq(chartOfAccounts.userId, userId)));
  revalidatePath("/settings/gl");
  revalidatePath("/gl/journal");
}

export async function bulkToggleSegment(segment: string, isEnabled: boolean) {
  const userId = await requireUser();
  await db
    .update(chartOfAccounts)
    .set({ isEnabled })
    .where(
      and(
        eq(chartOfAccounts.userId, userId),
        sql`left(${chartOfAccounts.number}, 1) = ${segment}`
      )
    );
  revalidatePath("/settings/gl");
  revalidatePath("/gl/journal");
}

export async function updateAccountModules(id: string, modules: string[]) {
  const userId = await requireUser();
  await db
    .update(chartOfAccounts)
    .set({ modules: modules.join(",") })
    .where(and(eq(chartOfAccounts.id, id), eq(chartOfAccounts.userId, userId)));
  revalidatePath("/settings/gl");
}

export async function syncStandardAccounts() {
  const userId = await requireUser();

  const existing = await db.query.chartOfAccounts.findMany({
    where: eq(chartOfAccounts.userId, userId),
  });
  const existingNumbers = new Set(existing.map((a) => a.number));

  const toAdd = STANDARD_ACCOUNTS.filter(
    (a) => !existingNumbers.has(a.number)
  );
  if (toAdd.length === 0) return { added: 0 };

  await db.insert(chartOfAccounts).values(
    toAdd.map((a) => ({ userId, number: a.number, name: a.name }))
  );

  revalidatePath("/settings/gl");
  revalidatePath("/gl/journal");
  return { added: toAdd.length };
}

// ─── Segment Configs ──────────────────────────────────────────────────────────

export async function getSegmentConfigs() {
  const userId = await requireUser();
  const rows = await db.query.segmentConfigs.findMany({
    where: eq(segmentConfigs.userId, userId),
  });
  // Seed defaults for any missing segments
  const existing = new Set(rows.map((r) => r.segmentId));
  const missing = SEGMENT_DEFS.filter((d) => !existing.has(d.id));
  if (missing.length > 0) {
    await db.insert(segmentConfigs).values(
      missing.map((d) => ({
        userId,
        segmentId: d.id,
        isEnabled: true,
        modules: d.defaultModules.join(","),
      }))
    );
    return db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.userId, userId),
    });
  }
  return rows;
}

export async function updateSegmentConfig(
  segmentId: number,
  data: { isEnabled?: boolean; modules?: string[] }
) {
  const userId = await requireUser();
  // modules заагаагүй insert-д тухайн сегментийн defaultModules-ийг өгнө —
  // хоосон "" хадгалбал модулиар шүүдэг хуудсууд (cash г.м.) сегментийг алдана.
  const defaultModules =
    SEGMENT_DEFS.find((d) => d.id === segmentId)?.defaultModules ?? [];
  await db
    .insert(segmentConfigs)
    .values({
      userId,
      segmentId,
      isEnabled: data.isEnabled ?? true,
      modules: (data.modules ?? defaultModules).join(","),
    })
    .onConflictDoUpdate({
      target: [segmentConfigs.userId, segmentConfigs.segmentId],
      set: {
        ...(data.isEnabled !== undefined && { isEnabled: data.isEnabled }),
        ...(data.modules !== undefined && { modules: data.modules.join(",") }),
      },
    });
  revalidatePath("/settings/gl");
}

// ─── Module Configs ───────────────────────────────────────────────────────────

export async function batchSaveModuleConfigs(
  changes: { moduleKey: string; isEnabled: boolean }[]
) {
  const userId = await requireUser();
  await Promise.all(
    changes.map((c) =>
      db
        .insert(moduleConfigs)
        .values({ userId, moduleKey: c.moduleKey, isEnabled: c.isEnabled })
        .onConflictDoUpdate({
          target: [moduleConfigs.userId, moduleConfigs.moduleKey],
          set: { isEnabled: c.isEnabled },
        })
    )
  );
  revalidatePath("/settings/gl");
}

// ─── Batch save (edit mode) ───────────────────────────────────────────────────

export async function batchSaveSection2(
  accountChanges: { id: string; isEnabled: boolean; modules: string }[],
  svChanges: { id: string; isEnabled: boolean; modules: string }[]
) {
  const userId = await requireUser();

  await Promise.all([
    ...accountChanges.map((c) =>
      db
        .update(chartOfAccounts)
        .set({ isEnabled: c.isEnabled, modules: c.modules })
        .where(and(eq(chartOfAccounts.id, c.id), eq(chartOfAccounts.userId, userId)))
    ),
    ...svChanges.map((c) =>
      db
        .update(segmentValues)
        .set({ isEnabled: c.isEnabled, modules: c.modules })
        .where(and(eq(segmentValues.id, c.id), eq(segmentValues.userId, userId)))
    ),
  ]);

  revalidatePath("/settings/gl");
  revalidatePath("/gl/journal");
}

// ─── Segment Values (S1,S2,S4–S10) ───────────────────────────────────────────

export async function getSegmentValuesBySegment(segmentId: number) {
  const userId = await requireUser();
  return db.query.segmentValues.findMany({
    where: and(
      eq(segmentValues.userId, userId),
      eq(segmentValues.segmentId, segmentId)
    ),
    orderBy: (v, { asc }) => [asc(v.code)],
  });
}

export async function createSegmentValue(data: {
  segmentId: number;
  code: string;
  name: string;
  modules: string[];
}) {
  const userId = await requireUser();
  const existing = await db.query.segmentValues.findFirst({
    where: and(
      eq(segmentValues.userId, userId),
      eq(segmentValues.segmentId, data.segmentId),
      eq(segmentValues.code, data.code)
    ),
  });
  if (existing) return { error: "Энэ код аль хэдийн бүртгэлтэй байна" };

  await db.insert(segmentValues).values({
    userId,
    segmentId: data.segmentId,
    code: data.code,
    name: data.name,
    modules: data.modules.join(","),
  });
  revalidatePath("/settings/gl");
}

export async function deleteSegmentValue(id: string) {
  const userId = await requireUser();
  await db
    .delete(segmentValues)
    .where(and(eq(segmentValues.id, id), eq(segmentValues.userId, userId)));
  revalidatePath("/settings/gl");
}

export async function toggleSegmentValue(id: string, isEnabled: boolean) {
  const userId = await requireUser();
  await db
    .update(segmentValues)
    .set({ isEnabled })
    .where(and(eq(segmentValues.id, id), eq(segmentValues.userId, userId)));
  revalidatePath("/settings/gl");
}

export async function updateSegmentValueModules(id: string, modules: string[]) {
  const userId = await requireUser();
  await db
    .update(segmentValues)
    .set({ modules: modules.join(",") })
    .where(and(eq(segmentValues.id, id), eq(segmentValues.userId, userId)));
  revalidatePath("/settings/gl");
}

// ─── Journal Vouchers ─────────────────────────────────────────────────────────

export type LineInput = {
  account: string;
  debit: number;
  credit: number;
  description: string;
};

export async function createVoucher(data: {
  date: string;
  description: string;
  lines: LineInput[];
  status?: "draft" | "posted";
}) {
  const userId = await requireUser();
  const status = data.status ?? "posted";

  const validLines = data.lines.filter(
    (l) => l.account && (l.debit > 0 || l.credit > 0)
  );
  if (validLines.length < 2) throw new Error("Дор хаяж 2 мөр оруулна уу");

  if (status === "posted") {
    const totalDebit = validLines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = validLines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01)
      throw new Error("Дебет ба кредит тэнцэхгүй байна");
  }

  await db.transaction(async (tx) => {
    const [voucher] = await tx
      .insert(journalVouchers)
      .values({ userId, date: data.date, description: data.description, status })
      .returning();

    await tx.insert(journalLines).values(
      validLines.map((l, i) => ({
        voucherId: voucher.id,
        accountNumber: l.account,
        debit: String(l.debit),
        credit: String(l.credit),
        description: l.description,
        sortOrder: i,
      }))
    );
  });

  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
}

export async function postVoucher(id: string) {
  const userId = await requireUser();

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.id, id), eq(journalVouchers.userId, userId)),
    with: { lines: true },
  });
  if (!voucher) throw new Error("Бичилт олдсонгүй");
  if (voucher.status === "posted") return;

  const totalDebit = voucher.lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = voucher.lines.reduce((s, l) => s + Number(l.credit), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01)
    throw new Error("Дебет ба кредит тэнцэхгүй байна");

  await db
    .update(journalVouchers)
    .set({ status: "posted" })
    .where(and(eq(journalVouchers.id, id), eq(journalVouchers.userId, userId)));

  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
}

export async function unpostVoucher(id: string) {
  const userId = await requireUser();

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.id, id), eq(journalVouchers.userId, userId)),
    with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
  });
  if (!voucher) throw new Error("Бичилт олдсонгүй");
  if (voucher.status !== "posted")
    throw new Error("Зөвхөн бичигдсэн журналыг буцаах боломжтой");

  await db.transaction(async (tx) => {
    await tx
      .update(journalVouchers)
      .set({ status: "reversed" })
      .where(and(eq(journalVouchers.id, id), eq(journalVouchers.userId, userId)));

    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        date: voucher.date,
        description: `Сторно: ${voucher.description}`,
        status: "posted",
      })
      .returning();

    await tx.insert(journalLines).values(
      voucher.lines.map((l, i) => ({
        voucherId: reversal.id,
        accountNumber: l.accountNumber,
        debit: String(-Number(l.debit)),
        credit: String(-Number(l.credit)),
        description: l.description,
        sortOrder: i,
      }))
    );
  });

  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
}

export async function updateVoucher(
  id: string,
  data: {
    date: string;
    description: string;
    lines: LineInput[];
    status: "draft" | "posted";
  }
) {
  const userId = await requireUser();

  const validLines = data.lines.filter(
    (l) => l.account && (l.debit > 0 || l.credit > 0)
  );
  if (validLines.length < 2) throw new Error("Дор хаяж 2 мөр оруулна уу");

  if (data.status === "posted") {
    const totalDebit = validLines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = validLines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01)
      throw new Error("Дебет ба кредит тэнцэхгүй байна");
  }

  await db.transaction(async (tx) => {
    const existing = await tx.query.journalVouchers.findFirst({
      where: and(eq(journalVouchers.id, id), eq(journalVouchers.userId, userId)),
      columns: { status: true },
    });
    if (!existing) throw new Error("Бичилт олдсонгүй");
    if (existing.status !== "draft")
      throw new Error("Зөвхөн ноорог журналыг засах боломжтой");

    await tx
      .update(journalVouchers)
      .set({ date: data.date, description: data.description, status: data.status })
      .where(and(eq(journalVouchers.id, id), eq(journalVouchers.userId, userId)));

    await tx.delete(journalLines).where(eq(journalLines.voucherId, id));
    await tx.insert(journalLines).values(
      validLines.map((l, i) => ({
        voucherId: id,
        accountNumber: l.account,
        debit: String(l.debit),
        credit: String(l.credit),
        description: l.description,
        sortOrder: i,
      }))
    );
  });

  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
}

export async function deleteVoucher(id: string) {
  const userId = await requireUser();

  await db.transaction(async (tx) => {
    const existing = await tx.query.journalVouchers.findFirst({
      where: and(eq(journalVouchers.id, id), eq(journalVouchers.userId, userId)),
      columns: { status: true },
    });
    if (!existing) throw new Error("Бичилт олдсонгүй");
    if (existing.status !== "draft")
      throw new Error("Зөвхөн ноорог журналыг устгах боломжтой");

    await tx
      .delete(journalVouchers)
      .where(and(eq(journalVouchers.id, id), eq(journalVouchers.userId, userId)));
  });

  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
}

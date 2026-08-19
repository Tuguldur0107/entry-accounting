"use server";

import { db } from "@/lib/db";
import {
  arApDocuments,
  cashDocuments,
  cashFxRevaluations,
  chartOfAccounts,
  costEntries,
  faDepreciationEntries,
  fixedAssets,
  journalVouchers,
  journalLines,
  moduleConfigs,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { getActiveOrg, requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { eq, and, ne, or, sql } from "drizzle-orm";
import {
  STANDARD_ACCOUNTS,
  SEGMENT_DEFS,
} from "@/lib/constants/standard-accounts";
import {
  removeDraftCashDocsForVoucher,
  syncDraftCashDocumentForVoucher,
} from "@/lib/cash/sync-voucher";
import {
  removeDraftMovementsForVoucher,
  syncInventoryDraftForVoucher,
} from "@/lib/inventory/sync-sources";
import {
  removeDraftAssetsForVoucher,
  syncFixedAssetDraftForVoucher,
} from "@/lib/fa/sync-sources";
import { assertPeriodOpen, assertPeriodOpenInTx } from "@/lib/periods/guard";
import { parseSegParts } from "@/lib/grid/segments";
import { logAuditEvent } from "@/lib/audit";

// Фаз 01 multi-tenancy: scope нь идэвхтэй байгууллага (orgId), userId нь
// createdBy/audit утгаар үлддэг. Дансны/сегментийн тохиргоо — admin,
// журналын бичилт — accountant, унших — гишүүн бүр.

// ─── Chart of Accounts ───────────────────────────────────────────────────────

export async function createAccount(data: { number: string; name: string }) {
  const { orgId, userId } = await requireRole("admin");

  const existing = await db.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.organizationId, orgId),
      eq(chartOfAccounts.number, data.number)
    ),
  });
  if (existing) return { error: "Энэ дугаартай данс аль хэдийн байна" };

  await db.insert(chartOfAccounts).values({ userId, organizationId: orgId, ...data });
  revalidatePath("/settings/gl");
  revalidatePath("/gl/journal");
}

export async function deleteAccount(id: string) {
  const { orgId } = await requireRole("admin");

  const account = await db.query.chartOfAccounts.findFirst({
    where: and(eq(chartOfAccounts.id, id), eq(chartOfAccounts.organizationId, orgId)),
    columns: { number: true },
  });
  if (!account) throw new Error("Данс олдсонгүй");

  // Журналын түүхтэй дансыг устгавал тайлан нэргүй мөртэй үлдэж, шинэ
  // бичилт/буцаалт бүгд унана — идэвхгүй болгохыг л зөвшөөрнө.
  // Мөрийн код бүтэн 10-part (S3 = 3-р хэсэг) эсвэл дан 8 оронтой байж болно.
  const [used] = await db
    .select({ count: sql<number>`count(*)` })
    .from(journalLines)
    .innerJoin(journalVouchers, eq(journalLines.voucherId, journalVouchers.id))
    .where(
      and(
        eq(journalVouchers.organizationId, orgId),
        or(
          eq(sql`split_part(${journalLines.accountNumber}, '.', 3)`, account.number),
          eq(journalLines.accountNumber, account.number)
        )
      )
    );
  if (Number(used?.count ?? 0) > 0)
    throw new Error(
      `${account.number} данс журналын бичилтэд ашиглагдсан тул устгах боломжгүй — идэвхгүй болгоно уу`
    );

  await db
    .delete(chartOfAccounts)
    .where(and(eq(chartOfAccounts.id, id), eq(chartOfAccounts.organizationId, orgId)));
  revalidatePath("/settings/gl");
  revalidatePath("/gl/journal");
}

export async function toggleAccount(id: string, isEnabled: boolean) {
  const { orgId } = await requireRole("admin");
  await db
    .update(chartOfAccounts)
    .set({ isEnabled })
    .where(and(eq(chartOfAccounts.id, id), eq(chartOfAccounts.organizationId, orgId)));
  revalidatePath("/settings/gl");
  revalidatePath("/gl/journal");
}

export async function bulkToggleSegment(segment: string, isEnabled: boolean) {
  const { orgId } = await requireRole("admin");
  await db
    .update(chartOfAccounts)
    .set({ isEnabled })
    .where(
      and(
        eq(chartOfAccounts.organizationId, orgId),
        sql`left(${chartOfAccounts.number}, 1) = ${segment}`
      )
    );
  revalidatePath("/settings/gl");
  revalidatePath("/gl/journal");
}

export async function updateAccountModules(id: string, modules: string[]) {
  const { orgId } = await requireRole("admin");
  await db
    .update(chartOfAccounts)
    .set({ modules: modules.join(",") })
    .where(and(eq(chartOfAccounts.id, id), eq(chartOfAccounts.organizationId, orgId)));
  revalidatePath("/settings/gl");
}

export async function syncStandardAccounts() {
  const { orgId, userId } = await requireRole("admin");

  const existing = await db.query.chartOfAccounts.findMany({
    where: eq(chartOfAccounts.organizationId, orgId),
  });
  const existingNumbers = new Set(existing.map((a) => a.number));

  const toAdd = STANDARD_ACCOUNTS.filter(
    (a) => !existingNumbers.has(a.number)
  );
  if (toAdd.length === 0) return { added: 0 };

  await db.insert(chartOfAccounts).values(
    toAdd.map((a) => ({
      userId,
      organizationId: orgId,
      number: a.number,
      name: a.name,
    }))
  );

  revalidatePath("/settings/gl");
  revalidatePath("/gl/journal");
  return { added: toAdd.length };
}

// ─── Segment Configs ──────────────────────────────────────────────────────────

export async function getSegmentConfigs() {
  const { orgId, userId } = await getActiveOrg();
  const rows = await db.query.segmentConfigs.findMany({
    where: eq(segmentConfigs.organizationId, orgId),
  });
  // Seed defaults for any missing segments
  const existing = new Set(rows.map((r) => r.segmentId));
  const missing = SEGMENT_DEFS.filter((d) => !existing.has(d.id));
  if (missing.length > 0) {
    await db.insert(segmentConfigs).values(
      missing.map((d) => ({
        userId,
        organizationId: orgId,
        segmentId: d.id,
        isEnabled: true,
        modules: d.defaultModules.join(","),
      }))
    );
    return db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.organizationId, orgId),
    });
  }
  return rows;
}

export async function updateSegmentConfig(
  segmentId: number,
  data: { isEnabled?: boolean; modules?: string[] }
) {
  const { orgId, userId } = await requireRole("admin");
  // modules заагаагүй insert-д тухайн сегментийн defaultModules-ийг өгнө —
  // хоосон "" хадгалбал модулиар шүүдэг хуудсууд (cash г.м.) сегментийг алдана.
  const defaultModules =
    SEGMENT_DEFS.find((d) => d.id === segmentId)?.defaultModules ?? [];
  await db
    .insert(segmentConfigs)
    .values({
      userId,
      organizationId: orgId,
      segmentId,
      isEnabled: data.isEnabled ?? true,
      modules: (data.modules ?? defaultModules).join(","),
    })
    .onConflictDoUpdate({
      target: [segmentConfigs.organizationId, segmentConfigs.segmentId],
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
  const { orgId, userId } = await requireRole("admin");
  await Promise.all(
    changes.map((c) =>
      db
        .insert(moduleConfigs)
        .values({
          userId,
          organizationId: orgId,
          moduleKey: c.moduleKey,
          isEnabled: c.isEnabled,
        })
        .onConflictDoUpdate({
          target: [moduleConfigs.organizationId, moduleConfigs.moduleKey],
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
  const { orgId } = await requireRole("admin");

  await Promise.all([
    ...accountChanges.map((c) =>
      db
        .update(chartOfAccounts)
        .set({ isEnabled: c.isEnabled, modules: c.modules })
        .where(and(eq(chartOfAccounts.id, c.id), eq(chartOfAccounts.organizationId, orgId)))
    ),
    ...svChanges.map((c) =>
      db
        .update(segmentValues)
        .set({ isEnabled: c.isEnabled, modules: c.modules })
        .where(and(eq(segmentValues.id, c.id), eq(segmentValues.organizationId, orgId)))
    ),
  ]);

  revalidatePath("/settings/gl");
  revalidatePath("/gl/journal");
}

// ─── Segment Values (S1,S2,S4–S10) ───────────────────────────────────────────

export async function getSegmentValuesBySegment(segmentId: number) {
  const { orgId } = await getActiveOrg();
  return db.query.segmentValues.findMany({
    where: and(
      eq(segmentValues.organizationId, orgId),
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
  const { orgId, userId } = await requireRole("admin");
  const existing = await db.query.segmentValues.findFirst({
    where: and(
      eq(segmentValues.organizationId, orgId),
      eq(segmentValues.segmentId, data.segmentId),
      eq(segmentValues.code, data.code)
    ),
  });
  if (existing) return { error: "Энэ код аль хэдийн бүртгэлтэй байна" };

  await db.insert(segmentValues).values({
    userId,
    organizationId: orgId,
    segmentId: data.segmentId,
    code: data.code,
    name: data.name,
    modules: data.modules.join(","),
  });
  revalidatePath("/settings/gl");
}

export async function deleteSegmentValue(id: string) {
  const { orgId } = await requireRole("admin");
  await db
    .delete(segmentValues)
    .where(and(eq(segmentValues.id, id), eq(segmentValues.organizationId, orgId)));
  revalidatePath("/settings/gl");
}

export async function toggleSegmentValue(id: string, isEnabled: boolean) {
  const { orgId } = await requireRole("admin");
  await db
    .update(segmentValues)
    .set({ isEnabled })
    .where(and(eq(segmentValues.id, id), eq(segmentValues.organizationId, orgId)));
  revalidatePath("/settings/gl");
}

export async function updateSegmentValueModules(id: string, modules: string[]) {
  const { orgId } = await requireRole("admin");
  await db
    .update(segmentValues)
    .set({ modules: modules.join(",") })
    .where(and(eq(segmentValues.id, id), eq(segmentValues.organizationId, orgId)));
  revalidatePath("/settings/gl");
}

// ─── Journal Vouchers ─────────────────────────────────────────────────────────

export type LineInput = {
  account: string;
  debit: number;
  credit: number;
  description: string;
};

/**
 * Мөрийн серверийн шалгалт — client validator-оос үл хамааран ЭНД дахин
 * шалгана (Server Action бол жинхэнэ trust boundary):
 *   - дүн сөрөг биш, төгсгөлөг тоо
 *   - нэг мөрөнд дебет БОЛОН кредит зэрэг байхгүй (mutex)
 *   - данс идэвхтэй жагсаалтад бий
 * Хоосон мөрийг (данс/дүнгүй) шүүж хаяад үлдсэнийг буцаана.
 */
async function validateVoucherLines(orgId: string, lines: LineInput[]) {
  for (const l of lines) {
    const debit = Number(l.debit);
    const credit = Number(l.credit);
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0)
      throw new Error("Мөрийн дүн 0-ээс бага байж болохгүй");
    if (debit > 0 && credit > 0)
      throw new Error("Нэг мөрөнд дебет, кредит зэрэг байж болохгүй");
  }

  const validLines = lines.filter(
    (l) => l.account && (l.debit > 0 || l.credit > 0)
  );
  if (validLines.length < 2) throw new Error("Дор хаяж 2 мөр оруулна уу");

  const accounts = await db.query.chartOfAccounts.findMany({
    where: and(
      eq(chartOfAccounts.organizationId, orgId),
      eq(chartOfAccounts.isEnabled, true)
    ),
    columns: { number: true },
  });
  const enabledMains = new Set(accounts.map((account) => account.number));
  const bad = validLines.find(
    (l) => !enabledMains.has(parseSegParts(l.account, [3])[3] ?? "")
  );
  if (bad) throw new Error(`"${bad.account}" данс идэвхтэй жагсаалтад алга`);

  return validLines;
}

/** Батлагдах журналын нийлбэрийн шалгалт: ΣДебет > 0, тэнцвэр ≤ 0.01. */
function assertBalanced(lines: { debit: number; credit: number }[]) {
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
  if (!(totalDebit > 0)) throw new Error("Хоосон журнал батлагдахгүй");
  if (Math.abs(totalDebit - totalCredit) > 0.01)
    throw new Error("Дебет ба кредит тэнцэхгүй байна");
}

export async function createVoucher(data: {
  date: string;
  description: string;
  lines: LineInput[];
  status?: "draft" | "posted";
  /** Гадаад системийн давтагдашгүй дугаар — idempotency түлхүүр. */
  externalRef?: string;
}) {
  const { orgId, userId } = await requireRole("accountant");
  const status = data.status ?? "posted";
  // Хаагдсан период руу шинэ бичилт хийхгүй (ноорог ч мөн адил — тэр нь
  // хожим батлагдах гэж гацна).
  await assertPeriodOpen(orgId, data.date);

  const validLines = await validateVoucherLines(orgId, data.lines);
  if (status === "posted") assertBalanced(validLines);

  const voucherId = await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, data.date);
    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: data.date,
        description: data.description,
        status,
        externalRef: data.externalRef?.trim() || null,
      })
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
    if (status === "posted")
      await logAuditEvent(
        {
          userId,
          organizationId: orgId,
          action: "create_posted",
          entityType: "journal",
          entityId: voucher.id,
          summary: `Журнал шууд бичигдэв — ${data.date}, ${data.description}, дүн ${validLines.reduce((s, l) => s + l.debit, 0).toLocaleString("en-US")}₮`,
        },
        tx
      );
    return voucher.id;
  });

  // Reverse-sync into the cash subledger when posted directly.
  // Sync унавал журнал аль хэдийн батлагдсан тул алдаа шидэхгүй —
  // reconcile_modules зөрүүг илрүүлж өөрөө засна (self-healing).
  if (status === "posted") {
    try {
      await syncDraftCashDocumentForVoucher(voucherId);
      await syncInventoryDraftForVoucher(voucherId);
      await syncFixedAssetDraftForVoucher(voucherId);
    } catch (caught) {
      console.error(
        `createVoucher: subledger sync failed for voucher ${voucherId}`,
        caught
      );
    }
  }

  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
  return { id: voucherId };
}

export async function postVoucher(id: string) {
  const { orgId, userId } = await requireRole("accountant");

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, id),
      eq(journalVouchers.organizationId, orgId)
    ),
    with: { lines: true },
  });
  if (!voucher) throw new Error("Бичилт олдсонгүй");
  if (voucher.status === "posted") return;
  await assertPeriodOpen(orgId, voucher.date);

  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, voucher.date);
    // Atomic claim: давхар товшилт/зэрэгцээ post нэг л удаа sync ажиллуулна.
    const [claimed] = await tx
      .update(journalVouchers)
      .set({ status: "posted" })
      .where(
        and(
          eq(journalVouchers.id, id),
          eq(journalVouchers.organizationId, orgId),
          eq(journalVouchers.status, "draft")
        )
      )
      .returning({ date: journalVouchers.date });
    if (!claimed) throw new Error("Бичилтийн төлөв өөрчлөгдсөн байна");

    // Claim-ийн ДАРАА огноо/мөрүүдийг дахин шалгана — зэрэгцээ updateVoucher
    // огноо, мөрийг сольсон байж болзошгүй. Алдаа шидвэл транзакц буцна.
    if (claimed.date !== voucher.date)
      await assertPeriodOpenInTx(tx, orgId, claimed.date);
    const lines = await tx.query.journalLines.findMany({
      where: eq(journalLines.voucherId, id),
      columns: { debit: true, credit: true },
    });
    assertBalanced(
      lines.map((l) => ({ debit: Number(l.debit), credit: Number(l.credit) }))
    );
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "post",
        entityType: "journal",
        entityId: id,
        summary: `Журнал батлагдав — ${claimed.date}, ${voucher.description}, дүн ${lines.reduce((s, l) => s + Number(l.debit), 0).toLocaleString("en-US")}₮`,
      },
      tx
    );
  });

  // Reverse-sync into the cash subledger now that it's posted.
  // Sync унавал журнал аль хэдийн батлагдсан тул алдаа шидэхгүй —
  // reconcile_modules зөрүүг илрүүлж өөрөө засна (self-healing).
  try {
    await syncDraftCashDocumentForVoucher(id);
    await syncInventoryDraftForVoucher(id);
    await syncFixedAssetDraftForVoucher(id);
  } catch (caught) {
    console.error(
      `postVoucher: subledger sync failed for voucher ${id}`,
      caught
    );
  }

  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
}

/**
 * Журнал дэд дэвтрийн баримтад эзэмшигдсэн бол GL талаас буцаах/устгахыг
 * хориглоно — ЭХ БАРИМТААР нь удирдуулна (эс бөгөөс дэд дэвтэр статусаа
 * хадгалж GL-тэй зөрнө). sourceVoucherId-тэй НООРОГ кассын баримт
 * (батлагдаагүй sync санал) саад болохгүй — дуудагч removeDraftCashDocsFor-
 * Voucher-ээр цэвэрлэнэ.
 */
async function assertNotSubledgerOwned(
  orgId: string,
  id: string,
  lines: {
    costEntryId: string | null;
    inventoryMovementId: string | null;
  }[]
) {
  if (lines.some((line) => line.costEntryId || line.inventoryMovementId))
    throw new Error(
      "Өртгийн модулиас үүссэн журнал — өртгийн бичилтийг нь буцааж/устгаж удирдана"
    );

  const [cashRef, arapRef, faRef, costRef, fxRef] = await Promise.all([
    db.query.cashDocuments.findFirst({
      where: and(
        eq(cashDocuments.organizationId, orgId),
        or(
          eq(cashDocuments.voucherId, id),
          eq(cashDocuments.reversalVoucherId, id),
          and(
            eq(cashDocuments.sourceVoucherId, id),
            ne(cashDocuments.status, "draft")
          )
        )
      ),
      columns: { documentNo: true },
    }),
    db.query.arApDocuments.findFirst({
      where: and(
        eq(arApDocuments.organizationId, orgId),
        or(
          eq(arApDocuments.voucherId, id),
          eq(arApDocuments.reversalVoucherId, id)
        )
      ),
      columns: { documentNo: true },
    }),
    db.query.faDepreciationEntries.findFirst({
      where: and(
        eq(faDepreciationEntries.organizationId, orgId),
        eq(faDepreciationEntries.voucherId, id)
      ),
      columns: { id: true },
    }).then(async (entry) =>
      entry ??
      // ҮХ-ийн данснаас хасалтын журнал — мөн ҮХ модулиас удирдана.
      (await db.query.fixedAssets.findFirst({
        where: and(
          eq(fixedAssets.organizationId, orgId),
          eq(fixedAssets.disposalVoucherId, id)
        ),
        columns: { id: true },
      }))
    ),
    db.query.costEntries.findFirst({
      where: and(
        eq(costEntries.organizationId, orgId),
        eq(costEntries.voucherId, id)
      ),
      columns: { id: true },
    }),
    db.query.cashFxRevaluations.findFirst({
      where: and(
        eq(cashFxRevaluations.organizationId, orgId),
        eq(cashFxRevaluations.voucherId, id)
      ),
      columns: { id: true },
    }),
  ]);
  if (cashRef)
    throw new Error(
      `Кассын ${cashRef.documentNo} баримттай холбоотой журнал — Мөнгөн хөрөнгө хэсгээс баримтыг нь удирдана уу`
    );
  if (arapRef)
    throw new Error(
      `АР/АП-ийн ${arapRef.documentNo} баримттай холбоотой журнал — нэхэмжлэхийг нь удирдана уу`
    );
  if (faRef)
    throw new Error(
      "Үндсэн хөрөнгийн бичилттэй (элэгдэл/хасалт) холбоотой журнал — ҮХ модулиас удирдана"
    );
  if (costRef)
    throw new Error(
      "Өртгийн бичилттэй холбоотой журнал — өртгийн модулиас удирдана"
    );
  if (fxRef)
    throw new Error(
      "Ханшийн тэгшитгэлийн журнал — Тулгалт, ханш хэсгээс буцаана"
    );
}

export async function unpostVoucher(id: string) {
  const { orgId, userId } = await requireRole("accountant");

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, id),
      eq(journalVouchers.organizationId, orgId)
    ),
    with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
  });
  if (!voucher) throw new Error("Бичилт олдсонгүй");
  if (voucher.status !== "posted")
    throw new Error("Зөвхөн бичигдсэн журналыг буцаах боломжтой");
  // Буцаалт нь ЭХ огноогоор шинэ журнал бичдэг тул тэр период нээлттэй байх ёстой.
  await assertPeriodOpen(orgId, voucher.date);
  // Дэд дэвтрийн (касс, АР/АП, элэгдэл, өртөг, ханш) журналыг GL талаас
  // буцаавал эх баримт нь "posted" хэвээр үлдэж модуль GL хоёр зөрдөг —
  // тиймээс эх баримтаар нь буцаана.
  await assertNotSubledgerOwned(orgId, id, voucher.lines);

  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, voucher.date);
    const [claimed] = await tx
      .update(journalVouchers)
      .set({ status: "reversed" })
      .where(
        and(
          eq(journalVouchers.id, id),
          eq(journalVouchers.organizationId, orgId),
          eq(journalVouchers.status, "posted")
        )
      )
      .returning({ id: journalVouchers.id });
    if (!claimed) throw new Error("Бичилтийн төлөв өөрчлөгдсөн байна");

    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: voucher.date,
        description: `Буцаалт: ${voucher.description}`,
        status: "posted",
        // Эх журналтайгаа хосолно: эхийг устгавал буцаалт FK cascade-аар
        // хамт устана; буцаалтыг дангаар устгахыг deleteVoucher хориглоно.
        reversalOfVoucherId: id,
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
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "unpost",
        entityType: "journal",
        entityId: id,
        summary: `Журнал буцаагдав — ${voucher.date}, ${voucher.description}, дүн ${voucher.lines.reduce((s, l) => s + Number(l.debit), 0).toLocaleString("en-US")}₮`,
      },
      tx
    );
  });

  // Эх бичилт нь буцаагдсан тул түүнээс үүссэн бөглөгдөөгүй inventory
  // draft, FA ноорог карт, кассын sync-ноорог хүчингүй — устгана.
  await removeDraftMovementsForVoucher(id);
  await removeDraftAssetsForVoucher(id);
  await removeDraftCashDocsForVoucher(id);

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
  const { orgId } = await requireRole("accountant");

  await assertPeriodOpen(orgId, data.date);

  const validLines = await validateVoucherLines(orgId, data.lines);
  if (data.status === "posted") assertBalanced(validLines);

  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, data.date);
    const existing = await tx.query.journalVouchers.findFirst({
      where: and(
        eq(journalVouchers.id, id),
        eq(journalVouchers.organizationId, orgId)
      ),
      columns: { status: true },
    });
    if (!existing) throw new Error("Бичилт олдсонгүй");
    if (existing.status !== "draft")
      throw new Error("Зөвхөн ноорог журналыг засах боломжтой");

    await tx
      .update(journalVouchers)
      .set({ date: data.date, description: data.description, status: data.status })
      .where(
        and(
          eq(journalVouchers.id, id),
          eq(journalVouchers.organizationId, orgId)
        )
      );

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

  // Засварын формоос шууд post хийхэд ч subledger sync-үүд ажиллана —
  // postVoucher-тэй ижил зам. Sync унавал журнал аль хэдийн батлагдсан тул
  // алдаа шидэхгүй — reconcile_modules өөрөө засна (self-healing).
  if (data.status === "posted") {
    try {
      await syncDraftCashDocumentForVoucher(id);
      await syncInventoryDraftForVoucher(id);
      await syncFixedAssetDraftForVoucher(id);
    } catch (caught) {
      console.error(
        `updateVoucher: subledger sync failed for voucher ${id}`,
        caught
      );
    }
  }

  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
}

/**
 * Журнал устгах. Ноорог — шууд. БАТЛАГДСАН журналыг мөн устгаж болно
 * (сторно биш — GL-ээс бүрмөсөн хасна), гэхдээ:
 *   - период нээлттэй байх
 *   - дэд дэвтрийн баримттай (касс, АР/АП, элэгдэл, өртөг, ханшийн
 *     тэгшитгэл) холбоотой бол ЭХ БАРИМТААР нь устгуулахаар чиглүүлнэ —
 *     эс бөгөөс дэд дэвтэр GL хоёр зөрнө.
 */
export async function deleteVoucher(id: string) {
  const { orgId, userId } = await requireRole("accountant");

  const existing = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, id),
      eq(journalVouchers.organizationId, orgId)
    ),
    with: {
      lines: { columns: { costEntryId: true, inventoryMovementId: true } },
    },
  });
  if (!existing) throw new Error("Бичилт олдсонгүй");

  // Буцаалтын журналыг дангаар нь устгавал эх нь "reversed" статустай атлаа
  // тайланд бүрэн тоологдож сэргэнэ — эхээр нь удирдуулна (эхийг устгахад
  // буцаалт нь FK cascade-аар хамт устана).
  if (existing.reversalOfVoucherId)
    throw new Error(
      "Буцаалтын журналыг дангаар нь устгахгүй — эх журналаар нь удирдана уу"
    );

  if (existing.status !== "draft") {
    await assertPeriodOpen(orgId, existing.date);
    // Дэд дэвтрийн баримттай журнал — эх баримтаар нь устгуулна.
    // sourceVoucherId-тэй НООРОГ кассын баримт саад болохгүй (доор цэвэрлэнэ).
    await assertNotSubledgerOwned(orgId, id, existing.lines);
  }

  // Энэ журналаас sync-ээр үүссэн ноорог (бараа, ҮХ, касс) хамт цэвэрлэгдэнэ.
  // Эхийг устгахад буцаалт нь cascade-аар устах тул буцаалтын журналын
  // sync-ноорогуудыг ч мөн цэвэрлэнэ.
  const reversals = await db.query.journalVouchers.findMany({
    where: and(
      eq(journalVouchers.organizationId, orgId),
      eq(journalVouchers.reversalOfVoucherId, id)
    ),
    columns: { id: true },
  });
  for (const voucherId of [id, ...reversals.map((r) => r.id)]) {
    await removeDraftMovementsForVoucher(voucherId);
    await removeDraftAssetsForVoucher(voucherId);
    await removeDraftCashDocsForVoucher(voucherId);
  }

  // Статус шалгасан үеийнхээс өөрчлөгдсөн бол (ноорог зэрэгцээ батлагдсан
  // г.м.) устгахгүй — дээрх период/subledger шалгалтууд хүчингүй болсон.
  const [deleted] = await db
    .delete(journalVouchers)
    .where(
      and(
        eq(journalVouchers.id, id),
        eq(journalVouchers.organizationId, orgId),
        eq(journalVouchers.status, existing.status)
      )
    )
    .returning({ id: journalVouchers.id });
  if (!deleted) throw new Error("Бичилтийн төлөв өөрчлөгдсөн байна — дахин оролдоно уу");

  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "delete",
    entityType: "journal",
    entityId: id,
    summary: `Журнал устгагдав — ${existing.date}, ${existing.description} (өмнөх төлөв: ${existing.status})`,
  });

  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
}

/**
 * Журналыг өнөөдрийн огноогоор НООРОГ болгон хуулбарлана — сар бүр давтагддаг
 * бичилтэд. Ноорог тул модулийн sync-үүд хөндөгдөхгүй (тэдгээр нь posted
 * журналаас л үүсдэг).
 */
export async function duplicateVoucher(id: string) {
  const { orgId, userId } = await requireRole("accountant");

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, id),
      eq(journalVouchers.organizationId, orgId)
    ),
    with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
  });
  if (!voucher) throw new Error("Бичилт олдсонгүй");
  // Буцаалтын журналын дүн сөрөг байдаг; createVoucher/updateVoucher нь
  // сөрөг мөрийг шүүж хаядаг тул хуулбар нь хадгалагдахгүй ноорог болно.
  if (
    voucher.lines.some(
      (line) => Number(line.debit) < 0 || Number(line.credit) < 0
    )
  )
    throw new Error(
      "Буцаалтын журналыг хуулбарлах боломжгүй — эх журналыг нь хуулбарлана уу"
    );

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Ulaanbaatar",
  });

  const copyId = await db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: today,
        description: voucher.description,
        status: "draft",
      })
      .returning({ id: journalVouchers.id });
    await tx.insert(journalLines).values(
      voucher.lines.map((line, index) => ({
        voucherId: copy.id,
        accountNumber: line.accountNumber,
        debit: line.debit,
        credit: line.credit,
        description: line.description,
        sortOrder: index,
      }))
    );
    return copy.id;
  });

  revalidatePath("/gl/journal");
  revalidatePath("/gl");
  return { id: copyId };
}

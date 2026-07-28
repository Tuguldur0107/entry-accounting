"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { assertPeriodOpen } from "@/lib/periods/guard";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  faDepreciationEntries,
  fixedAssets,
  journalLines,
  journalVouchers,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { buildSegCode } from "@/lib/grid/segments";
import {
  computeMonthlyDepreciation,
  isDepreciationMethod,
  type FixedAssetRef,
} from "@/lib/fa/depreciation";
import {
  loadFixedAssetViews,
  type FixedAssetView,
} from "@/lib/fa/asset-views";
import {
  loadSegmentPickerData,
  type SegmentPickerData,
} from "@/lib/gl/segment-picker-data";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Нэвтрэх шаардлагатай");
  return session.user.id;
}

function revalidateFa() {
  for (const path of ["/fa", "/fa/assets", "/fa/depreciation", "/gl/journal", "/gl/reports"])
    revalidatePath(path);
}

async function assertEnabledMainAccount(userId: string, accountNumber: string) {
  const account = await db.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.userId, userId),
      eq(chartOfAccounts.number, accountNumber),
      eq(chartOfAccounts.isEnabled, true)
    ),
    columns: { id: true },
  });
  if (!account)
    throw new Error(`${accountNumber} идэвхтэй GL данс олдсонгүй — тохиргоог шалгана уу`);
}

// cashPostingCodeBuilder-ийн клон: S9 = "FA".
async function faPostingCodeBuilder(userId: string) {
  const [configs, values] = await Promise.all([
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.userId, userId) }),
    db.query.segmentValues.findMany({
      where: and(eq(segmentValues.userId, userId), eq(segmentValues.isEnabled, true)),
    }),
  ]);
  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (definition) =>
      definition.id === 3 || configMap.get(definition.id)?.isEnabled === true
  ).map((definition) => definition.id);
  const defaults: Record<number, string> = {};
  for (const segmentId of activeSegIds) {
    const options = values.filter((value) => value.segmentId === segmentId);
    if (options.length === 1) defaults[segmentId] = options[0].code;
  }
  if (activeSegIds.includes(9)) defaults[9] = "FA";
  return (mainAccount: string) =>
    buildSegCode({ ...defaults, 3: mainAccount }, activeSegIds, {
      ...defaults,
      9: "FA",
    });
}

// ─── Панелийн өгөгдөл ────────────────────────────────────────────────────────

/**
 * Хөрөнгийн панелиудын өгөгдөл. `asset` нь:
 *   - дэлгэрэнгүй панель / идэвхжүүлэх форм → тухайн карт;
 *   - шинэ хөрөнгийн форм (assetId өгөөгүй) → null.
 * Сегментийн сонголтууд формын AccountInput-уудад хэрэгтэй.
 */
export interface FaAssetPanelData extends SegmentPickerData {
  asset: FixedAssetView | null;
}

// Алдааг throw хийхгүй — production build дээр Next.js server action-ий
// error message-ийг нууж "An error occurred..." болгодог тул код буцаана.
export type FaAssetPanelResult =
  | { ok: true; data: FaAssetPanelData }
  | { ok: false; code: "unauthenticated" | "not-found" };

// Панель клиентээс нээгддэг тул өгөгдлөө энэ action-аар татна. Жагсаалтын
// хуудастай НЭГ хэрэгжилт — loadFixedAssetViews (lib/fa/asset-views.ts).
export async function getFaAssetPanelData(
  assetId?: string
): Promise<FaAssetPanelResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "unauthenticated" };

  const [views, segmentData] = await Promise.all([
    assetId ? loadFixedAssetViews(userId, assetId) : Promise.resolve([]),
    loadSegmentPickerData(userId),
  ]);
  const asset = views[0] ?? null;
  if (assetId && !asset) return { ok: false, code: "not-found" };

  return { ok: true, data: { asset, ...segmentData } };
}

// ─── Хөрөнгийн карт ──────────────────────────────────────────────────────────

export interface FixedAssetInput {
  code?: string;
  name: string;
  acquisitionDate: string;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  depreciationMethod: string;
  custodian: string;
  depreciationStartMonth: string;
  assetAccountNumber: string;
  accumDepAccountNumber: string;
  depExpenseAccountNumber: string;
}

function validateAssetInput(data: FixedAssetInput) {
  if (!data.name.trim()) throw new Error("Хөрөнгийн нэр оруулна уу");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.acquisitionDate))
    throw new Error("Огноо буруу байна");
  const cost = Number(data.cost);
  if (!Number.isFinite(cost) || cost <= 0) throw new Error("Өртөг 0-ээс их байна");
  const salvage = Number(data.salvageValue);
  if (!Number.isFinite(salvage) || salvage < 0 || salvage >= cost)
    throw new Error("Үлдэх өртөг 0-ээс их/тэнцүү, өртгөөс бага байна");
  if (!Number.isInteger(data.usefulLifeMonths) || data.usefulLifeMonths <= 0)
    throw new Error("Ашиглалтын хугацаа (сар) 0-ээс их бүхэл тоо байна");
  if (!/^\d{4}-\d{2}$/.test(data.depreciationStartMonth))
    throw new Error("Элэгдэл эхлэх сар (YYYY-MM) буруу байна");
  if (!isDepreciationMethod(data.depreciationMethod))
    throw new Error("Элэгдлийн арга буруу байна");
  if (typeof data.custodian !== "string" || !data.custodian.trim())
    throw new Error("Хөрөнгө эзэмшигч (хариуцагч) оруулна уу");
}

export async function createFixedAsset(data: FixedAssetInput) {
  const userId = await requireUser();
  validateAssetInput(data);
  await assertEnabledMainAccount(userId, data.assetAccountNumber.trim());
  await assertEnabledMainAccount(userId, data.accumDepAccountNumber.trim());
  await assertEnabledMainAccount(userId, data.depExpenseAccountNumber.trim());

  const manualCode = data.code?.trim();
  if (manualCode && manualCode.length > 40)
    throw new Error("Код 40 тэмдэгтээс хэтрэхгүй");
  if (manualCode) {
    const duplicate = await db.query.fixedAssets.findFirst({
      where: and(eq(fixedAssets.userId, userId), eq(fixedAssets.code, manualCode)),
      columns: { id: true },
    });
    if (duplicate) throw new Error(`"${manualCode}" кодтой хөрөнгө бүртгэгдсэн`);
  }
  const code =
    manualCode ||
    `FA-${data.acquisitionDate.replaceAll("-", "")}-${crypto
      .randomUUID()
      .slice(0, 6)
      .toUpperCase()}`;

  await db.insert(fixedAssets).values({
    userId,
    code,
    name: data.name.trim(),
    acquisitionDate: data.acquisitionDate,
    cost: String(Math.round(Number(data.cost) * 100) / 100),
    salvageValue: String(Math.round(Number(data.salvageValue) * 100) / 100),
    usefulLifeMonths: data.usefulLifeMonths,
    depreciationMethod: data.depreciationMethod,
    custodian: data.custodian.trim().slice(0, 120),
    depreciationStartMonth: data.depreciationStartMonth,
    assetAccountNumber: data.assetAccountNumber.trim(),
    accumDepAccountNumber: data.accumDepAccountNumber.trim(),
    depExpenseAccountNumber: data.depExpenseAccountNumber.trim(),
    status: "active",
  });
  revalidateFa();
}

// Ноорог картыг (гараар үүсгэсэн эсвэл АП/GL sync-ээс ирсэн) бөглөж
// идэвхжүүлнэ. GL бичилт хийхгүй — өртөг эх сувагтаа данслагдсан.
export async function activateFixedAsset(id: string, data: FixedAssetInput) {
  const userId = await requireUser();
  validateAssetInput(data);
  await assertEnabledMainAccount(userId, data.assetAccountNumber.trim());
  await assertEnabledMainAccount(userId, data.accumDepAccountNumber.trim());
  await assertEnabledMainAccount(userId, data.depExpenseAccountNumber.trim());

  const asset = await db.query.fixedAssets.findFirst({
    where: and(eq(fixedAssets.id, id), eq(fixedAssets.userId, userId)),
    columns: { status: true },
  });
  if (!asset) throw new Error("Хөрөнгө олдсонгүй");
  if (asset.status !== "draft")
    throw new Error("Зөвхөн ноорог картыг идэвхжүүлнэ");

  const [claimed] = await db
    .update(fixedAssets)
    .set({
      name: data.name.trim(),
      acquisitionDate: data.acquisitionDate,
      cost: String(Math.round(Number(data.cost) * 100) / 100),
      salvageValue: String(Math.round(Number(data.salvageValue) * 100) / 100),
      usefulLifeMonths: data.usefulLifeMonths,
      depreciationMethod: data.depreciationMethod,
      custodian: data.custodian.trim().slice(0, 120),
      depreciationStartMonth: data.depreciationStartMonth,
      assetAccountNumber: data.assetAccountNumber.trim(),
      accumDepAccountNumber: data.accumDepAccountNumber.trim(),
      depExpenseAccountNumber: data.depExpenseAccountNumber.trim(),
      status: "active",
    })
    .where(
      and(
        eq(fixedAssets.id, id),
        eq(fixedAssets.userId, userId),
        eq(fixedAssets.status, "draft")
      )
    )
    .returning({ id: fixedAssets.id });
  if (!claimed) throw new Error("Картын төлөв өөрчлөгдсөн байна");
  revalidateFa();
}

export async function deleteFixedAsset(id: string) {
  const userId = await requireUser();
  const asset = await db.query.fixedAssets.findFirst({
    where: and(eq(fixedAssets.id, id), eq(fixedAssets.userId, userId)),
    columns: { status: true },
  });
  if (!asset) return;
  if (asset.status !== "draft")
    throw new Error("Зөвхөн ноорог картыг устгана");
  await db
    .delete(fixedAssets)
    .where(and(eq(fixedAssets.id, id), eq(fixedAssets.userId, userId)));
  revalidateFa();
}

// ─── Элэгдлийн run ───────────────────────────────────────────────────────────

export async function runDepreciation(data: { month: string }) {
  const userId = await requireUser();
  if (!/^\d{4}-\d{2}$/.test(data.month))
    throw new Error("Сар (YYYY-MM) буруу байна");

  return await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), 3)`);

    const [assets, entries] = await Promise.all([
      tx.query.fixedAssets.findMany({
        where: and(eq(fixedAssets.userId, userId), eq(fixedAssets.status, "active")),
      }),
      tx.query.faDepreciationEntries.findMany({
        where: and(
          eq(faDepreciationEntries.userId, userId),
          inArray(faDepreciationEntries.status, ["draft", "posted"])
        ),
      }),
    ]);

    const assetRefs: FixedAssetRef[] = assets.map((asset) => ({
      id: asset.id,
      cost: Number(asset.cost),
      salvageValue: Number(asset.salvageValue),
      usefulLifeMonths: asset.usefulLifeMonths,
      method: isDepreciationMethod(asset.depreciationMethod)
        ? asset.depreciationMethod
        : "straight_line",
      depreciationStartMonth: asset.depreciationStartMonth,
      status: asset.status,
    }));
    const postedAccum = new Map<string, number>();
    const alreadyCharged = new Set<string>();
    for (const entry of entries) {
      postedAccum.set(
        entry.assetId,
        (postedAccum.get(entry.assetId) ?? 0) + Number(entry.amount)
      );
      if (entry.periodMonth === data.month) alreadyCharged.add(entry.assetId);
    }

    const computed = computeMonthlyDepreciation({
      assets: assetRefs,
      postedAccum,
      alreadyCharged,
      month: data.month,
    });
    if (computed.length === 0) return { created: 0 };

    await tx.insert(faDepreciationEntries).values(
      computed.map((entry) => ({
        userId,
        assetId: entry.assetId,
        periodMonth: data.month,
        amount: String(entry.amount),
      }))
    );
    return { created: computed.length };
  }).then((result) => {
    revalidateFa();
    return result;
  });
}

export async function postDepreciationEntry(id: string) {
  const userId = await requireUser();
  const entry = await db.query.faDepreciationEntries.findFirst({
    where: and(
      eq(faDepreciationEntries.id, id),
      eq(faDepreciationEntries.userId, userId)
    ),
    with: { asset: true },
  });
  if (!entry) throw new Error("Элэгдлийн бичилт олдсонгүй");
  if (entry.status !== "draft")
    throw new Error("Зөвхөн ноорог бичилтийг батална");
  await assertPeriodOpen(userId, `${entry.periodMonth}-28`);
  const amount = Number(entry.amount);
  if (!(amount > 0)) throw new Error("Дүн 0-ээс их байна");

  await assertEnabledMainAccount(userId, entry.asset.depExpenseAccountNumber);
  await assertEnabledMainAccount(userId, entry.asset.accumDepAccountNumber);
  const buildCode = await faPostingCodeBuilder(userId);
  const description = `[${entry.asset.code}] ${entry.asset.name} — ${entry.periodMonth} сарын элэгдэл`;

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(faDepreciationEntries)
      .set({ status: "posted", postedAt: new Date() })
      .where(
        and(
          eq(faDepreciationEntries.id, id),
          eq(faDepreciationEntries.userId, userId),
          eq(faDepreciationEntries.status, "draft")
        )
      )
      .returning({ id: faDepreciationEntries.id });
    if (!claimed) throw new Error("Бичилтийн төлөв өөрчлөгдсөн байна");

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        date: `${entry.periodMonth}-28`,
        description,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });

    await tx.insert(journalLines).values([
      {
        voucherId: voucher.id,
        accountNumber: buildCode(entry.asset.depExpenseAccountNumber),
        debit: String(amount),
        credit: "0",
        description,
        sortOrder: 0,
      },
      {
        voucherId: voucher.id,
        accountNumber: buildCode(entry.asset.accumDepAccountNumber),
        debit: "0",
        credit: String(amount),
        description,
        sortOrder: 1,
      },
    ]);

    await tx
      .update(faDepreciationEntries)
      .set({ voucherId: voucher.id })
      .where(eq(faDepreciationEntries.id, id));
  });

  revalidateFa();
}

export async function postDepreciationEntries(ids: string[]) {
  const failures: { id: string; error: string }[] = [];
  let posted = 0;
  for (const id of ids) {
    try {
      await postDepreciationEntry(id);
      posted += 1;
    } catch (caught) {
      failures.push({
        id,
        error: caught instanceof Error ? caught.message : "Батлагдсангүй",
      });
    }
  }
  return { posted, failures };
}

export async function deleteDepreciationEntry(id: string) {
  const userId = await requireUser();
  const entry = await db.query.faDepreciationEntries.findFirst({
    where: and(
      eq(faDepreciationEntries.id, id),
      eq(faDepreciationEntries.userId, userId)
    ),
    columns: { status: true },
  });
  if (!entry) return;
  if (entry.status !== "draft")
    throw new Error("Зөвхөн ноорог бичилтийг устгана");
  await db
    .delete(faDepreciationEntries)
    .where(
      and(eq(faDepreciationEntries.id, id), eq(faDepreciationEntries.userId, userId))
    );
  revalidateFa();
}

export async function reverseDepreciationEntry(id: string) {
  const userId = await requireUser();
  const entry = await db.query.faDepreciationEntries.findFirst({
    where: and(
      eq(faDepreciationEntries.id, id),
      eq(faDepreciationEntries.userId, userId)
    ),
    with: { asset: true },
  });
  if (!entry || entry.status !== "posted" || !entry.voucherId)
    throw new Error("Зөвхөн батлагдсан бичилтийг буцаана");
  await assertPeriodOpen(userId, `${entry.periodMonth}-28`);

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, entry.voucherId),
      eq(journalVouchers.userId, userId)
    ),
    with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
  });
  if (!voucher) throw new Error("Холбоотой GL журнал олдсонгүй");

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(faDepreciationEntries)
      .set({ status: "reversed" })
      .where(
        and(
          eq(faDepreciationEntries.id, id),
          eq(faDepreciationEntries.userId, userId),
          eq(faDepreciationEntries.status, "posted")
        )
      )
      .returning({ id: faDepreciationEntries.id });
    if (!claimed) throw new Error("Бичилтийн төлөв өөрчлөгдсөн байна");

    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        date: voucher.date,
        description: `Буцаалт: ${voucher.description}`,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });

    await tx.insert(journalLines).values(
      voucher.lines.map((line, index) => ({
        voucherId: reversal.id,
        accountNumber: line.accountNumber,
        debit: line.credit,
        credit: line.debit,
        description: line.description,
        sortOrder: index,
      }))
    );

    const [voucherClaimed] = await tx
      .update(journalVouchers)
      .set({ status: "reversed" })
      .where(
        and(eq(journalVouchers.id, voucher.id), eq(journalVouchers.status, "posted"))
      )
      .returning({ id: journalVouchers.id });
    if (!voucherClaimed)
      throw new Error("GL журнал аль хэдийн буцаагдсан байна");

    await tx
      .update(faDepreciationEntries)
      .set({ reversalVoucherId: reversal.id })
      .where(eq(faDepreciationEntries.id, id));
  });

  revalidateFa();
}

"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { getActiveOrg, requireModuleAction } from "@/lib/auth";
import { assertPeriodOpen, assertPeriodOpenInTx } from "@/lib/periods/guard";
import { moduleOfVoucherNo, nextVoucherNo } from "@/lib/gl/voucher-no";
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
import { postingCodeBuilderFromData } from "@/lib/gl/posting-code";
import {
  basisOf,
  loadFaSettings,
  saveFaDepreciationBasis,
} from "@/lib/fa/settings";
import {
  computeMonthlyDepreciation,
  isDepreciationBasis,
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
import { logAuditEvent } from "@/lib/audit";
import { actionError, type ActionResult } from "@/lib/action-result";
import { deleteAttachmentsFor } from "@/lib/attachments/cleanup";
import { roundMoney as round2 } from "@/lib/arap/accounting";

function revalidateFa() {
  for (const path of ["/fa", "/fa/assets", "/fa/depreciation", "/gl/journal", "/gl/reports"])
    revalidatePath(path);
}

async function assertEnabledMainAccount(orgId: string, accountNumber: string) {
  const account = await db.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.organizationId, orgId),
      eq(chartOfAccounts.number, accountNumber),
      eq(chartOfAccounts.isEnabled, true)
    ),
    columns: { id: true },
  });
  if (!account)
    throw new Error(`${accountNumber} идэвхтэй GL данс олдсонгүй — тохиргоог шалгана уу`);
}

// Цөм дүрэм нэг эх сурвалжтай (lib/gl/posting-code.ts); S9 = "FA".
async function faPostingCodeBuilder(orgId: string) {
  const [configs, values] = await Promise.all([
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.organizationId, orgId) }),
    db.query.segmentValues.findMany({
      where: and(eq(segmentValues.organizationId, orgId), eq(segmentValues.isEnabled, true)),
    }),
  ]);
  return postingCodeBuilderFromData({ configs, values, moduleTag: "FA" });
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
  const active = await getActiveOrg().catch(() => null);
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId } = active;

  const [views, segmentData] = await Promise.all([
    assetId ? loadFixedAssetViews(orgId, assetId) : Promise.resolve([]),
    loadSegmentPickerData(orgId),
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
  /** Байршил / дэд байршил — картын жагсаалт, тооллогод. */
  location?: string;
  subLocation?: string;
  depreciationStartMonth: string;
  /** Элэгдэл эхлэх ОГНОО (YYYY-MM-DD) — өдрийн суурьт хувь тэнцүүлэлтэд. */
  depreciationStartDate?: string;
  /** ТАТВАРЫН хугацаа/арга (cit.md); 0 = татварын элэгдэл бодохгүй. */
  taxUsefulLifeMonths?: number;
  taxDepreciationMethod?: string;
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
  if (
    data.depreciationStartDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(data.depreciationStartDate)
  )
    throw new Error("Элэгдэл эхлэх огноо (YYYY-MM-DD) буруу байна");
  if (
    data.depreciationStartDate &&
    !data.depreciationStartDate.startsWith(data.depreciationStartMonth)
  )
    throw new Error("Элэгдэл эхлэх огноо нь эхлэх сартайгаа таарахгүй байна");
  const taxLife = Number(data.taxUsefulLifeMonths ?? 0);
  if (!Number.isInteger(taxLife) || taxLife < 0)
    throw new Error("Татварын ашиглалтын хугацаа сөрөг бус бүхэл тоо байна");
  if (
    data.taxDepreciationMethod &&
    !isDepreciationMethod(data.taxDepreciationMethod)
  )
    throw new Error("Татварын элэгдлийн арга буруу байна");
}

/** Картын шинэ талбаруудыг DB-ийн утга болгоно (create/activate хоёуланд). */
function assetExtraValues(data: FixedAssetInput) {
  return {
    location: data.location?.trim() || null,
    subLocation: data.subLocation?.trim() || null,
    depreciationStartDate: data.depreciationStartDate?.trim() || null,
    taxUsefulLifeMonths: Number(data.taxUsefulLifeMonths ?? 0),
    taxDepreciationMethod: data.taxDepreciationMethod?.trim() || "straight_line",
  };
}

export async function createFixedAsset(
  data: FixedAssetInput,
  options?: {
    /** true бол "draft" төлөвтэй карт үүсгэнэ (AI туслах §9 — хэрэглэгч
     * шалгаж идэвхжүүлнэ; АП sync-ийн draft карттай ижил урсгал). */
    asDraft?: boolean;
  }
) {
  const { orgId, userId } = await requireModuleAction("fa", "write");
  validateAssetInput(data);
  await assertEnabledMainAccount(orgId, data.assetAccountNumber.trim());
  await assertEnabledMainAccount(orgId, data.accumDepAccountNumber.trim());
  await assertEnabledMainAccount(orgId, data.depExpenseAccountNumber.trim());

  const manualCode = data.code?.trim();
  if (manualCode && manualCode.length > 40)
    throw new Error("Код 40 тэмдэгтээс хэтрэхгүй");
  if (manualCode) {
    const duplicate = await db.query.fixedAssets.findFirst({
      where: and(eq(fixedAssets.organizationId, orgId), eq(fixedAssets.code, manualCode)),
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

  const [created] = await db
    .insert(fixedAssets)
    .values({
      userId,
      organizationId: orgId,
      code,
      name: data.name.trim(),
      acquisitionDate: data.acquisitionDate,
      cost: String(Math.round(Number(data.cost) * 100) / 100),
      salvageValue: String(Math.round(Number(data.salvageValue) * 100) / 100),
      usefulLifeMonths: data.usefulLifeMonths,
      depreciationMethod: data.depreciationMethod,
      custodian: data.custodian.trim().slice(0, 120),
      ...assetExtraValues(data),
      depreciationStartMonth: data.depreciationStartMonth,
      assetAccountNumber: data.assetAccountNumber.trim(),
      accumDepAccountNumber: data.accumDepAccountNumber.trim(),
      depExpenseAccountNumber: data.depExpenseAccountNumber.trim(),
      status: options?.asDraft ? "draft" : "active",
    })
    .returning({ id: fixedAssets.id });
  revalidateFa();
  return { id: created.id, code };
}

// Ноорог картыг (гараар үүсгэсэн эсвэл АП/GL sync-ээс ирсэн) бөглөж
// идэвхжүүлнэ. GL бичилт хийхгүй — өртөг эх сувагтаа данслагдсан.
export async function activateFixedAsset(id: string, data: FixedAssetInput) {
  const { orgId } = await requireModuleAction("fa", "write");
  validateAssetInput(data);
  await assertEnabledMainAccount(orgId, data.assetAccountNumber.trim());
  await assertEnabledMainAccount(orgId, data.accumDepAccountNumber.trim());
  await assertEnabledMainAccount(orgId, data.depExpenseAccountNumber.trim());

  const asset = await db.query.fixedAssets.findFirst({
    where: and(eq(fixedAssets.id, id), eq(fixedAssets.organizationId, orgId)),
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
      ...assetExtraValues(data),
      depreciationStartMonth: data.depreciationStartMonth,
      assetAccountNumber: data.assetAccountNumber.trim(),
      accumDepAccountNumber: data.accumDepAccountNumber.trim(),
      depExpenseAccountNumber: data.depExpenseAccountNumber.trim(),
      status: "active",
    })
    .where(
      and(
        eq(fixedAssets.id, id),
        eq(fixedAssets.organizationId, orgId),
        eq(fixedAssets.status, "draft")
      )
    )
    .returning({ id: fixedAssets.id });
  if (!claimed) throw new Error("Картын төлөв өөрчлөгдсөн байна");
  revalidateFa();
}

/**
 * Идэвхжүүлэлтийг БУЦААХ (ҮХ-ийн орлогын буцаалт) — идэвхтэй картыг ноорог
 * руу буцаана. Элэгдлийн идэвхтэй (ноорог/батлагдсан) бичилттэй бол хориглоно
 * — эхлээд бичилтүүдийг нь устгаж/буцаана; буцаагдсан түүх саад болохгүй.
 * Атом claim (active→draft) давхар буцаалтыг таслана.
 */
export async function deactivateFixedAsset(id: string) {
  const { orgId, userId } = await requireModuleAction("fa", "write");
  const asset = await db.query.fixedAssets.findFirst({
    where: and(eq(fixedAssets.id, id), eq(fixedAssets.organizationId, orgId)),
    columns: { status: true, code: true, name: true },
  });
  if (!asset) throw new Error("Хөрөнгө олдсонгүй");
  if (asset.status !== "active")
    throw new Error("Зөвхөн идэвхтэй картын идэвхжүүлэлтийг буцаана");

  const activeEntry = await db.query.faDepreciationEntries.findFirst({
    where: and(
      eq(faDepreciationEntries.organizationId, orgId),
      eq(faDepreciationEntries.assetId, id),
      inArray(faDepreciationEntries.status, ["draft", "posted"])
    ),
    columns: { id: true },
  });
  if (activeEntry)
    throw new Error(
      `${asset.code} хөрөнгө элэгдлийн бичилттэй — эхлээд бичилтүүдийг нь устгаж/буцаана уу (ҮХ → Элэгдэл)`
    );

  const [claimed] = await db
    .update(fixedAssets)
    .set({ status: "draft" })
    .where(
      and(
        eq(fixedAssets.id, id),
        eq(fixedAssets.organizationId, orgId),
        eq(fixedAssets.status, "active")
      )
    )
    .returning({ id: fixedAssets.id });
  if (!claimed) throw new Error("Картын төлөв өөрчлөгдсөн байна");

  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "deactivate",
    entityType: "fa",
    entityId: id,
    summary: `ҮХ идэвхжүүлэлт буцаагдав — ${asset.code} ${asset.name}`,
  });
  revalidateFa();
}

/**
 * Хөрөнгийн карт устгах. Ноорог — шууд. ИДЭВХТЭЙ картыг мөн устгаж болно,
 * гэхдээ элэгдлийн бичилттэй (аль ч төлөвийн) бол блок — эхлээд элэгдлийн
 * бичилтүүдийг устгаж/буцааж байж картыг устгана (GL-тэй зөрөхөөс сэргийлнэ).
 */
export async function deleteFixedAsset(id: string) {
  const { orgId } = await requireModuleAction("fa", "write");
  const asset = await db.query.fixedAssets.findFirst({
    where: and(eq(fixedAssets.id, id), eq(fixedAssets.organizationId, orgId)),
    columns: { status: true, code: true },
  });
  if (!asset) return;

  if (asset.status !== "draft") {
    const entry = await db.query.faDepreciationEntries.findFirst({
      where: and(
        eq(faDepreciationEntries.organizationId, orgId),
        eq(faDepreciationEntries.assetId, id)
      ),
      columns: { id: true },
    });
    if (entry)
      throw new Error(
        `${asset.code} хөрөнгө элэгдлийн бичилттэй — эхлээд элэгдлийн бичилтүүдийг нь устгаж/буцаана уу (ҮХ → Элэгдэл)`
      );
  }

  await db
    .delete(fixedAssets)
    .where(and(eq(fixedAssets.id, id), eq(fixedAssets.organizationId, orgId)));
  // Хавсралт FK-гүй тул хөрөнгийнхийг өөрсдөө цэвэрлэнэ.
  await deleteAttachmentsFor(orgId, "fa", id);
  revalidateFa();
}

// ─── Элэгдлийн run ───────────────────────────────────────────────────────────

/**
 * Тухайн САРЫН элэгдлийг бодно — САНХҮҮГИЙН (GL-д бичигдэх) ба ТАТВАРЫН
 * (мэмо) дүнг зэрэг. Тохиргооны суурь (сар / өдөр) бүх картад үйлчилнэ.
 *
 * ДАХИН бодолт: тухайн сарын ноорог бичилтийг дарж бичнэ; БАТЛАГДСАН бол
 * GL журналыг нь АВТОМАТААР буцаагаад (аудитын мөр бүрэн) шинээр бодно —
 * ингэснээр журнал хэзээ ч ДАВХАРДАХГҮЙ.
 */
export async function runDepreciation(data: {
  month: string;
}): Promise<ActionResult<{ created: number; reversed: number }>> {
  try {
    return await runDepreciationCore(data);
  } catch (caught) {
    // PRODUCTION дээр шидсэн алдааны мессеж далдлагддаг (React #441) тул
    // хүлээгдэх алдааг УТГААР буцаана — lib/action-result.ts.
    return actionError("runDepreciation", caught, "Элэгдэл бодогдсонгүй");
  }
}

async function runDepreciationCore(data: { month: string }) {
  const { orgId, userId } = await requireModuleAction("fa", "write");
  if (!/^\d{4}-\d{2}$/.test(data.month))
    throw new Error("Сар (YYYY-MM) буруу байна");
  const postingDate = `${data.month}-28`;
  await assertPeriodOpen(orgId, postingDate);

  const settings = await loadFaSettings(orgId, userId);
  const basis = basisOf(settings);

  return await db
    .transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 3)`);
      await assertPeriodOpenInTx(tx, orgId, postingDate);

      const [assets, entries] = await Promise.all([
        tx.query.fixedAssets.findMany({
          where: and(
            eq(fixedAssets.organizationId, orgId),
            eq(fixedAssets.status, "active")
          ),
        }),
        tx.query.faDepreciationEntries.findMany({
          where: and(
            eq(faDepreciationEntries.organizationId, orgId),
            inArray(faDepreciationEntries.status, ["draft", "posted"])
          ),
          with: { asset: true },
        }),
      ]);

      // ── Тухайн сарын байгаа бичилтийг цэвэрлэнэ ──────────────────────
      const thisMonth = entries.filter((e) => e.periodMonth === data.month);
      const postedVoucherIds = new Set(
        thisMonth
          .filter((e) => e.status === "posted" && e.voucherId)
          .map((e) => e.voucherId as string)
      );
      let reversed = 0;

      for (const voucherId of postedVoucherIds) {
        const voucher = await tx.query.journalVouchers.findFirst({
          where: and(
            eq(journalVouchers.id, voucherId),
            eq(journalVouchers.organizationId, orgId)
          ),
          with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
        });
        if (!voucher) continue;
        const [reversal] = await tx
          .insert(journalVouchers)
          .values({
            userId,
            organizationId: orgId,
            date: voucher.date,
            description: `Элэгдлийн буцаалт (дахин бодолт) — ${data.month}`,
            status: "posted",
            reversalOfVoucherId: voucher.id,
          })
          .returning({ id: journalVouchers.id });
        await tx.insert(journalLines).values(
          voucher.lines.map((line, index) => ({
            voucherId: reversal.id,
            accountNumber: line.accountNumber,
            // Буцаалт = Дт/Кт солигдсон толин тусгал.
            debit: line.credit,
            credit: line.debit,
            description: `Буцаалт: ${line.description}`,
            sortOrder: index,
          }))
        );
        await tx
          .update(journalVouchers)
          .set({ status: "reversed" })
          .where(eq(journalVouchers.id, voucher.id));
        await tx
          .update(faDepreciationEntries)
          .set({ status: "reversed", reversalVoucherId: reversal.id })
          .where(
            and(
              eq(faDepreciationEntries.organizationId, orgId),
              eq(faDepreciationEntries.periodMonth, data.month),
              eq(faDepreciationEntries.voucherId, voucher.id),
              eq(faDepreciationEntries.status, "posted")
            )
          );
        reversed += 1;
      }

      // Ноорог бичилтийг устгана (дарж бичих).
      await tx
        .delete(faDepreciationEntries)
        .where(
          and(
            eq(faDepreciationEntries.organizationId, orgId),
            eq(faDepreciationEntries.periodMonth, data.month),
            eq(faDepreciationEntries.status, "draft")
          )
        );

      // ── Хуримтлагдсан элэгдэл (ӨМНӨХ сарууд, идэвхтэй бичилт) ────────
      const postedAccum = new Map<string, number>();
      const taxAccum = new Map<string, number>();
      for (const entry of entries) {
        if (entry.periodMonth >= data.month) continue; // энэ сарынх дахин бодогдоно
        postedAccum.set(
          entry.assetId,
          (postedAccum.get(entry.assetId) ?? 0) + Number(entry.amount)
        );
        taxAccum.set(
          entry.assetId,
          (taxAccum.get(entry.assetId) ?? 0) + Number(entry.taxAmount)
        );
      }

      // Ойлгомжтой шалтгаан — хоосон дэлгэц дээр "алдаа гарлаа" гэхгүй.
      if (assets.length === 0)
        throw new Error(
          "Идэвхтэй үндсэн хөрөнгө алга — Хөрөнгийн карт хэсэгт карт үүсгээд идэвхжүүлнэ үү"
        );

      const assetRefs: FixedAssetRef[] = assets.map((asset) => ({
        id: asset.id,
        cost: Number(asset.cost),
        salvageValue: Number(asset.salvageValue),
        usefulLifeMonths: asset.usefulLifeMonths,
        method: isDepreciationMethod(asset.depreciationMethod)
          ? asset.depreciationMethod
          : "straight_line",
        depreciationStartMonth: asset.depreciationStartMonth,
        depreciationStartDate: asset.depreciationStartDate,
        status: asset.status,
        taxUsefulLifeMonths: asset.taxUsefulLifeMonths,
        taxMethod: isDepreciationMethod(asset.taxDepreciationMethod)
          ? asset.taxDepreciationMethod
          : "straight_line",
      }));

      const computed = computeMonthlyDepreciation({
        assets: assetRefs,
        postedAccum,
        taxAccum,
        alreadyCharged: new Set(),
        month: data.month,
        basis,
      });
      if (computed.length === 0) return { created: 0, reversed };

      await tx.insert(faDepreciationEntries).values(
        computed.map((entry) => ({
          userId,
          organizationId: orgId,
          assetId: entry.assetId,
          periodMonth: data.month,
          amount: String(entry.amount),
          taxAmount: String(entry.taxAmount),
          depreciatedDays: entry.days,
        }))
      );

      await logAuditEvent(
        {
          userId,
          organizationId: orgId,
          action: "calculate",
          entityType: "fa",
          entityId: data.month,
          summary: `Элэгдэл бодогдов — ${data.month}, ${computed.length} хөрөнгө, суурь: ${basis === "daily" ? "өдрөөр" : "сараар"}${reversed > 0 ? `, өмнөх ${reversed} журнал буцаагдав` : ""}`,
        },
        tx
      );
      return { created: computed.length, reversed };
    })
    .then((result) => {
      revalidateFa();
      return result;
    });
}

export async function postDepreciationEntry(id: string) {
  const { orgId, userId } = await requireModuleAction("fa", "post");
  const entry = await db.query.faDepreciationEntries.findFirst({
    where: and(
      eq(faDepreciationEntries.id, id),
      eq(faDepreciationEntries.organizationId, orgId)
    ),
    with: { asset: true },
  });
  if (!entry) throw new Error("Элэгдлийн бичилт олдсонгүй");
  if (entry.status !== "draft")
    throw new Error("Зөвхөн ноорог бичилтийг батална");
  await assertPeriodOpen(orgId, `${entry.periodMonth}-28`);
  const amount = Number(entry.amount);
  if (!(amount > 0)) throw new Error("Дүн 0-ээс их байна");

  await assertEnabledMainAccount(orgId, entry.asset.depExpenseAccountNumber);
  await assertEnabledMainAccount(orgId, entry.asset.accumDepAccountNumber);
  const buildCode = await faPostingCodeBuilder(orgId);
  const description = `[${entry.asset.code}] ${entry.asset.name} — ${entry.periodMonth} сарын элэгдэл`;

  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, `${entry.periodMonth}-28`);
    const [claimed] = await tx
      .update(faDepreciationEntries)
      .set({ status: "posted", postedAt: new Date() })
      .where(
        and(
          eq(faDepreciationEntries.id, id),
          eq(faDepreciationEntries.organizationId, orgId),
          eq(faDepreciationEntries.status, "draft")
        )
      )
      .returning({ id: faDepreciationEntries.id });
    if (!claimed) throw new Error("Бичилтийн төлөв өөрчлөгдсөн байна");

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: `${entry.periodMonth}-28`,
        description,
        documentNo: await nextVoucherNo(
          tx,
          orgId,
          "fa",
          `${entry.periodMonth}-28`
        ),
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
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "post",
        entityType: "fa",
        entityId: id,
        summary: `Элэгдэл батлагдав — [${entry.asset.code}] ${entry.asset.name}, ${entry.periodMonth}, дүн ${amount.toLocaleString("en-US")}₮`,
      },
      tx
    );
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
  const { orgId } = await requireModuleAction("fa", "post");
  const entry = await db.query.faDepreciationEntries.findFirst({
    where: and(
      eq(faDepreciationEntries.id, id),
      eq(faDepreciationEntries.organizationId, orgId)
    ),
    columns: { status: true },
  });
  if (!entry) return;
  if (entry.status !== "draft")
    throw new Error("Зөвхөн ноорог бичилтийг устгана");
  await db
    .delete(faDepreciationEntries)
    .where(
      and(eq(faDepreciationEntries.id, id), eq(faDepreciationEntries.organizationId, orgId))
    );
  revalidateFa();
}

export async function reverseDepreciationEntry(id: string) {
  const { orgId, userId } = await requireModuleAction("fa", "post");
  const entry = await db.query.faDepreciationEntries.findFirst({
    where: and(
      eq(faDepreciationEntries.id, id),
      eq(faDepreciationEntries.organizationId, orgId)
    ),
    with: { asset: true },
  });
  if (!entry || entry.status !== "posted" || !entry.voucherId)
    throw new Error("Зөвхөн батлагдсан бичилтийг буцаана");
  await assertPeriodOpen(orgId, `${entry.periodMonth}-28`);

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, entry.voucherId),
      eq(journalVouchers.organizationId, orgId)
    ),
    with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
  });
  if (!voucher) throw new Error("Холбоотой GL журнал олдсонгүй");

  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, `${entry.periodMonth}-28`);
    const [claimed] = await tx
      .update(faDepreciationEntries)
      .set({ status: "reversed" })
      .where(
        and(
          eq(faDepreciationEntries.id, id),
          eq(faDepreciationEntries.organizationId, orgId),
          eq(faDepreciationEntries.status, "posted")
        )
      )
      .returning({ id: faDepreciationEntries.id });
    if (!claimed) throw new Error("Бичилтийн төлөв өөрчлөгдсөн байна");

    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: voucher.date,
        description: `Буцаалт: ${voucher.description}`,
        documentNo: await nextVoucherNo(
          tx,
          orgId,
          moduleOfVoucherNo(voucher.documentNo, "fa"),
          voucher.date
        ),
        status: "posted",
        // Эх журналтайгаа хосолно — журналын харагдацад хоёр чигт холбоос гарна.
        reversalOfVoucherId: voucher.id,
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
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "reverse",
        entityType: "fa",
        entityId: id,
        summary: `Элэгдэл буцаагдав — [${entry.asset.code}] ${entry.asset.name}, ${entry.periodMonth}, дүн ${Number(entry.amount).toLocaleString("en-US")}₮`,
      },
      tx
    );
  });

  revalidateFa();
}

// ─── GL тулгалтын задаргаа (самбарын drill-down) ─────────────────────────────

export type FaTieOutDetail = {
  /** Тухайн дансанд нөлөөлсөн GL журналууд — мужид, нэт дүнгээр. */
  gl: {
    voucherId: string;
    date: string;
    description: string;
    amount: number;
  }[];
  /** Subledger-ийн гүйлгээ — өртгийн дансанд картын өртөг, элэгдлийн дансанд батлагдсан элэгдэл. */
  subledger: { id: string; date: string; label: string; amount: number }[];
  glTotal: number;
  subledgerTotal: number;
};

/**
 * Самбарын GL тулгалтын нэг дансны задаргаа — СОНГОСОН МУЖИД (PTD default).
 * Багануудын дүн нь бүх цагийн үлдэгдэл; энэ задаргаа нь мужийн гүйлгээг
 * харуулж, их дата дээр бүх түүхийг нэг дор уншихаас сэргийлнэ.
 */
export async function getFaTieOutDetail(data: {
  accountNumber: string;
  from: string;
  to: string;
}): Promise<FaTieOutDetail> {
  const { orgId } = await getActiveOrg();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.from) || !/^\d{4}-\d{2}-\d{2}$/.test(data.to))
    throw new Error("Огнооны муж (YYYY-MM-DD) буруу байна");
  if (data.to < data.from) throw new Error("Мужийн төгсгөл эхлэлээс өмнө байна");

  const [vouchers, assets, entries] = await Promise.all([
    db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.organizationId, orgId),
        inArray(journalVouchers.status, ["posted", "reversed"]),
        gte(journalVouchers.date, data.from),
        lte(journalVouchers.date, data.to)
      ),
      with: { lines: true },
    }),
    db.query.fixedAssets.findMany({
      where: eq(fixedAssets.organizationId, orgId),
    }),
    db.query.faDepreciationEntries.findMany({
      where: and(
        eq(faDepreciationEntries.organizationId, orgId),
        eq(faDepreciationEntries.status, "posted"),
        // periodMonth (YYYY-MM) мужид — сарын түвшинд харьцуулна.
        gte(faDepreciationEntries.periodMonth, data.from.slice(0, 7)),
        lte(faDepreciationEntries.periodMonth, data.to.slice(0, 7))
      ),
    }),
  ]);

  const mainOf = (accountNumber: string) => {
    const parts = accountNumber.split(".");
    return parts.length === 10 ? parts[2] : accountNumber;
  };

  const gl: FaTieOutDetail["gl"] = [];
  for (const voucher of vouchers) {
    let net = 0;
    for (const line of voucher.lines) {
      if (mainOf(line.accountNumber) !== data.accountNumber) continue;
      net += Number(line.debit) - Number(line.credit);
    }
    if (Math.abs(net) < 0.005) continue;
    gl.push({
      voucherId: voucher.id,
      date: voucher.date,
      description: voucher.description,
      amount: Math.round(net * 100) / 100,
    });
  }
  gl.sort((a, b) => b.date.localeCompare(a.date));

  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const subledger: FaTieOutDetail["subledger"] = [];
  // Өртгийн данс: тухайн дансанд бүртгэлтэй ИДЭВХТЭЙ картууд, авсан огноогоор.
  for (const asset of assets) {
    if (asset.status !== "active") continue;
    if (asset.assetAccountNumber !== data.accountNumber) continue;
    if (asset.acquisitionDate < data.from || asset.acquisitionDate > data.to)
      continue;
    subledger.push({
      id: `asset-${asset.id}`,
      date: asset.acquisitionDate,
      label: `${asset.code} · ${asset.name}`,
      amount: Number(asset.cost),
    });
  }
  // Хуримт. элэгдлийн данс: батлагдсан элэгдэл (кредит үлдэгдэл → сөрөг).
  for (const entry of entries) {
    const asset = assetById.get(entry.assetId);
    if (!asset || asset.accumDepAccountNumber !== data.accountNumber) continue;
    subledger.push({
      id: `dep-${entry.id}`,
      date: `${entry.periodMonth}-01`,
      label: `Элэгдэл ${entry.periodMonth} · ${asset.code} ${asset.name}`,
      amount: -Number(entry.amount),
    });
  }
  subledger.sort((a, b) => b.date.localeCompare(a.date));

  return {
    gl,
    subledger,
    glTotal: round2(gl.reduce((sum, row) => sum + row.amount, 0)),
    subledgerTotal: round2(subledger.reduce((sum, row) => sum + row.amount, 0)),
  };
}

// ─── Данснаас хасах (актлах / борлуулах / бэлэглэх) ──────────────────────────

export type FaDisposalType = "scrap" | "sale" | "donation";

const DISPOSAL_LABELS: Record<FaDisposalType, string> = {
  scrap: "Актлалт",
  sale: "Борлуулалт",
  donation: "Бэлэглэл",
};

/**
 * ҮХ-ийг данснаас хасна (зарлагын гүйлгээ). GL бичилт (posting matrix §2.25):
 *   Dr Мөнгө/Авлага (борлуулсан үнэ — зөвхөн борлуулалтад)
 *   Dr Хуримт. элэгдэл (батлагдсан Σ)
 *   Cr ҮХ өртгийн данс (өртөг)
 *   Dr/Cr Олз (гарз)-ын данс — тэнцвэржүүлэгч (NBV − орлого)
 * Дансуудыг хэрэглэгч сонгоно — кодод хатуу дугаар байхгүй. Ноорог элэгдэлтэй
 * бол хориглоно (батлагдаагүй элэгдэл орхигдоно). Атом claim (active→disposed)
 * давхар хасалтыг таслана; период нээлттэй байх ёстой.
 */
export async function disposeFixedAsset(
  id: string,
  data: {
    disposalType: FaDisposalType;
    date: string;
    /** Борлуулсан үнэ — зөвхөн "sale"-д, 0-ээс их. */
    proceeds?: number;
    /** Орлого хүлээн авах данс (мөнгө/авлага) — зөвхөн "sale"-д. */
    proceedsAccountNumber?: string;
    /** Олз (гарз)-ын данс — бүх төрөлд заавал. */
    gainLossAccountNumber: string;
  }
) {
  const { orgId, userId } = await requireModuleAction("fa", "post");
  if (!["scrap", "sale", "donation"].includes(data.disposalType))
    throw new Error("Хасалтын төрөл буруу байна");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error("Огноо буруу байна");

  const asset = await db.query.fixedAssets.findFirst({
    where: and(eq(fixedAssets.id, id), eq(fixedAssets.organizationId, orgId)),
  });
  if (!asset) throw new Error("Хөрөнгө олдсонгүй");
  if (asset.status === "disposed")
    throw new Error("Энэ хөрөнгө аль хэдийн данснаас хасагдсан байна");
  if (asset.status !== "active")
    throw new Error("Зөвхөн идэвхтэй хөрөнгийг данснаас хасна");
  if (data.date < asset.acquisitionDate)
    throw new Error("Хасалтын огноо авсан огнооноос өмнө байж болохгүй");
  await assertPeriodOpen(orgId, data.date);

  const gainLossAccount = data.gainLossAccountNumber.trim();
  if (!gainLossAccount) throw new Error("Олз (гарз)-ын данс сонгоно уу");
  await assertEnabledMainAccount(orgId, gainLossAccount);

  const isSale = data.disposalType === "sale";
  const proceeds = isSale ? Math.round(Number(data.proceeds ?? 0) * 100) / 100 : 0;
  const proceedsAccount = data.proceedsAccountNumber?.trim() ?? "";
  if (isSale) {
    if (!Number.isFinite(proceeds) || proceeds <= 0)
      throw new Error("Борлуулсан үнэ 0-ээс их байна");
    if (!proceedsAccount)
      throw new Error("Орлого хүлээн авах данс (мөнгө/авлага) сонгоно уу");
    await assertEnabledMainAccount(orgId, proceedsAccount);
  }

  // Батлагдаагүй элэгдэл орхигдохоос сэргийлнэ.
  const draftEntry = await db.query.faDepreciationEntries.findFirst({
    where: and(
      eq(faDepreciationEntries.organizationId, orgId),
      eq(faDepreciationEntries.assetId, id),
      eq(faDepreciationEntries.status, "draft")
    ),
    columns: { id: true },
  });
  if (draftEntry)
    throw new Error(
      "Ноорог элэгдлийн бичилт байна — эхлээд баталж эсвэл устгана уу (ҮХ → Элэгдэл)"
    );

  const postedEntries = await db.query.faDepreciationEntries.findMany({
    where: and(
      eq(faDepreciationEntries.organizationId, orgId),
      eq(faDepreciationEntries.assetId, id),
      eq(faDepreciationEntries.status, "posted")
    ),
    columns: { amount: true },
  });
  const cost = round2(Number(asset.cost));
  const accum = round2(
    postedEntries.reduce((sum, entry) => sum + Number(entry.amount), 0)
  );
  // Тэнцвэржүүлэгч: эерэг = гарз (Dr), сөрөг = олз (Cr).
  const gainLoss = round2(cost - accum - proceeds);
  const label = DISPOSAL_LABELS[data.disposalType];

  const buildCode = await faPostingCodeBuilder(orgId);

  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, data.date);
    const [claimed] = await tx
      .update(fixedAssets)
      .set({
        status: "disposed",
        disposalType: data.disposalType,
        disposalDate: data.date,
        disposalProceeds: isSale ? String(proceeds) : null,
      })
      .where(
        and(
          eq(fixedAssets.id, id),
          eq(fixedAssets.organizationId, orgId),
          eq(fixedAssets.status, "active")
        )
      )
      .returning({ id: fixedAssets.id });
    if (!claimed) throw new Error("Картын төлөв өөрчлөгдсөн байна");

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: data.date,
        description: `ҮХ ${label.toLowerCase()}: ${asset.code} ${asset.name}`,
        documentNo: await nextVoucherNo(tx, orgId, "fa", data.date),
        status: "posted",
      })
      .returning({ id: journalVouchers.id });

    const lines: {
      voucherId: string;
      accountNumber: string;
      debit: string;
      credit: string;
      description: string;
      sortOrder: number;
    }[] = [];
    const push = (accountNumber: string, debit: number, credit: number, description: string) =>
      lines.push({
        voucherId: voucher.id,
        accountNumber: buildCode(accountNumber),
        debit: String(round2(debit)),
        credit: String(round2(credit)),
        description,
        sortOrder: lines.length,
      });
    if (isSale) push(proceedsAccount, proceeds, 0, `${label} — орлого`);
    if (accum > 0)
      push(asset.accumDepAccountNumber, accum, 0, "Хуримт. элэгдэл хаав");
    push(asset.assetAccountNumber, 0, cost, "Өртөг данснаас хасав");
    if (gainLoss > 0) push(gainLossAccount, gainLoss, 0, `${label} — гарз`);
    else if (gainLoss < 0) push(gainLossAccount, 0, -gainLoss, `${label} — олз`);
    await tx.insert(journalLines).values(lines);

    await tx
      .update(fixedAssets)
      .set({ disposalVoucherId: voucher.id })
      .where(eq(fixedAssets.id, id));

    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "dispose",
        entityType: "fa",
        entityId: id,
        summary: `ҮХ данснаас хасагдав (${label}) — ${asset.code} ${asset.name}, өртөг ${cost.toLocaleString("en-US")}₮${isSale ? `, орлого ${proceeds.toLocaleString("en-US")}₮` : ""}`,
      },
      tx
    );
  });
  revalidateFa();
}

/**
 * Данснаас хасалтыг БУЦААХ — хөрөнгө идэвхтэй болж, хасалтын журнал урвуу
 * журналаар цэвэрлэгдэнэ. Атом claim (disposed→active) давхар буцаалтыг
 * таслана; буцаалт эх огноогоор бичигдэх тул тэр период нээлттэй байна.
 */
export async function reverseFixedAssetDisposal(id: string) {
  const { orgId, userId } = await requireModuleAction("fa", "post");
  const asset = await db.query.fixedAssets.findFirst({
    where: and(eq(fixedAssets.id, id), eq(fixedAssets.organizationId, orgId)),
  });
  if (!asset) throw new Error("Хөрөнгө олдсонгүй");
  if (asset.status !== "disposed" || !asset.disposalVoucherId || !asset.disposalDate)
    throw new Error("Зөвхөн данснаас хасагдсан хөрөнгийн хасалтыг буцаана");
  await assertPeriodOpen(orgId, asset.disposalDate);

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, asset.disposalVoucherId),
      eq(journalVouchers.organizationId, orgId)
    ),
    with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
  });
  if (!voucher) throw new Error("Хасалтын журнал олдсонгүй");

  await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, asset.disposalDate!);
    const [claimed] = await tx
      .update(fixedAssets)
      .set({
        status: "active",
        disposalType: null,
        disposalDate: null,
        disposalProceeds: null,
        disposalVoucherId: null,
      })
      .where(
        and(
          eq(fixedAssets.id, id),
          eq(fixedAssets.organizationId, orgId),
          eq(fixedAssets.status, "disposed")
        )
      )
      .returning({ id: fixedAssets.id });
    if (!claimed) throw new Error("Картын төлөв өөрчлөгдсөн байна");

    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: voucher.date,
        description: `Буцаалт: ${voucher.description}`,
        documentNo: await nextVoucherNo(
          tx,
          orgId,
          moduleOfVoucherNo(voucher.documentNo, "fa"),
          voucher.date
        ),
        status: "posted",
        // Эх журналтайгаа хосолно — журналын харагдацад хоёр чигт холбоос гарна.
        reversalOfVoucherId: voucher.id,
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

    await tx
      .update(journalVouchers)
      .set({ status: "reversed" })
      .where(
        and(
          eq(journalVouchers.id, voucher.id),
          eq(journalVouchers.organizationId, orgId)
        )
      );

    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "reverse",
        entityType: "fa",
        entityId: id,
        summary: `ҮХ хасалт буцаагдав — ${asset.code} ${asset.name}`,
      },
      tx
    );
  });
  revalidateFa();
}

// ── Сарын элэгдлийг НЭГ товчоор GL-д батлах ────────────────────────────────

/**
 * Тухайн сарын БҮХ ноорог элэгдлийг НЭГ журналаар батална (хөрөнгө тус бүрд
 * тусдаа журнал үүсгэхгүй). Мөрүүд дансны хосоор нэгтгэгдэнэ:
 *   Dr Элэгдлийн зардал / Cr Хуримтлагдсан элэгдэл
 * ЗӨВХӨН санхүүгийн (IAS 16) дүн бичигдэнэ — татварын элэгдэл нь мэмо
 * (cit.md: ААНОАТ-ын тайлан, IAS 12 хойшлогдсон татварт ашиглагдана).
 *
 * Дахин бодоход runDepreciation нь энэ журналыг автоматаар буцаадаг тул
 * давхар бичилт үүсэхгүй.
 */
export async function postDepreciationMonth(
  month: string
): Promise<ActionResult<{ voucherId: string; posted: number; amount: number }>> {
  try {
    return await postDepreciationMonthCore(month);
  } catch (caught) {
    return actionError("postDepreciationMonth", caught, "Элэгдэл батлагдсангүй");
  }
}

async function postDepreciationMonthCore(month: string) {
  const { orgId, userId } = await requireModuleAction("fa", "post");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Сар (YYYY-MM) буруу байна");
  const postingDate = `${month}-28`;
  await assertPeriodOpen(orgId, postingDate);

  const drafts = await db.query.faDepreciationEntries.findMany({
    where: and(
      eq(faDepreciationEntries.organizationId, orgId),
      eq(faDepreciationEntries.periodMonth, month),
      eq(faDepreciationEntries.status, "draft")
    ),
    with: { asset: true },
  });
  if (drafts.length === 0)
    throw new Error("Батлах ноорог элэгдэл алга — эхлээд бодолт хийнэ үү");

  const payable = drafts.filter((entry) => Number(entry.amount) > 0);
  if (payable.length === 0)
    throw new Error("Элэгдлийн дүн 0 байна — GL бичилт үүсгэхгүй");

  // Дансны хос бүрээр нэгтгэнэ — олон хөрөнгө нэг данс хуваалцвал нэг мөр.
  const byPair = new Map<
    string,
    { expense: string; accum: string; amount: number; count: number }
  >();
  for (const entry of payable) {
    const key = `${entry.asset.depExpenseAccountNumber}|${entry.asset.accumDepAccountNumber}`;
    const current = byPair.get(key) ?? {
      expense: entry.asset.depExpenseAccountNumber,
      accum: entry.asset.accumDepAccountNumber,
      amount: 0,
      count: 0,
    };
    current.amount = round2(current.amount + Number(entry.amount));
    current.count += 1;
    byPair.set(key, current);
  }

  for (const pair of byPair.values()) {
    await assertEnabledMainAccount(orgId, pair.expense);
    await assertEnabledMainAccount(orgId, pair.accum);
  }

  const buildCode = await faPostingCodeBuilder(orgId);
  const total = round2(
    [...byPair.values()].reduce((sum, pair) => sum + pair.amount, 0)
  );
  const description = `Үндсэн хөрөнгийн элэгдэл ${month} (${payable.length} хөрөнгө)`;

  const voucherId = await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, postingDate);

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: postingDate,
        description,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });

    const lines: {
      voucherId: string;
      accountNumber: string;
      debit: string;
      credit: string;
      description: string;
      sortOrder: number;
    }[] = [];
    let sortOrder = 0;
    for (const pair of byPair.values()) {
      lines.push({
        voucherId: voucher.id,
        accountNumber: buildCode(pair.expense),
        debit: String(pair.amount),
        credit: "0",
        description: `Элэгдлийн зардал ${month} (${pair.count} хөрөнгө)`,
        sortOrder: sortOrder++,
      });
      lines.push({
        voucherId: voucher.id,
        accountNumber: buildCode(pair.accum),
        debit: "0",
        credit: String(pair.amount),
        description: `Хуримтлагдсан элэгдэл ${month} (${pair.count} хөрөнгө)`,
        sortOrder: sortOrder++,
      });
    }
    await tx.insert(journalLines).values(lines);

    // Зөвхөн ноорог хэвээр байгаа мөрүүдийг л эзэмшинэ (уралдаанаас хамгаална).
    const claimed = await tx
      .update(faDepreciationEntries)
      .set({ status: "posted", postedAt: new Date(), voucherId: voucher.id })
      .where(
        and(
          eq(faDepreciationEntries.organizationId, orgId),
          eq(faDepreciationEntries.periodMonth, month),
          eq(faDepreciationEntries.status, "draft")
        )
      )
      .returning({ id: faDepreciationEntries.id });
    if (claimed.length === 0)
      throw new Error("Бичилтийн төлөв өөрчлөгдсөн байна");

    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "post",
        entityType: "fa",
        entityId: voucher.id,
        summary: `Элэгдэл нэг журналаар батлагдав — ${month}, ${payable.length} хөрөнгө, нийт ${total.toLocaleString("en-US")}₮`,
      },
      tx
    );
    return voucher.id;
  });

  revalidateFa();
  return { voucherId, posted: payable.length, amount: total };
}


/** Элэгдлийн суурийг (сараар / өдрөөр) солино — БҮХ хөрөнгөд үйлчилнэ. */
export async function setFaDepreciationBasis(
  basis: string
): Promise<ActionResult> {
  try {
    return await setFaDepreciationBasisCore(basis);
  } catch (caught) {
    return actionError("setFaDepreciationBasis", caught, "Суурь солигдсонгүй");
  }
}

async function setFaDepreciationBasisCore(basis: string) {
  const { orgId, userId } = await requireModuleAction("fa", "write");
  if (!isDepreciationBasis(basis))
    throw new Error("Элэгдлийн суурь буруу байна");
  await saveFaDepreciationBasis(orgId, userId, basis);
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "update",
    entityType: "fa",
    entityId: "settings",
    summary: `Элэгдлийн суурь ${basis === "daily" ? "ӨДРӨӨР" : "САРААР"} болов`,
  });
  revalidateFa();
  return {};
}

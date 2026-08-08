"use server";

// Өртгийн master data-ийн CRUD: дансны рольууд, зарлагын төрөл, өртгийн
// бүрэлдэхүүн. Бүгд хэрэглэгчийн хүрээнд, дансны дугаар нь тохиргоо
// (JPR-006). Устгал БАЙХГҮЙ — зөвхөн идэвхгүй болгоно (FR-AUD-004), учир нь
// түүхэн бичилтүүд эдгээрт холбогдсон байдаг.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getActiveOrg, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  costComponents,
  costEntries,
  costingAccountSettings,
  inventoryIssueTypes,
  inventoryMovements,
} from "@/lib/db/schema";
import { loadCostingAccountSettings } from "@/lib/costing/master-data";
import { extractMainAccount } from "@/lib/reports/balances";

export type MasterDataResult =
  | { ok: true }
  | { ok: false; code: "unauthenticated" | "validation" | "not-found"; message?: string };

/** Тохиргооны мутаци — admin+ эрх шаардана (эрхгүй бол null). */
async function requireAdminCtx() {
  return requireRole("admin").catch(() => null);
}

/** Данс нь тухайн хэрэглэгчид бүртгэлтэй, идэвхтэй эсэх. */
async function assertAccount(orgId: string, main: string) {
  const row = await db.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.organizationId, orgId),
      eq(chartOfAccounts.number, main),
      eq(chartOfAccounts.isEnabled, true)
    ),
    columns: { id: true },
  });
  if (!row) throw new Error(`${main} данс идэвхтэй бүртгэлд алга`);
}

function revalidateCosting() {
  revalidatePath("/costing");
  revalidatePath("/costing/settings");
  revalidatePath("/costing/entries");
  revalidatePath("/costing/reports");
}

// ── Дансны рольууд ──────────────────────────────────────────────────────────

export async function saveCostingAccountSettings(data: {
  clearingAccountNumber: string;
  adjustmentGainAccountNumber: string;
  adjustmentLossAccountNumber: string;
  nrvExpenseAccountNumber: string;
  nrvReserveAccountNumber: string;
}): Promise<MasterDataResult> {
  const active = await requireAdminCtx();
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId, userId } = active;

  const values = {
    clearingAccountNumber: extractMainAccount(data.clearingAccountNumber.trim()),
    adjustmentGainAccountNumber: extractMainAccount(
      data.adjustmentGainAccountNumber.trim()
    ),
    adjustmentLossAccountNumber: extractMainAccount(
      data.adjustmentLossAccountNumber.trim()
    ),
    nrvExpenseAccountNumber: extractMainAccount(
      data.nrvExpenseAccountNumber.trim()
    ),
    nrvReserveAccountNumber: extractMainAccount(
      data.nrvReserveAccountNumber.trim()
    ),
  };

  try {
    for (const account of Object.values(values)) {
      if (!account) throw new Error("Бүх дансыг бөглөнө үү");
      await assertAccount(orgId, account);
    }
  } catch (caught) {
    return {
      ok: false,
      code: "validation",
      message: caught instanceof Error ? caught.message : "Данс буруу",
    };
  }

  await loadCostingAccountSettings(orgId, userId); // мөр байгаа эсэхийг баталгаажуулна
  await db
    .update(costingAccountSettings)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(costingAccountSettings.organizationId, orgId));

  revalidateCosting();
  return { ok: true };
}

// ── Зарлагын төрөл (Inventory Issue Type) ───────────────────────────────────

export async function saveIssueType(data: {
  id?: string;
  code: string;
  name: string;
  destinationClass: string;
  debitAccountSource: "fixed" | "item_cogs";
  debitAccountNumber: string;
}): Promise<MasterDataResult> {
  const active = await requireAdminCtx();
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId, userId } = active;

  const code = data.code.trim().toUpperCase();
  const name = data.name.trim();
  if (!code || !name)
    return { ok: false, code: "validation", message: "Код, нэрийг бөглөнө үү" };

  let debitAccountNumber: string | null = null;
  if (data.debitAccountSource === "fixed") {
    debitAccountNumber = extractMainAccount(data.debitAccountNumber.trim());
    if (!debitAccountNumber)
      return {
        ok: false,
        code: "validation",
        message: "Тогтмол дансны горимд дебет дансыг бөглөнө үү",
      };
    try {
      await assertAccount(orgId, debitAccountNumber);
    } catch (caught) {
      return {
        ok: false,
        code: "validation",
        message: caught instanceof Error ? caught.message : "Данс буруу",
      };
    }
  }

  const values = {
    code,
    name,
    destinationClass: data.destinationClass.trim(),
    debitAccountSource: data.debitAccountSource,
    debitAccountNumber,
    updatedBy: userId,
    updatedAt: new Date(),
  };

  if (data.id) {
    const existing = await db.query.inventoryIssueTypes.findFirst({
      where: and(
        eq(inventoryIssueTypes.id, data.id),
        eq(inventoryIssueTypes.organizationId, orgId)
      ),
      columns: { id: true },
    });
    if (!existing) return { ok: false, code: "not-found" };
    await db
      .update(inventoryIssueTypes)
      .set(values)
      .where(eq(inventoryIssueTypes.id, data.id));
  } else {
    const duplicate = await db.query.inventoryIssueTypes.findFirst({
      where: and(
        eq(inventoryIssueTypes.organizationId, orgId),
        eq(inventoryIssueTypes.code, code)
      ),
      columns: { id: true },
    });
    if (duplicate)
      return { ok: false, code: "validation", message: `"${code}" код давхардаж байна` };
    await db
      .insert(inventoryIssueTypes)
      .values({ userId, organizationId: orgId, createdBy: userId, ...values });
  }

  revalidateCosting();
  revalidatePath("/inventory/movements");
  return { ok: true };
}

/** Идэвхжүүлэх / идэвхгүй болгох — устгал байхгүй (FR-AUD-004). */
export async function toggleIssueType(
  id: string,
  isActive: boolean
): Promise<MasterDataResult> {
  const active = await requireAdminCtx();
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId, userId } = active;

  if (!isActive) {
    // Хэрэглэгдэж буй сүүлчийн идэвхтэй төрлийг унтраавал зарлага бичих
    // боломжгүй болно — сэрэмжлүүлж зогсооно.
    const active = await db.query.inventoryIssueTypes.findMany({
      where: and(
        eq(inventoryIssueTypes.organizationId, orgId),
        eq(inventoryIssueTypes.isActive, true)
      ),
      columns: { id: true },
    });
    if (active.length <= 1)
      return {
        ok: false,
        code: "validation",
        message:
          "Дор хаяж нэг идэвхтэй зарлагын төрөл байх ёстой — эхлээд шинийг нэмнэ үү",
      };
  }

  await db
    .update(inventoryIssueTypes)
    .set({ isActive, updatedBy: userId, updatedAt: new Date() })
    .where(
      and(
        eq(inventoryIssueTypes.id, id),
        eq(inventoryIssueTypes.organizationId, orgId)
      )
    );

  revalidateCosting();
  return { ok: true };
}

// ── Өртгийн бүрэлдэхүүн (Cost Component) ────────────────────────────────────

export async function saveCostComponent(data: {
  id?: string;
  code: string;
  name: string;
  classification: string;
  accountNumber: string;
}): Promise<MasterDataResult> {
  const active = await requireAdminCtx();
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId, userId } = active;

  const code = data.code.trim().toUpperCase();
  const name = data.name.trim();
  if (!code || !name)
    return { ok: false, code: "validation", message: "Код, нэрийг бөглөнө үү" };

  const raw = data.accountNumber.trim();
  const accountNumber = raw ? extractMainAccount(raw) : null;
  if (accountNumber) {
    try {
      await assertAccount(orgId, accountNumber);
    } catch (caught) {
      return {
        ok: false,
        code: "validation",
        message: caught instanceof Error ? caught.message : "Данс буруу",
      };
    }
  }

  const values = {
    code,
    name,
    classification: data.classification.trim(),
    accountNumber,
    updatedBy: userId,
    updatedAt: new Date(),
  };

  if (data.id) {
    const existing = await db.query.costComponents.findFirst({
      where: and(
        eq(costComponents.id, data.id),
        eq(costComponents.organizationId, orgId)
      ),
      columns: { id: true },
    });
    if (!existing) return { ok: false, code: "not-found" };
    await db
      .update(costComponents)
      .set(values)
      .where(eq(costComponents.id, data.id));
  } else {
    const duplicate = await db.query.costComponents.findFirst({
      where: and(
        eq(costComponents.organizationId, orgId),
        eq(costComponents.code, code)
      ),
      columns: { id: true },
    });
    if (duplicate)
      return { ok: false, code: "validation", message: `"${code}" код давхардаж байна` };
    await db
      .insert(costComponents)
      .values({ userId, organizationId: orgId, createdBy: userId, ...values });
  }

  revalidateCosting();
  return { ok: true };
}

export async function toggleCostComponent(
  id: string,
  isActive: boolean
): Promise<MasterDataResult> {
  const active = await requireAdminCtx();
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId, userId } = active;

  await db
    .update(costComponents)
    .set({ isActive, updatedBy: userId, updatedAt: new Date() })
    .where(
      and(eq(costComponents.id, id), eq(costComponents.organizationId, orgId))
    );

  revalidateCosting();
  return { ok: true };
}

/** Тухайн зарлагын төрлийг хэдэн бичилт ашигласан — идэвхгүй болгохын өмнө. */
export async function issueTypeUsage(
  id: string
): Promise<{ movements: number; entries: number }> {
  const active = await getActiveOrg().catch(() => null);
  if (!active) return { movements: 0, entries: 0 };
  const { orgId } = active;

  const [movements, entries] = await Promise.all([
    db.query.inventoryMovements.findMany({
      where: and(
        eq(inventoryMovements.organizationId, orgId),
        eq(inventoryMovements.issueTypeId, id)
      ),
      columns: { id: true },
    }),
    db.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        eq(costEntries.issueTypeId, id)
      ),
      columns: { id: true },
    }),
  ]);
  return { movements: movements.length, entries: entries.length };
}

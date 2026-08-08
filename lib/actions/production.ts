"use server";

// Үйлдвэрлэлийн өртгийн модуль: дамжлага/бүлэг/дүрмийн master data +
// сарын тооцооллын run. Дэлгэрэнгүй урсгал lib/costing/production.ts-д.
//
// Батлахад гаралт бүр: батлагдсан орлогын хөдөлгөөн + НООРОГ өртгийн
// бичилт (receipt_capitalize) үүснэ — цаашид одоогийн жигнэсэн дундаж,
// GL бичилтийн урсгалд ЖИРИЙН орлого шиг орно. Орц бүр: батлагдсан
// зарлагын хөдөлгөөн үүснэ (үйлдвэрлэлд зарцуулсан).

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  costEntries,
  costPoolRules,
  costPools,
  inventoryItems,
  inventoryMovements,
  journalVouchers,
  productionRunInputs,
  productionRunOutputs,
  productionRunPools,
  productionRunStages,
  productionRuns,
  productionStages,
  warehouses,
} from "@/lib/db/schema";
import {
  computeProductionRun,
  matchPools,
  type GlCostLine,
  type PoolRule,
  type ProductionAllocationBase,
  type StageSpec,
} from "@/lib/costing/production";
import { latestUnitCost } from "@/lib/costing/valuation";
import {
  findNegativeStock,
  type MovementRef,
  type MovementType,
} from "@/lib/inventory/balances";
import { assertPeriodOpen } from "@/lib/periods/guard";
import { isPeriodCode, periodRange } from "@/lib/periods/period";
import { extractMainAccount } from "@/lib/reports/balances";

export type ProductionResult =
  | { ok: true }
  | {
      ok: false;
      code: "unauthenticated" | "validation" | "not-found" | "failed";
      message?: string;
    };

async function userIdOrNull(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** Транзакц доторх шалгалтын алдааг "validation" код руу буулгахад. */
class ProductionValidationError extends Error {}

function revalidateProduction() {
  revalidatePath("/costing/production");
  revalidatePath("/costing/settings");
  revalidatePath("/costing");
}

// ── Дамжлага (шат) ──────────────────────────────────────────────────────────

export async function saveProductionStage(data: {
  id?: string;
  code: string;
  name: string;
  sortOrder: number;
}): Promise<ProductionResult> {
  const userId = await userIdOrNull();
  if (!userId) return { ok: false, code: "unauthenticated" };

  const code = data.code.trim().toUpperCase();
  const name = data.name.trim();
  if (!code || !name)
    return { ok: false, code: "validation", message: "Код, нэрийг бөглөнө үү" };

  const values = {
    code,
    name,
    sortOrder: Math.round(data.sortOrder) || 0,
    updatedBy: userId,
    updatedAt: new Date(),
  };

  if (data.id) {
    const existing = await db.query.productionStages.findFirst({
      where: and(
        eq(productionStages.id, data.id),
        eq(productionStages.userId, userId)
      ),
      columns: { id: true },
    });
    if (!existing) return { ok: false, code: "not-found" };
    await db
      .update(productionStages)
      .set(values)
      .where(eq(productionStages.id, data.id));
  } else {
    const duplicate = await db.query.productionStages.findFirst({
      where: and(
        eq(productionStages.userId, userId),
        eq(productionStages.code, code)
      ),
      columns: { id: true },
    });
    if (duplicate)
      return {
        ok: false,
        code: "validation",
        message: `"${code}" код давхардаж байна`,
      };
    await db
      .insert(productionStages)
      .values({ userId, createdBy: userId, ...values });
  }

  revalidateProduction();
  return { ok: true };
}

export async function toggleProductionStage(
  id: string,
  isActive: boolean
): Promise<ProductionResult> {
  const userId = await userIdOrNull();
  if (!userId) return { ok: false, code: "unauthenticated" };
  await db
    .update(productionStages)
    .set({ isActive, updatedBy: userId, updatedAt: new Date() })
    .where(
      and(eq(productionStages.id, id), eq(productionStages.userId, userId))
    );
  revalidateProduction();
  return { ok: true };
}

// ── Өртгийн бүлэг + дүрэм ───────────────────────────────────────────────────

export async function saveCostPool(data: {
  id?: string;
  stageId: string;
  code: string;
  name: string;
  costBehavior: "variable" | "fixed";
  sortOrder: number;
  /** Дүрмүүд бүхэлдээ СОЛИГДОНО (жагсаалтыг нь бүтнээр илгээнэ). */
  rules: { costCenterCode: string; accountPrefix: string; priority: number }[];
}): Promise<ProductionResult> {
  const userId = await userIdOrNull();
  if (!userId) return { ok: false, code: "unauthenticated" };

  const code = data.code.trim().toUpperCase();
  const name = data.name.trim();
  if (!code || !name)
    return { ok: false, code: "validation", message: "Код, нэрийг бөглөнө үү" };

  const stage = await db.query.productionStages.findFirst({
    where: and(
      eq(productionStages.id, data.stageId),
      eq(productionStages.userId, userId)
    ),
    columns: { id: true },
  });
  if (!stage)
    return { ok: false, code: "validation", message: "Дамжлага олдсонгүй" };

  const cleanRules = data.rules
    .map((rule) => ({
      costCenterCode: rule.costCenterCode.trim() || null,
      accountPrefix: rule.accountPrefix.trim() || null,
      priority: Math.round(rule.priority) || 100,
    }))
    .filter((rule) => rule.costCenterCode || rule.accountPrefix);
  if (cleanRules.length === 0)
    return {
      ok: false,
      code: "validation",
      message:
        "Дор хаяж нэг зураглалын дүрэм хэрэгтэй (өртгийн төв эсвэл дансны угтвар)",
    };

  let poolId = data.id ?? null;
  if (poolId) {
    const existing = await db.query.costPools.findFirst({
      where: and(eq(costPools.id, poolId), eq(costPools.userId, userId)),
      columns: { id: true },
    });
    if (!existing) return { ok: false, code: "not-found" };
    await db
      .update(costPools)
      .set({
        stageId: data.stageId,
        code,
        name,
        costBehavior: data.costBehavior,
        sortOrder: Math.round(data.sortOrder) || 0,
        updatedAt: new Date(),
      })
      .where(eq(costPools.id, poolId));
  } else {
    const duplicate = await db.query.costPools.findFirst({
      where: and(eq(costPools.userId, userId), eq(costPools.code, code)),
      columns: { id: true },
    });
    if (duplicate)
      return {
        ok: false,
        code: "validation",
        message: `"${code}" код давхардаж байна`,
      };
    const [created] = await db
      .insert(costPools)
      .values({
        userId,
        stageId: data.stageId,
        code,
        name,
        costBehavior: data.costBehavior,
        sortOrder: Math.round(data.sortOrder) || 0,
      })
      .returning({ id: costPools.id });
    poolId = created.id;
  }

  await db.transaction(async (tx) => {
    await tx.delete(costPoolRules).where(eq(costPoolRules.poolId, poolId!));
    await tx.insert(costPoolRules).values(
      cleanRules.map((rule) => ({
        userId,
        poolId: poolId!,
        costCenterCode: rule.costCenterCode,
        accountPrefix: rule.accountPrefix,
        priority: rule.priority,
      }))
    );
  });

  revalidateProduction();
  return { ok: true };
}

export async function toggleCostPool(
  id: string,
  isActive: boolean
): Promise<ProductionResult> {
  const userId = await userIdOrNull();
  if (!userId) return { ok: false, code: "unauthenticated" };
  await db
    .update(costPools)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(costPools.id, id), eq(costPools.userId, userId)));
  revalidateProduction();
  return { ok: true };
}

// ── GL цуглуулга ────────────────────────────────────────────────────────────

/**
 * Тухайн сарын БАТЛАГДСАН журналын мөрүүдийг (S2, үндсэн данс)-аар нэгтгэж
 * зураглалын дүрмээр бүлэглэнэ. Дебет − кредит = зардлын өсөлт.
 */
async function collectGlPools(userId: string, periodCode: string) {
  const { startDate, endDate } = periodRange(periodCode);
  const [vouchers, pools] = await Promise.all([
    db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.userId, userId),
        inArray(journalVouchers.status, ["posted", "reversed"]),
        gte(journalVouchers.date, startDate),
        lte(journalVouchers.date, endDate)
      ),
      with: { lines: true },
      columns: { id: true, date: true, description: true },
    }),
    db.query.costPools.findMany({
      where: and(eq(costPools.userId, userId), eq(costPools.isActive, true)),
      with: { rules: true },
    }),
  ]);

  const rules: PoolRule[] = pools.flatMap((pool) =>
    pool.rules.map((rule) => ({
      poolId: pool.id,
      costCenterCode: rule.costCenterCode,
      accountPrefix: rule.accountPrefix,
      priority: rule.priority,
    }))
  );

  const lines: GlCostLine[] = [];
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      const parts = line.accountNumber.split(".");
      const costCenter = parts.length === 10 ? parts[1] : "";
      lines.push({
        voucherId: voucher.id,
        date: voucher.date,
        description: line.description || voucher.description,
        costCenter,
        mainAccount: extractMainAccount(line.accountNumber),
        amount: Number(line.debit) - Number(line.credit),
      });
    }
  }

  const result = matchPools(lines, rules);
  return { matched: result.pools, unmatched: result.unmatched };
}

// ── Run тооцоолол ───────────────────────────────────────────────────────────

export interface RunStageInput {
  stageId: string;
  base: ProductionAllocationBase;
  inputs: {
    itemId: string;
    quantity: number;
    sourceStageId: string | null;
  }[];
  outputs: {
    itemId: string;
    warehouseId: string;
    quantity: number;
    salesPrice: number | null;
    manualAmount: number | null;
  }[];
}

/**
 * Тооцоолж НООРОГ болгон хадгална. GL цуглуулга үргэлж шинээр хийгдэнэ —
 * бүлгийн дүн run-д хөлдөж хадгалагдана (аудит).
 */
export async function computeAndSaveProductionRun(data: {
  periodCode: string;
  stages: RunStageInput[];
}): Promise<ProductionResult> {
  const userId = await userIdOrNull();
  if (!userId) return { ok: false, code: "unauthenticated" };
  if (!isPeriodCode(data.periodCode))
    return { ok: false, code: "validation", message: "Тайлант үеийн код буруу" };

  try {
    await assertPeriodOpen(userId, `${data.periodCode}-01`);
  } catch (caught) {
    return {
      ok: false,
      code: "validation",
      message: caught instanceof Error ? caught.message : "Тайлант үе хаагдсан",
    };
  }

  const existing = await db.query.productionRuns.findFirst({
    where: and(
      eq(productionRuns.userId, userId),
      eq(productionRuns.periodCode, data.periodCode)
    ),
  });
  if (existing?.status === "confirmed")
    return {
      ok: false,
      code: "validation",
      message: "Энэ сарын тооцоолол батлагдсан — эхлээд буцаана уу",
    };

  const { matched } = await collectGlPools(userId, data.periodCode);
  const stageRows = await db.query.productionStages.findMany({
    where: and(
      eq(productionStages.userId, userId),
      eq(productionStages.isActive, true)
    ),
    with: { pools: true },
    orderBy: (stage, { asc }) => [asc(stage.sortOrder), asc(stage.code)],
  });

  // Орцын нэгж өртөг: нөөцөөс бол сарын дундаж (valuation), шатнаас бол null.
  const specs: StageSpec[] = [];
  for (const stage of stageRows) {
    const input = data.stages.find((entry) => entry.stageId === stage.id);
    const poolAmounts = stage.pools
      .filter((pool) => pool.isActive)
      .map((pool) => ({
        poolId: pool.id,
        amount: matched.get(pool.id)?.amount ?? 0,
      }));

    const inputs = [];
    for (const entry of input?.inputs ?? []) {
      let unitCost: number | null = null;
      if (!entry.sourceStageId) {
        const closing = await latestUnitCost(userId, entry.itemId);
        unitCost = closing?.unitCost ?? null;
      }
      inputs.push({
        itemId: entry.itemId,
        quantity: entry.quantity,
        unitCost,
        sourceStageId: entry.sourceStageId,
      });
    }

    specs.push({
      stageId: stage.id,
      poolAmounts,
      inputs,
      outputs: (input?.outputs ?? []).map((output) => ({
        itemId: output.itemId,
        quantity: output.quantity,
        salesPrice: output.salesPrice,
        manualAmount: output.manualAmount,
      })),
      base: input?.base ?? "sales_value",
    });
  }

  const results = computeProductionRun(specs);

  // Хадгална: run-ыг бүхэлд нь сольж бичнэ.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), 4)`);
    let runId = existing?.id ?? null;
    if (runId) {
      await tx.delete(productionRunStages).where(eq(productionRunStages.runId, runId));
      await tx.delete(productionRunPools).where(eq(productionRunPools.runId, runId));
      await tx.delete(productionRunInputs).where(eq(productionRunInputs.runId, runId));
      await tx.delete(productionRunOutputs).where(eq(productionRunOutputs.runId, runId));
    } else {
      const [created] = await tx
        .insert(productionRuns)
        .values({ userId, periodCode: data.periodCode })
        .returning({ id: productionRuns.id });
      runId = created.id;
    }

    for (const spec of specs) {
      const result = results.find((entry) => entry.stageId === spec.stageId)!;
      const requested = data.stages.find(
        (entry) => entry.stageId === spec.stageId
      );
      await tx.insert(productionRunStages).values({
        runId: runId!,
        stageId: spec.stageId,
        allocationBase: spec.base,
      });
      if (spec.poolAmounts.length > 0)
        await tx.insert(productionRunPools).values(
          spec.poolAmounts.map((pool) => ({
            runId: runId!,
            poolId: pool.poolId,
            amount: String(pool.amount),
            matchedLineCount: matched.get(pool.poolId)?.lineCount ?? 0,
          }))
        );
      if (result.inputs.length > 0)
        await tx.insert(productionRunInputs).values(
          result.inputs.map((input) => ({
            runId: runId!,
            stageId: spec.stageId,
            itemId: input.itemId,
            quantity: String(input.quantity),
            unitCost: String(input.unitCost),
            amount: String(input.amount),
            sourceStageId: input.sourceStageId,
          }))
        );
      if ((requested?.outputs.length ?? 0) > 0)
        await tx.insert(productionRunOutputs).values(
          requested!.outputs.map((output) => {
            const computed = result.outputs.find(
              (entry) => entry.itemId === output.itemId
            );
            return {
              runId: runId!,
              stageId: spec.stageId,
              itemId: output.itemId,
              warehouseId: output.warehouseId || null,
              quantity: String(output.quantity),
              salesPrice:
                output.salesPrice === null ? null : String(output.salesPrice),
              manualAmount:
                output.manualAmount === null
                  ? null
                  : String(output.manualAmount),
              allocatedAmount:
                computed === undefined ? null : String(computed.allocatedAmount),
              unitCost: computed === undefined ? null : String(computed.unitCost),
            };
          })
        );
    }
  });

  revalidateProduction();
  return { ok: true };
}

// ── Батлах ──────────────────────────────────────────────────────────────────

/**
 * Ноорог run-ыг батлана: гаралт бүрд орлогын хөдөлгөөн + ноорог өртгийн
 * бичилт, нөөцөөс авсан орц бүрд зарлагын хөдөлгөөн үүснэ. Бүх шат
 * "calculated" байх ёстой.
 */
export async function confirmProductionRun(
  periodCode: string
): Promise<ProductionResult> {
  const userId = await userIdOrNull();
  if (!userId) return { ok: false, code: "unauthenticated" };

  const run = await db.query.productionRuns.findFirst({
    where: and(
      eq(productionRuns.userId, userId),
      eq(productionRuns.periodCode, periodCode)
    ),
    with: { outputs: true, inputs: true },
  });
  if (!run) return { ok: false, code: "not-found" };
  if (run.status === "confirmed")
    return { ok: false, code: "validation", message: "Аль хэдийн батлагдсан" };

  const incomplete = run.outputs.some(
    (output) => output.allocatedAmount === null
  );
  if (incomplete || run.outputs.length === 0)
    return {
      ok: false,
      code: "validation",
      message:
        run.outputs.length === 0
          ? "Гаралтын бүтээгдэхүүн алга — эхлээд тооцоолно уу"
          : "Тооцоологдоогүй гаралт байна — эхлээд бүрэн тооцоолно уу",
    };
  const missingWarehouse = run.outputs.find((output) => !output.warehouseId);
  if (missingWarehouse)
    return {
      ok: false,
      code: "validation",
      message: "Гаралт бүрд агуулах сонгоно уу",
    };

  const { endDate } = periodRange(periodCode);
  const stamp = periodCode.replaceAll("-", "");

  // Хаагдсан периодын хамгаалалт — хөдөлгөөнүүд сарын эцсийн огноогоор үүснэ.
  try {
    await assertPeriodOpen(userId, endDate);
  } catch (err) {
    return {
      ok: false,
      code: "validation",
      message: err instanceof Error ? err.message : "Период хаагдсан байна",
    };
  }

  try {
    await db.transaction(async (tx) => {
      // Lock-ийн дараалал: БАГА түлхүүр эхэлж (1 → 4) — бусад зам мөн энэ
      // дарааллыг барьвал deadlock үүсэхгүй. Түлхүүр 1 нь
      // confirmInventoryMovement / delete / cancel-тай НЭГ цуваа тул доорх
      // хасах үлдэгдлийн шалгалт бусад батлалттай уралдахгүй.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), 1)`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), 4)`);

      const [claimed] = await tx
        .update(productionRuns)
        .set({ status: "confirmed", confirmedAt: new Date() })
        .where(
          and(eq(productionRuns.id, run.id), eq(productionRuns.status, "draft"))
        )
        .returning({ id: productionRuns.id });
      if (!claimed) throw new Error("Run-ийн төлөв өөрчлөгдсөн байна");

      // Хасах үлдэгдлийн шалгалт — confirmInventoryMovement-тэй ИЖИЛ дүрэм
      // (findNegativeStock, он цагийн бүрэн replay): батлагдах гэж буй
      // орцын зарлагуудыг одоогийн батлагдсан хөдөлгөөний цуваан дээр
      // нэмж, аль нэг бараа×агуулахын үлдэгдэл хасах болбол зогсооно.
      const confirmedRows = await tx.query.inventoryMovements.findMany({
        where: and(
          eq(inventoryMovements.userId, userId),
          eq(inventoryMovements.status, "confirmed")
        ),
      });
      const existingRefs: MovementRef[] = confirmedRows.map((row) => ({
        id: row.id,
        movementType: row.movementType as MovementType,
        date: row.date,
        // Confirmed мөрөнд null байх боломжгүй (confirm-ийн шалгалт).
        itemId: row.itemId ?? "",
        warehouseId: row.warehouseId ?? "",
        toWarehouseId: row.toWarehouseId,
        quantity: Number(row.quantity),
        createdAt: row.createdAt.toISOString(),
      }));
      const nowIso = new Date().toISOString();
      const pendingIssueRefs: MovementRef[] = run.inputs
        .filter((input) => !input.sourceStageId)
        .map((input, index) => ({
          id: `pending-production-issue-${index}`,
          movementType: "issue" as const,
          date: endDate,
          itemId: input.itemId,
          // Доорх бодит insert-тэй ИЖИЛ агуулах — гаралтын эхний агуулах.
          warehouseId: run.outputs[0].warehouseId!,
          toWarehouseId: null,
          quantity: Number(input.quantity),
          createdAt: nowIso,
        }));
      const violation = findNegativeStock([
        ...existingRefs,
        ...pendingIssueRefs,
      ]);
      if (violation) {
        const [item, warehouse] = await Promise.all([
          tx.query.inventoryItems.findFirst({
            where: and(
              eq(inventoryItems.id, violation.itemId),
              eq(inventoryItems.userId, userId)
            ),
            columns: { code: true, name: true },
          }),
          tx.query.warehouses.findFirst({
            where: and(
              eq(warehouses.id, violation.warehouseId),
              eq(warehouses.userId, userId)
            ),
            columns: { code: true, name: true },
          }),
        ]);
        throw new ProductionValidationError(
          `Орцын зарлагаар "${item?.name ?? violation.itemId}" барааны үлдэгдэл ` +
            `"${warehouse?.name ?? violation.warehouseId}" агуулахад хасах болно ` +
            `(${violation.date}: ${violation.balanceAfter}) — батлах боломжгүй`
        );
      }

      let seq = 0;
      // Нөөцөөс авсан орц → зарлагын хөдөлгөөн (үйлдвэрлэлд зарцуулсан).
      for (const input of run.inputs) {
        if (input.sourceStageId) continue; // шат доторх шилжилт — нөөц хөндөхгүй
        seq += 1;
        await tx.insert(inventoryMovements).values({
          userId,
          documentNo: `PROD-${stamp}-IN${String(seq).padStart(2, "0")}`,
          movementType: "issue",
          date: endDate,
          itemId: input.itemId,
          // Орц аль агуулахаас гарахыг гаралтын эхний агуулахаар (эсвэл
          // тухайн барааны сүүлийн агуулахаар) шийдэх нь v2 — одоогоор
          // үйлдвэрлэлийн зарлагад агуулах ЗААВАЛ гэдэг тул эхний
          // гаралтын агуулахыг ашиглана.
          warehouseId: run.outputs[0].warehouseId,
          quantity: String(Number(input.quantity)),
          description: `Үйлдвэрлэлд зарцуулсан — ${periodCode}`,
          status: "confirmed",
          sourceType: "manual",
          confirmedAt: new Date(),
        });
      }

      // Гаралт → орлогын хөдөлгөөн + ноорог өртгийн бичилт.
      seq = 0;
      for (const output of run.outputs) {
        seq += 1;
        const [movement] = await tx
          .insert(inventoryMovements)
          .values({
            userId,
            documentNo: `PROD-${stamp}-OUT${String(seq).padStart(2, "0")}`,
            movementType: "receipt",
            date: endDate,
            itemId: output.itemId,
            warehouseId: output.warehouseId,
            quantity: String(Number(output.quantity)),
            description: `Үйлдвэрлэлийн гаралт — ${periodCode}`,
            status: "confirmed",
            sourceType: "manual",
            confirmedAt: new Date(),
          })
          .returning({ id: inventoryMovements.id });

        const quantity = Number(output.quantity);
        const amount = Number(output.allocatedAmount);
        const [entry] = await tx
          .insert(costEntries)
          .values({
            userId,
            movementId: movement.id,
            itemId: output.itemId,
            warehouseId: output.warehouseId,
            periodCode,
            entryType: "receipt_capitalize",
            date: endDate,
            quantity: String(quantity),
            unitCost: String(
              Math.round((quantity > 0 ? amount / quantity : 0) * 10000) / 10000
            ),
            amount: String(amount),
            valuationSource: "manual",
          })
          .returning({ id: costEntries.id });

        await tx
          .update(productionRunOutputs)
          .set({ movementId: movement.id, costEntryId: entry.id })
          .where(eq(productionRunOutputs.id, output.id));
      }
    });
  } catch (caught) {
    return {
      ok: false,
      code:
        caught instanceof ProductionValidationError ? "validation" : "failed",
      message: caught instanceof Error ? caught.message : "Батлах амжилтгүй",
    };
  }

  revalidateProduction();
  revalidatePath("/inventory/movements");
  revalidatePath("/costing/entries");
  return { ok: true };
}

// ── Уншилт (run workspace-д) ────────────────────────────────────────────────

export interface ProductionWorkspaceData {
  periodCode: string;
  runStatus: "none" | "draft" | "confirmed";
  stages: {
    id: string;
    code: string;
    name: string;
    sortOrder: number;
    base: ProductionAllocationBase;
    pools: {
      id: string;
      code: string;
      name: string;
      costBehavior: string;
      amount: number;
      lineCount: number;
      lines: {
        voucherId: string;
        date: string;
        description: string;
        costCenter: string;
        mainAccount: string;
        amount: number;
      }[];
    }[];
    inputs: {
      itemId: string;
      quantity: number;
      unitCost: number | null;
      amount: number | null;
      sourceStageId: string | null;
    }[];
    outputs: {
      itemId: string;
      warehouseId: string | null;
      quantity: number;
      salesPrice: number | null;
      manualAmount: number | null;
      allocatedAmount: number | null;
      unitCost: number | null;
    }[];
  }[];
  unmatched: {
    voucherId: string;
    date: string;
    description: string;
    costCenter: string;
    mainAccount: string;
    amount: number;
  }[];
  items: { id: string; code: string; name: string; unit: string }[];
  warehouses: { id: string; code: string; name: string }[];
}

export type ProductionWorkspaceResult =
  | { ok: true; data: ProductionWorkspaceData }
  | { ok: false; code: "unauthenticated" };

export async function getProductionWorkspace(
  periodCode: string
): Promise<ProductionWorkspaceResult> {
  const userId = await userIdOrNull();
  if (!userId) return { ok: false, code: "unauthenticated" };

  const [collected, stageRows, run, items, warehouseRows] = await Promise.all([
    collectGlPools(userId, periodCode),
    db.query.productionStages.findMany({
      where: and(
        eq(productionStages.userId, userId),
        eq(productionStages.isActive, true)
      ),
      with: { pools: { with: { rules: true } } },
      orderBy: (stage, { asc }) => [asc(stage.sortOrder), asc(stage.code)],
    }),
    db.query.productionRuns.findFirst({
      where: and(
        eq(productionRuns.userId, userId),
        eq(productionRuns.periodCode, periodCode)
      ),
      with: { stages: true, inputs: true, outputs: true },
    }),
    db.query.inventoryItems.findMany({
      where: and(
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.isActive, true)
      ),
      columns: { id: true, code: true, name: true, unit: true },
      orderBy: (item, { asc }) => [asc(item.code)],
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.userId, userId), eq(warehouses.isActive, true)),
      columns: { id: true, code: true, name: true },
      orderBy: (warehouse, { asc }) => [asc(warehouse.code)],
    }),
  ]);

  const runStageByStage = new Map(
    (run?.stages ?? []).map((entry) => [entry.stageId, entry])
  );

  return {
    ok: true,
    data: {
      periodCode,
      runStatus: run ? (run.status as "draft" | "confirmed") : "none",
      stages: stageRows.map((stage) => ({
        id: stage.id,
        code: stage.code,
        name: stage.name,
        sortOrder: stage.sortOrder,
        base:
          (runStageByStage.get(stage.id)
            ?.allocationBase as ProductionAllocationBase) ?? "sales_value",
        pools: stage.pools
          .filter((pool) => pool.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
          .map((pool) => {
            const match = collected.matched.get(pool.id);
            return {
              id: pool.id,
              code: pool.code,
              name: pool.name,
              costBehavior: pool.costBehavior,
              amount: match?.amount ?? 0,
              lineCount: match?.lineCount ?? 0,
              lines: (match?.lines ?? []).map((line) => ({
                voucherId: line.voucherId,
                date: line.date,
                description: line.description,
                costCenter: line.costCenter,
                mainAccount: line.mainAccount,
                amount: Math.round(line.amount * 100) / 100,
              })),
            };
          }),
        inputs: (run?.inputs ?? [])
          .filter((input) => input.stageId === stage.id)
          .map((input) => ({
            itemId: input.itemId,
            quantity: Number(input.quantity),
            unitCost: Number(input.unitCost),
            amount: Number(input.amount),
            sourceStageId: input.sourceStageId,
          })),
        outputs: (run?.outputs ?? [])
          .filter((output) => output.stageId === stage.id)
          .map((output) => ({
            itemId: output.itemId,
            warehouseId: output.warehouseId,
            quantity: Number(output.quantity),
            salesPrice:
              output.salesPrice === null ? null : Number(output.salesPrice),
            manualAmount:
              output.manualAmount === null ? null : Number(output.manualAmount),
            allocatedAmount:
              output.allocatedAmount === null
                ? null
                : Number(output.allocatedAmount),
            unitCost: output.unitCost === null ? null : Number(output.unitCost),
          })),
      })),
      unmatched: collected.unmatched.map((line) => ({
        voucherId: line.voucherId,
        date: line.date,
        description: line.description,
        costCenter: line.costCenter,
        mainAccount: line.mainAccount,
        amount: Math.round(line.amount * 100) / 100,
      })),
      items,
      warehouses: warehouseRows,
    },
  };
}

/** Тохиргооны хуудсанд — дамжлага, бүлэг, дүрмүүд. */
export async function loadProductionConfig(userId: string) {
  const stages = await db.query.productionStages.findMany({
    where: eq(productionStages.userId, userId),
    with: { pools: { with: { rules: true } } },
    orderBy: (stage, { asc }) => [asc(stage.sortOrder), asc(stage.code)],
  });
  return stages;
}

/** Дансны жагсаалт зураглалын дүрмийн тусламжид. */
export async function loadAccountOptions(userId: string) {
  return db.query.chartOfAccounts.findMany({
    where: and(
      eq(chartOfAccounts.userId, userId),
      eq(chartOfAccounts.isEnabled, true)
    ),
    columns: { number: true, name: true },
    orderBy: (account, { asc }) => [asc(account.number)],
  });
}

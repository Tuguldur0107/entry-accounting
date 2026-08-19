"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getActiveOrg, requireRole } from "@/lib/auth";
import { assertPeriodOpen, assertPeriodOpenInTx } from "@/lib/periods/guard";
import { latestUnitCost } from "@/lib/costing/valuation";
import {
  defaultIssueType,
  loadCostingAccountSettings,
  resolveIssueDebitAccount,
} from "@/lib/costing/master-data";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  costComponents,
  costEntries,
  costingItemSettings,
  costingRuns,
  inventoryIssueTypes,
  inventoryItems,
  inventoryMovements,
  journalLines,
  journalVouchers,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { buildSegCode } from "@/lib/grid/segments";
import {
  computeCostingRun,
  entryPostingAccounts,
  type CostEntryType,
  type PostedEntryRef,
  type ValueAdjustmentRef,
} from "@/lib/costing/costing";
import type { MovementRef, MovementType } from "@/lib/inventory/balances";
import type { CostEntryView } from "@/lib/inventory/types";
import { logAuditEvent } from "@/lib/audit";

/** Бичилтийн эрхтэй (accountant+) гишүүний org контекст. */
async function requireAccountant() {
  return requireRole("accountant");
}

function revalidateCosting() {
  for (const path of [
    "/costing",
    "/costing/entries",
    "/costing/reports",
    "/costing/settings",
    "/inventory",
    "/inventory/movements",
    "/gl/journal",
    "/gl/reports",
  ])
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

// Идэвхтэй сегмент ID-ууд — тохиргооноос (S3 буюу ерөнхий данс үргэлж
// идэвхтэй). Posting code builder болон панелийн дэлгэрэнгүй хоёулаа энэ
// НЭГ хэрэгжилтийг ашиглана.
function activeSegIdsOf(
  configs: { segmentId: number; isEnabled: boolean }[]
): number[] {
  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  return SEGMENT_DEFS.filter(
    (definition) =>
      definition.id === 3 || configMap.get(definition.id)?.isEnabled === true
  ).map((definition) => definition.id);
}

// Cash-ийн cashPostingCodeBuilder-ийн клон: S9 = "CO" (Өртгийн бүртгэл).
async function costingPostingCodeBuilder(orgId: string) {
  const [configs, values] = await Promise.all([
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.organizationId, orgId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.organizationId, orgId),
        eq(segmentValues.isEnabled, true)
      ),
    }),
  ]);
  const activeSegIds = activeSegIdsOf(configs);
  const defaults: Record<number, string> = {};
  for (const segmentId of activeSegIds) {
    const options = values.filter((value) => value.segmentId === segmentId);
    if (options.length === 1) defaults[segmentId] = options[0].code;
  }
  if (activeSegIds.includes(9)) defaults[9] = "CO";
  return (mainAccount: string) =>
    buildSegCode({ ...defaults, 3: mainAccount }, activeSegIds, {
      ...defaults,
      9: "CO",
    });
}

// ─── Тохиргоо (бараа бүрийн дансны mapping) ──────────────────────────────────

export async function upsertCostingItemSetting(data: {
  itemId: string;
  inventoryAccountNumber: string;
  cogsAccountNumber: string;
}) {
  const { orgId, userId } = await requireRole("admin");
  const inventoryAccountNumber = data.inventoryAccountNumber.trim();
  const cogsAccountNumber = data.cogsAccountNumber.trim();
  // Tie-out тайлан 14-бүлгээр тулгадаг тул mapping-ийг бүлэгт нь барина.
  if (!inventoryAccountNumber.startsWith("14"))
    throw new Error("Бараа материалын данс 14-бүлгийн данс байна");
  if (!/^[678]/.test(cogsAccountNumber))
    throw new Error("Өртгийн данс зардлын (6/7/8) бүлгийн данс байна");
  await assertEnabledMainAccount(orgId, inventoryAccountNumber);
  await assertEnabledMainAccount(orgId, cogsAccountNumber);

  const item = await db.query.inventoryItems.findFirst({
    where: and(
      eq(inventoryItems.id, data.itemId),
      eq(inventoryItems.organizationId, orgId)
    ),
    columns: { id: true },
  });
  if (!item) throw new Error("Бараа олдсонгүй");

  const existing = await db.query.costingItemSettings.findFirst({
    where: and(
      eq(costingItemSettings.organizationId, orgId),
      eq(costingItemSettings.itemId, data.itemId)
    ),
    columns: { id: true },
  });
  if (existing)
    await db
      .update(costingItemSettings)
      .set({ inventoryAccountNumber, cogsAccountNumber })
      .where(eq(costingItemSettings.id, existing.id));
  else
    await db.insert(costingItemSettings).values({
      userId,
      organizationId: orgId,
      itemId: data.itemId,
      inventoryAccountNumber,
      cogsAccountNumber,
    });
  revalidateCosting();
}

function postedLandedCosts(
  entries: {
    id: string;
    itemId: string | null;
    entryType: string;
    status: string;
    date: string;
    amount: string;
    createdAt: Date;
  }[]
): ValueAdjustmentRef[] {
  return entries
    .filter(
      (entry) =>
        entry.entryType === "landed_cost" &&
        entry.status === "posted" &&
        entry.itemId != null
    )
    .map((entry) => ({
      id: entry.id,
      itemId: entry.itemId!,
      date: entry.date,
      amount: Number(entry.amount),
      createdAt: entry.createdAt.toISOString(),
    }));
}

// ─── Costing run ─────────────────────────────────────────────────────────────

// Гараар үнэ өгөх орлогууд: movementId → unitCost. Run нь баталсан-
// үнэлэгдээгүй хөдөлгөөнүүдийг он цагийн дарааллаар үнэлж ноорог cost entry
// үүсгэнэ; үнэ хүлээгдэж буй орлого болон түүнд блоклогдсон хөдөлгөөнүүд
// pending буцна.
export async function runCosting(data: {
  asOfDate: string;
  receiptCosts?: Record<string, number>;
}) {
  const { orgId, userId } = await requireAccountant();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.asOfDate))
    throw new Error("Огноо буруу байна");

  // Давхар run-аас хамгаалах: унших-тооцох-бичих бүхэлдээ транзакцад,
  // хэрэглэгч бүрийн advisory lock дор (хоёр зэрэг run нэг хөдөлгөөнийг
  // хоёр удаа үнэлж GL-ийг давхарлахаас сэргийлнэ).
  return await db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 2)`);

  const [movements, activeEntries] = await Promise.all([
    tx.query.inventoryMovements.findMany({
      where: and(
        eq(inventoryMovements.organizationId, orgId),
        eq(inventoryMovements.status, "confirmed")
      ),
    }),
    tx.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        inArray(costEntries.status, ["draft", "posted"])
      ),
    }),
  ]);

  // Confirmed хөдөлгөөнд item/warehouse null байх боломжгүй (confirm guard).
  const movementRefs: MovementRef[] = movements.map((row) => ({
    id: row.id,
    movementType: row.movementType as MovementType,
    date: row.date,
    itemId: row.itemId ?? "",
    warehouseId: row.warehouseId ?? "",
    toWarehouseId: row.toWarehouseId,
    quantity: Number(row.quantity),
    createdAt: row.createdAt.toISOString(),
  }));
  // Хөдөлгөөнгүй бичилт (NRV гэх мэт) дундажийн replay-д ОРОХГҮЙ — NRV нь
  // IAS 2-оор өртгийн суурь хэвээр, нөөц нь тусдаа. (movementId=null нь
  // бүтцийн шүүлт — PostedEntryRef хөдөлгөөнд заавал холбогдоно.)
  const valuedEntries: PostedEntryRef[] = activeEntries
    .filter((entry) => entry.movementId != null)
    .map((entry) => ({
      movementId: entry.movementId!,
      entryType: entry.entryType as CostEntryType,
      quantity: Number(entry.quantity),
      unitCost: Number(entry.unitCost),
      amount: Number(entry.amount),
    }));

  const receiptCosts = new Map<string, number>();
  for (const [movementId, unitCost] of Object.entries(data.receiptCosts ?? {})) {
    const value = Number(unitCost);
    if (Number.isFinite(value) && value >= 0) receiptCosts.set(movementId, value);
  }

  const result = computeCostingRun({
    movements: movementRefs,
    valuedEntries,
    receiptCosts,
    asOfDate: data.asOfDate,
    valueAdjustments: postedLandedCosts(activeEntries),
  });

  // ЗӨВХӨН ХУДАЛДАН АВАЛТЫН ОРЛОГЫГ шууд үнэлнэ — түүний өртөг эх
  // баримтаас ирдэг тул хүлээх шаардлагагүй, мөн сарын дундажийг ЭНЭ
  // тодорхойлдог. Зарлага, тооллогын тохируулга, буцаалт нь сарын дундаж
  // гарах хүртэл хүлээнэ (README change-control 0.3: "сар дуусаад бүх
  // зардал бүртгэгдсэний дараа өртөг тооцно") — тэднийг
  // computePeriodCosting үнэлж GL-д бичнэ.
  const immediateEntries = result.entries.filter(
    (entry) => entry.entryType === "receipt_capitalize"
  );
  const deferred = result.entries.length - immediateEntries.length;

  if (immediateEntries.length === 0)
    return { created: 0, pending: result.pending, deferred };

  const [run] = await tx
    .insert(costingRuns)
    .values({
      userId,
      organizationId: orgId,
      asOfDate: data.asOfDate,
      entryCount: immediateEntries.length,
      pendingCount: result.pending.length,
    })
    .returning({ id: costingRuns.id });

  // Хөдөлгөөнөөс ирэх ангилал/хамрах хүрээг өртгийн бичилтэд шилжүүлнэ
  // (FR-LEDGER-COST-003, OD-001 хамрах хүрээ, OD-002 период).
  const movementById = new Map(movements.map((row) => [row.id, row]));

  await tx.insert(costEntries).values(
    immediateEntries.map((entry) => {
      const movement = movementById.get(entry.movementId);
      return {
      userId,
      organizationId: orgId,
      runId: run.id,
      movementId: entry.movementId,
      itemId: movement?.itemId ?? null,
      warehouseId: movement?.warehouseId ?? null,
      periodCode: entry.date.slice(0, 7),
      issueTypeId: movement?.issueTypeId ?? null,
      entryType: entry.entryType,
      date: entry.date,
      quantity: String(entry.quantity),
      unitCost: String(entry.unitCost),
      amount: String(entry.amount),
      valuationSource: entry.valuationSource,
      // 0 дүнтэй үнэлгээ (үнэгүй орлого, 0 дундажтай тохируулга) GL-д
      // бичих зүйлгүй тул шууд "posted" — үнэлэгдсэнд тооцогдож,
      // pipeline-д гацахгүй.
      ...(entry.amount === 0
        ? { status: "posted" as const, postedAt: new Date() }
        : {}),
      };
    })
  );

  revalidateCosting();
  return {
    created: immediateEntries.length,
    pending: result.pending,
    deferred,
  };
  });
}

// ─── Cost entry lifecycle ────────────────────────────────────────────────────

async function itemAccountsFor(orgId: string, userId: string, itemId: string) {
  const setting = await db.query.costingItemSettings.findFirst({
    where: and(
      eq(costingItemSettings.organizationId, orgId),
      eq(costingItemSettings.itemId, itemId)
    ),
  });
  if (setting)
    return {
      inventoryAccountNumber: setting.inventoryAccountNumber,
      cogsAccountNumber: setting.cogsAccountNumber,
    };

  // Тохиргооны мөр байхгүй үед бичих мөчид ТОГТМОЛООР шийдэхгүй (docs/cost
  // JPR-006 / CLAUDE.md: нээлттэй шийдвэрийг fallback дансанд нуухыг
  // хориглодог). Оронд нь мөрийг schema-ийн default утгатай нь ҮҮСГЭНЭ —
  // Тохиргоо → Өртөг → Барааны данс хуудсанд яг эдгээр утга аль хэдийн
  // харагдаж, засагдах боломжтой тул энэ нь нуугдсан тогтмол биш, ИЛ
  // хадгалагдсан тохиргоо болно (master-data.ts-ийн ratified-seed хэв
  // маягтай ижил — README change-control 0.2/0.3: одоогийн дүрмийг нэг
  // удаа seed хийж, түүнээс хойш зөвхөн тохиргооноос уншина).
  const [created] = await db
    .insert(costingItemSettings)
    .values({ userId, organizationId: orgId, itemId })
    .onConflictDoNothing()
    .returning();
  const row =
    created ??
    (await db.query.costingItemSettings.findFirst({
      where: and(
        eq(costingItemSettings.organizationId, orgId),
        eq(costingItemSettings.itemId, itemId)
      ),
    }));
  if (!row)
    throw new Error(
      "Барааны дансны тохиргоо олдсонгүй — Тохиргоо → Өртөг → Барааны данс хэсэгт бүртгэнэ үү"
    );
  return {
    inventoryAccountNumber: row.inventoryAccountNumber,
    cogsAccountNumber: row.cogsAccountNumber,
  };
}

/** Нэг зарлагын төрөл — id-гаар (хэрэглэгчийн хүрээнд). */
async function loadIssueTypeById(orgId: string, id: string) {
  return (
    (await db.query.inventoryIssueTypes.findFirst({
      where: and(
        eq(inventoryIssueTypes.id, id),
        eq(inventoryIssueTypes.organizationId, orgId)
      ),
    })) ?? null
  );
}

export async function postCostEntry(id: string) {
  const { orgId, userId } = await requireAccountant();
  const entry = await db.query.costEntries.findFirst({
    where: and(eq(costEntries.id, id), eq(costEntries.organizationId, orgId)),
    with: { movement: { with: { item: true } }, item: true },
  });
  if (!entry) throw new Error("Өртгийн бичилт олдсонгүй");
  if (entry.status !== "draft")
    throw new Error("Зөвхөн ноорог бичилтийг батална");
  await assertPeriodOpen(orgId, entry.date);
  const amount = Number(entry.amount);
  if (!(amount > 0))
    throw new Error("0 дүнтэй бичилтийг GL-д бичихгүй — устгана уу");

  // NRV-ийг entryType-оор танина (movementId биш): устгагдсан хөдөлгөөний
  // буцаагдсан бичилт movementId=null болдог тул null нь NRV гэсэн үг БИШ.
  const isNrv =
    entry.entryType === "nrv_writedown" || entry.entryType === "nrv_reversal";
  const linkedItemId = isNrv ? entry.itemId : entry.movement?.itemId;
  if (!linkedItemId)
    throw new Error("Бичилтийн бараа сонгогдоогүй байна");
  const accounts = await itemAccountsFor(orgId, userId, linkedItemId);
  const roleSettings = await loadCostingAccountSettings(orgId, userId);
  // Үйлдвэрлэлийн ОРЦЫН зарлага мөн үү? confirmProductionRun орцоо
  // issueTypeId-гүй, "PROD-…-INxx" дугаартай зарлага болгон үүсгэдэг.
  const isProductionInput =
    !isNrv &&
    entry.movement?.movementType === "issue" &&
    entry.movement.documentNo.startsWith("PROD-");
  // Зарлагын дебет чиглэл: бичилтэд оноогдсон төрөл, эс бөгөөс анхны
  // "COGS" төрөл (энэ нь барааны COGS данс руу шийддэг profile тул хуучин
  // зан төлөв хэвээр). FR-MD-IT-002 / FR-ISSUE-002.
  //
  // ҮЙЛДВЭРЛЭЛИЙН ОРЦОД COGS fallback ХОРИОТОЙ (JPR §7.1): орцын өртөг
  // гаралтын receipt_capitalize-д аль хэдийн капитализацлагдсан тул COGS-д
  // давхар бичвэл P&L ДАВХАРДАНА. Ил тохируулсан зарлагын төрөлгүй орц нь
  // клиринг дансаар дебетлэгдэнэ (JPR-IN-002 cost source recognition:
  // Dr клиринг / Cr түүхий эдийн нөөц), гаралт нь Dr бэлэн бүтээгдэхүүн /
  // Cr мөн тэр клиринг (JPR-IN-003, README 0.4) — run бүрд клиринг 0-ээр
  // тулна, орцын өртөг P&L-д огт хүрэхгүй. Данс нь JPR-006-гийн
  // costing_account_settings.clearingAccountNumber тохиргооноос ирнэ.
  const entryIssueType = entry.issueTypeId
    ? await loadIssueTypeById(orgId, entry.issueTypeId)
    : null;
  const resolvedIssueType =
    entryIssueType ??
    (isProductionInput ? null : await defaultIssueType(orgId));
  const issueDebitAccountNumber = resolvedIssueType
    ? resolveIssueDebitAccount(resolvedIssueType, accounts.cogsAccountNumber)
    : isProductionInput
      ? roleSettings.clearingAccountNumber
      : accounts.cogsAccountNumber;
  // Бүрэлдэхүүнд ӨӨРИЙН clearing данс тохируулсан бол нэмэлт зардлын
  // бичилт ТЭР дансаар кредитлэгдэнэ (corrected baseline §4: Dr Inventory /
  // Cr the SAME component clearing) — эс бөгөөс ерөнхий клиринг.
  let componentClearing: string | null = null;
  if (entry.entryType === "landed_cost" && entry.costComponentId) {
    const component = await db.query.costComponents.findFirst({
      where: and(
        eq(costComponents.id, entry.costComponentId),
        eq(costComponents.organizationId, orgId)
      ),
      columns: { accountNumber: true },
    });
    componentClearing = component?.accountNumber ?? null;
  }
  const { debit, credit } = entryPostingAccounts(
    entry.entryType as CostEntryType,
    {
      inventoryAccountNumber: accounts.inventoryAccountNumber,
      issueDebitAccountNumber,
    },
    {
      clearing: componentClearing ?? roleSettings.clearingAccountNumber,
      adjustmentGain: roleSettings.adjustmentGainAccountNumber,
      adjustmentLoss: roleSettings.adjustmentLossAccountNumber,
      nrvExpense: roleSettings.nrvExpenseAccountNumber,
      nrvReserve: roleSettings.nrvReserveAccountNumber,
    }
  );
  await assertEnabledMainAccount(orgId, debit);
  await assertEnabledMainAccount(orgId, credit);
  const buildCode = await costingPostingCodeBuilder(orgId);

  const itemName = entry.movement?.item?.name ?? entry.item?.name ?? "";
  const description = isNrv
    ? `[NRV] ${itemName} — цэвэр боломжит үнийн бууруулалт`
    : entry.movement
      ? `[${entry.movement.documentNo}] ${itemName} — ${entry.movement.description || "өртгийн бичилт"}`
      : entry.entryType === "landed_cost"
        ? `[Landed cost] ${itemName} — нэмэлт зардлын капитализаци`
        : `${itemName} — өртгийн бичилт`;

  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, entry.date);
    const [claimed] = await tx
      .update(costEntries)
      .set({
        status: "posted",
        postedAt: new Date(),
        // Бичих мөчид шийдэгдсэн дүр зураг — master data хожим өөрчлөгдөхөд
        // түүхэн бичилт дахин тайлагдахгүй (JPR-005, FR-AUD-003).
        issueTypeId: entry.issueTypeId ?? resolvedIssueType?.id ?? null,
        debitAccountNumber: debit,
        creditAccountNumber: credit,
      })
      .where(
        and(
          eq(costEntries.id, id),
          eq(costEntries.organizationId, orgId),
          eq(costEntries.status, "draft")
        )
      )
      .returning({ id: costEntries.id });
    if (!claimed) throw new Error("Бичилтийн төлөв өөрчлөгдсөн байна");

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: entry.date,
        description,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });

    await tx.insert(journalLines).values([
      {
        voucherId: voucher.id,
        costEntryId: entry.id,
        inventoryMovementId: entry.movementId,
        accountNumber: buildCode(debit),
        debit: String(amount),
        credit: "0",
        description,
        sortOrder: 0,
      },
      {
        voucherId: voucher.id,
        costEntryId: entry.id,
        inventoryMovementId: entry.movementId,
        accountNumber: buildCode(credit),
        debit: "0",
        credit: String(amount),
        description,
        sortOrder: 1,
      },
    ]);

    await tx
      .update(costEntries)
      .set({ voucherId: voucher.id })
      .where(eq(costEntries.id, id));
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "post",
        entityType: "cost",
        entityId: id,
        summary: `Өртгийн бичилт батлагдав — ${description}, ${entry.date}, дүн ${amount.toLocaleString("en-US")}₮`,
      },
      tx
    );
  });

  revalidateCosting();
}

export async function postCostEntries(ids: string[]) {
  const failures: { id: string; error: string }[] = [];
  let posted = 0;
  for (const id of ids) {
    try {
      await postCostEntry(id);
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

export async function deleteCostEntry(id: string) {
  const { orgId, userId } = await requireAccountant();
  const entry = await db.query.costEntries.findFirst({
    where: and(eq(costEntries.id, id), eq(costEntries.organizationId, orgId)),
    with: { movement: true },
  });
  if (!entry) return;
  if (entry.status !== "draft")
    throw new Error("Зөвхөн ноорог бичилтийг устгана");

  // NRV бичилт дундажид нөлөөлдөггүй — шууд устгаж болно. Таних нь
  // entryType-оор (movementId=null нь устгагдсан хөдөлгөөний бичилт ч
  // байж болно — NRV гэсэн үг биш).
  if (
    entry.entryType === "nrv_writedown" ||
    entry.entryType === "nrv_reversal"
  ) {
    await db
      .delete(costEntries)
      .where(and(eq(costEntries.id, id), eq(costEntries.organizationId, orgId)));
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "delete",
      entityType: "cost",
      entityId: id,
      summary: `Өртгийн NRV бичилт устгагдав — ${entry.date}, дүн ${Number(entry.amount).toLocaleString("en-US")}₮`,
    });
    revalidateCosting();
    return;
  }

  // Дундаж өртөг дараалсан бичилтүүдээр дамждаг: энэ бичилтээс ХОЙШХИ
  // идэвхтэй бичилт тухайн бараанд байвал тэдгээрийн үнэлгээ энэ бичилтийн
  // дунджаас хамаарсан — эхлээд сүүлийнхийг нь устгаж/буцаана.
  const laterEntries = await db.query.costEntries.findMany({
    where: and(
      eq(costEntries.organizationId, orgId),
      inArray(costEntries.status, ["draft", "posted"])
    ),
    with: { movement: { columns: { itemId: true, date: true, createdAt: true } } },
  });
  const dependent = laterEntries.find(
    (candidate) =>
      candidate.id !== entry.id &&
      candidate.movement != null &&
      entry.movement != null &&
      candidate.movement.itemId === entry.movement.itemId &&
      (candidate.movement.date > entry.movement.date ||
        (candidate.movement.date === entry.movement.date &&
          candidate.movement.createdAt > entry.movement.createdAt))
  );
  if (dependent)
    throw new Error(
      "Энэ барааны хожмын бичилтүүд энэ үнэлгээнээс хамаарна — эхлээд тэдгээрийг устгаж/буцаана үү"
    );

  await db
    .delete(costEntries)
    .where(and(eq(costEntries.id, id), eq(costEntries.organizationId, orgId)));
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "delete",
    entityType: "cost",
    entityId: id,
    summary: `Өртгийн бичилт устгагдав — ${entry.movement?.documentNo ?? "—"}, ${entry.date}, дүн ${Number(entry.amount).toLocaleString("en-US")}₮`,
  });
  revalidateCosting();
}

// Буцаалт: журналыг эсрэг бичилтээр буцааж, entry-г reversed болгоно.
// Дараагийн costing run уг хөдөлгөөнийг дахин үнэлж болно (reversed entry
// идэвхтэйд тооцогдохгүй).
export async function reverseCostEntry(id: string) {
  const { orgId, userId } = await requireAccountant();
  const entry = await db.query.costEntries.findFirst({
    where: and(eq(costEntries.id, id), eq(costEntries.organizationId, orgId)),
    with: { movement: true },
  });
  if (!entry || entry.status !== "posted" || !entry.voucherId)
    throw new Error("Зөвхөн батлагдсан бичилтийг буцаана");
  await assertPeriodOpen(orgId, entry.date);
  // Хөдөлгөөнгүй бичилт заавал NRV биш (устгагдсан хөдөлгөөн байж болно) —
  // шошгыг entryType-оор ялгана.
  const entryLabel =
    entry.movement?.documentNo ??
    (entry.entryType === "nrv_writedown" || entry.entryType === "nrv_reversal"
      ? "NRV"
      : "—");

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
    await assertPeriodOpenInTx(tx, orgId, entry.date);
    const [claimed] = await tx
      .update(costEntries)
      .set({ status: "reversed" })
      .where(
        and(
          eq(costEntries.id, id),
          eq(costEntries.organizationId, orgId),
          eq(costEntries.status, "posted")
        )
      )
      .returning({ id: costEntries.id });
    if (!claimed) throw new Error("Бичилтийн төлөв өөрчлөгдсөн байна");

    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: entry.date,
        description: `Буцаалт [${entryLabel}] ${voucher.description}`,
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

    // Воучерийг claim хийж буцаана: GL талаас (unpost) аль хэдийн
    // буцаагдсан бол ХОЁР ДАХЬ буцаалт бичихгүй — алдаа шидэж транзакц
    // бүхэлдээ буцна.
    const [voucherClaimed] = await tx
      .update(journalVouchers)
      .set({ status: "reversed" })
      .where(
        and(
          eq(journalVouchers.id, voucher.id),
          eq(journalVouchers.status, "posted")
        )
      )
      .returning({ id: journalVouchers.id });
    if (!voucherClaimed)
      throw new Error(
        "GL журнал аль хэдийн буцаагдсан байна — бичилтийн төлвийг шалгана уу"
      );

    await tx
      .update(costEntries)
      .set({ reversalVoucherId: reversal.id })
      .where(eq(costEntries.id, id));
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "reverse",
        entityType: "cost",
        entityId: id,
        summary: `Өртгийн бичилт буцаагдав — [${entryLabel}], ${entry.date}, дүн ${Number(entry.amount).toLocaleString("en-US")}₮`,
      },
      tx
    );
  });

  revalidateCosting();
}

// ─── NRV бууруулалт / сэргээлт (IAS 2 §9, §28–33) ────────────────────────────

// Барааны цэвэр боломжит үнэ (NRV/нэгж)-ийг өгөхөд: зорилтот нөөц =
// max(0, дундаж − NRV) × үлдэгдэл; одоогийн нөөцтэй харьцуулж зөрүүгээр
// бууруулалт (Dr 87100005 / Cr 14900001) эсвэл сэргээлтийн (эсрэг) НООРОГ
// бичилт үүсгэнэ. Сэргээлт өмнөх бууруулалтаас хэтрэхгүй (зорилтот ≥ 0).
export async function createNrvEntry(data: {
  itemId: string;
  date: string;
  nrvPerUnit: number;
}) {
  const { orgId, userId } = await requireAccountant();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
    throw new Error("Огноо буруу байна");
  const nrvPerUnit = Number(data.nrvPerUnit);
  if (!Number.isFinite(nrvPerUnit) || nrvPerUnit < 0)
    throw new Error("NRV 0 буюу түүнээс их байна");

  const item = await db.query.inventoryItems.findFirst({
    where: and(
      eq(inventoryItems.id, data.itemId),
      eq(inventoryItems.organizationId, orgId)
    ),
    columns: { id: true, name: true },
  });
  if (!item) throw new Error("Бараа олдсонгүй");

  return await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 2)`);

    // Хөдөлгөөн шаардлагагүй — өртгийн суурийг cost_period_results-ээс авна.
    const entries = await tx.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        inArray(costEntries.status, ["draft", "posted"])
      ),
    });

    // Өртгийн суурь нь ӨРТГИЙН ХЯНАЛТЫН тайлантай ИЖИЛ: cost_period_results-
    // ийн хамгийн сүүлийн тооцоологдсон сарын C2 нэгж өртөг (docs/cost
    // FR-PR-001 — нэг л арга). Урьд нь perpetual дундаж бодогддог байсан нь
    // одоо батлагдсан дүрэмтэй зөрчилдөнө.
    const closing = await latestUnitCost(orgId, data.itemId);
    const qty = closing?.qty ?? 0;
    const avgCost = closing?.unitCost ?? 0;
    if (!(qty > 0))
      throw new Error(
        "Тооцоологдсон үлдэгдэл алга — эхлээд сарын өртөг тооцоолно уу"
      );

    // Одоогийн нөөц: идэвхтэй (draft орсон — давхар бичилтээс сэргийлнэ)
    // NRV бичилтүүдийн цэвэр дүн.
    let currentReserve = 0;
    for (const entry of entries) {
      if (entry.itemId !== data.itemId) continue;
      if (entry.entryType === "nrv_writedown")
        currentReserve += Number(entry.amount);
      else if (entry.entryType === "nrv_reversal")
        currentReserve -= Number(entry.amount);
    }
    currentReserve = Math.round(currentReserve * 100) / 100;

    const targetReserve =
      Math.round(Math.max(0, avgCost - nrvPerUnit) * qty * 100) / 100;
    const delta = Math.round((targetReserve - currentReserve) * 100) / 100;
    if (Math.abs(delta) <= 0.01)
      throw new Error("Нөөцийн зөрүү 0 байна — бичилт шаардлагагүй");

    const [created] = await tx
      .insert(costEntries)
      .values({
        userId,
        organizationId: orgId,
        movementId: null,
        itemId: data.itemId,
        entryType: delta > 0 ? "nrv_writedown" : "nrv_reversal",
        date: data.date,
        quantity: String(qty),
        unitCost: String(nrvPerUnit),
        amount: String(Math.abs(delta)),
        valuationSource: "manual",
      })
      .returning({ id: costEntries.id });

    return {
      id: created.id,
      entryType: delta > 0 ? "nrv_writedown" : "nrv_reversal",
      amount: Math.abs(delta),
      qty,
      avgCost,
      targetReserve,
      currentReserve,
    };
  }).then((result) => {
    revalidateCosting();
    return result;
  });
}

// ─── Landed cost (IAS 2.11) ──────────────────────────────────────────────────

// Клирингт суусан тээвэр/гааль зэрэг зардлыг сонгосон бараанд оноож НООРОГ
// бичилт үүсгэнэ (Dr бараа данс / Cr 14000099). Батлагдмагц тухайн огнооноос
// хойшхи costing run-ууд дундажийг өссөнөөр тооцно.
// ─── Панелийн дэлгэрэнгүй ────────────────────────────────────────────────────

// Өртгийн бичилтийн панель бүх өгөгдлөө id-аар татна: мета (жагсаалтын
// мөртэй ИЖИЛ CostEntryView хэлбэрээр), холбогдсон GL журналын мөрүүд,
// дансны нэрс, идэвхтэй сегментүүд.
export interface CostEntryPanelData {
  entry: CostEntryView;
  voucher: { id: string; date: string; description: string } | null;
  /** Reversed бичилтийн буцаалтын журнал (байвал). */
  reversalVoucherId: string | null;
  lines: {
    accountNumber: string;
    debit: number;
    credit: number;
    description: string | null;
  }[];
  glNames: Record<string, string>;
  activeSegIds: number[];
}

// Алдааг throw хийхгүй — production дээр Next.js server action-ий error
// message-ийг нуудаг тул код буцаана (journal-editor-тэй ижил хэлбэр).
export type CostEntryPanelResult =
  | { ok: true; data: CostEntryPanelData }
  | { ok: false; code: "unauthenticated" | "not-found" };

export async function getCostEntryPanelData(
  entryId: string
): Promise<CostEntryPanelResult> {
  const active = await getActiveOrg().catch(() => null);
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId } = active;

  const [entry, glAccounts, segConfigs] = await Promise.all([
    db.query.costEntries.findFirst({
      where: and(eq(costEntries.id, entryId), eq(costEntries.organizationId, orgId)),
      with: { movement: { with: { item: true } }, item: true },
    }),
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      columns: { number: true, name: true },
    }),
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.organizationId, orgId),
    }),
  ]);
  if (!entry) return { ok: false, code: "not-found" };

  const voucher = entry.voucherId
    ? await db.query.journalVouchers.findFirst({
        where: and(
          eq(journalVouchers.id, entry.voucherId),
          eq(journalVouchers.organizationId, orgId)
        ),
        with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
      })
    : undefined;

  const item = entry.movement?.item ?? entry.item;
  return {
    ok: true,
    data: {
      entry: {
        id: entry.id,
        movementId: entry.movementId,
        // NRV-таних нь entryType-оор — movementId=null нь устгагдсан
        // хөдөлгөөний буцаагдсан бичилт ч байж болно.
        documentNo:
          entry.movement?.documentNo ??
          (entry.entryType === "nrv_writedown" ||
          entry.entryType === "nrv_reversal"
            ? "NRV"
            : "—"),
        itemLabel: item ? `${item.code} · ${item.name}` : "⚠ Бараа сонгоогүй",
        unit: item?.unit ?? "",
        entryType: entry.entryType,
        date: entry.date,
        quantity: Number(entry.quantity),
        unitCost: Number(entry.unitCost),
        amount: Number(entry.amount),
        valuationSource: entry.valuationSource,
        status: entry.status,
        voucherId: entry.voucherId,
      },
      voucher: voucher
        ? {
            id: voucher.id,
            date: voucher.date,
            description: voucher.description,
          }
        : null,
      reversalVoucherId: entry.reversalVoucherId,
      lines: (voucher?.lines ?? []).map((line) => ({
        accountNumber: line.accountNumber,
        debit: Number(line.debit),
        credit: Number(line.credit),
        description: line.description,
      })),
      glNames: Object.fromEntries(
        glAccounts.map((account) => [account.number, account.name])
      ),
      activeSegIds: activeSegIdsOf(segConfigs),
    },
  };
}

"use server";

// Нээлтийн барааны үлдэгдлийг ӨРТӨГТЭЙ оруулах (SIM2-007 / ENT-003).
// Шийдвэр D-OS-1 / D-OS-2 — lib/inventory/opening-stock.ts-ийн толгойд.
//
// Хүлээн авалтын (confirmGoodsReceiptCore) загвар: НЭГ транзакцад мөр бүрд
//   баталгаажсан орлого (sourceType "opening") +
//   `receipt_capitalize` бичилт (valuationSource "opening", дансаа ХАДГАЛНА:
//   Dr барааны нөөц / Cr нээлтийн зөрүүний данс).
// `post` үед багцад НЭГ журнал (externalRef `opening-stock:…` → нээлтийн
// журнал гэж танигдана); ноорог үед өртгийн бичилт ноорог — «Өртгийн
// бичилт»-ээс батална (postCostEntryCore нь хадгалсан дансыг хүндэтгэнэ).
// Өртгийн PWA хөдөлгөгч ӨӨРЧЛӨГДӨӨГҮЙ: өртөгтэй орлого л.

import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray, min, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError, type ActionResult } from "@/lib/action-result";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction } from "@/lib/auth";
import { entryPostingAccounts } from "@/lib/costing/costing";
import { loadCostingAccountSettings } from "@/lib/costing/master-data";
import {
  assertEnabledMainAccount,
  costingPostingCodeBuilder,
  itemAccountsFor,
} from "@/lib/costing/posting-helpers";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  costEntries,
  inventoryItems,
  inventoryMovements,
  journalLines,
  journalVouchers,
  warehouses,
} from "@/lib/db/schema";
import { nextVoucherNo } from "@/lib/gl/voucher-no";
import {
  OPENING_STOCK_REF_PREFIX,
  OPENING_STOCK_SOURCE_TYPE,
  OPENING_VALUATION_SOURCE,
  openingStockDateProblem,
  planOpeningStock,
  type OpeningStockInputLine,
} from "@/lib/inventory/opening-stock";
import { OPENING_DIFFERENCE_ACCOUNT } from "@/lib/onboarding/guide";
import { assertCalendarDate } from "@/lib/periods/document-date";
import {
  assertNotFuturePeriod,
  assertPeriodOpen,
  assertPeriodOpenInTx,
} from "@/lib/periods/guard";

export type OpeningStockInput = {
  /** Нээлтийн (cut-off) огноо — бүх мөрд нэг. */
  date: string;
  lines: OpeningStockInputLine[];
  /** true → өртгийн бичилт батлагдаж GL журнал үүснэ (cost:post эрх). */
  post: boolean;
  /**
   * Кредит данс. Хоосон бол нээлтийн зөрүүний данс (нэрээр → стандарт
   * дугаараар, onboarding OD-ONB-1). Нээлтийн журнал барааг өөр дансанд
   * (жишээ нь бараа мат. түр данс) аль хэдийн бичсэн бол түүнийг ИЛ өгнө.
   */
  counterAccount?: string | null;
  /** Идемпотент түлхүүр — ижил утгаар дахин дуудахад шинэ бичилт үүсэхгүй. */
  externalRef?: string | null;
  description?: string | null;
};

export type OpeningStockResult = {
  batchId: string;
  created: number;
  totalAmount: number;
  status: "posted" | "draft";
  voucherId: string | null;
  voucherNo: string | null;
  counterAccount: string;
  /** Ижил externalRef-ээр өмнө үүссэн — юу ч бичээгүй. */
  dedup: boolean;
};

export async function createOpeningStock(
  input: OpeningStockInput
): Promise<ActionResult<OpeningStockResult>> {
  try {
    return await createOpeningStockCore(input);
  } catch (caught) {
    return actionError("createOpeningStock", caught, "Нээлтийн барааны үлдэгдэл оруулагдсангүй");
  }
}

/** externalRef → тогтвортой UUID (movement.sourceId нь uuid багана). */
function batchIdOf(orgId: string, externalRef: string | null | undefined): string {
  const ref = externalRef?.trim();
  if (!ref) return randomUUID();
  const hex = createHash("sha256").update(`${orgId}|opening-stock|${ref}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Журналын externalRef — `opening-stock:` угтвартай (нээлтийн журнал гэж танигдана). */
function voucherRefOf(externalRef: string | null | undefined, batchId: string): string {
  const ref = externalRef?.trim() || batchId;
  return ref.startsWith(OPENING_STOCK_REF_PREFIX) ? ref : `${OPENING_STOCK_REF_PREFIX}${ref}`;
}

async function resolveCounterAccount(orgId: string, requested: string | null | undefined) {
  const explicit = requested?.trim();
  if (explicit) {
    if (!/^\d{8}$/.test(explicit))
      throw new Error(`[ACCOUNT_NOT_FOUND] Кредит данс 8 оронтой үндсэн данс байна ("${explicit}")`);
    await assertEnabledMainAccount(orgId, explicit);
    return explicit;
  }
  const account = await db.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.organizationId, orgId),
      eq(chartOfAccounts.isEnabled, true),
      sql`(${chartOfAccounts.name} = ${OPENING_DIFFERENCE_ACCOUNT.name} or ${chartOfAccounts.number} = ${OPENING_DIFFERENCE_ACCOUNT.number})`
    ),
    columns: { number: true },
    orderBy: [sql`case when ${chartOfAccounts.name} = ${OPENING_DIFFERENCE_ACCOUNT.name} then 0 else 1 end`],
  });
  if (!account)
    throw new Error(
      `[ACCOUNT_NOT_FOUND] Нээлтийн зөрүүний данс (${OPENING_DIFFERENCE_ACCOUNT.number} «${OPENING_DIFFERENCE_ACCOUNT.name}») алга — Тохиргоо → Ерөнхий журнал → «Стандарт данс нэмэх» (sync_standard_accounts)`
    );
  return account.number;
}

/** D-OS-2: нээлтийн БУС анхны хөдөлгөөний огноо (цуцлагдсаныг тооцохгүй). */
async function firstOtherMovementDate(executor: Pick<typeof db, "select">, orgId: string) {
  const [row] = await executor
    .select({ first: min(inventoryMovements.date) })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.organizationId, orgId),
        ne(inventoryMovements.sourceType, OPENING_STOCK_SOURCE_TYPE),
        ne(inventoryMovements.status, "cancelled")
      )
    );
  return row?.first ?? null;
}

async function createOpeningStockCore(input: OpeningStockInput): Promise<OpeningStockResult> {
  const { orgId, userId } = await requireModuleAction("inv", "write");
  if (input.post) await requireModuleAction("cost", "post");

  const date = input.date;
  assertCalendarDate(date, "Нээлтийн огноо");
  assertNotFuturePeriod(date);
  const plan = planOpeningStock(input.lines ?? []);
  if (!plan.ok) throw new Error(`[INVALID_INPUT] ${plan.errors.slice(0, 20).join("; ")}`);

  const batchId = batchIdOf(orgId, input.externalRef);
  const counterAccount = await resolveCounterAccount(orgId, input.counterAccount);

  const existing = await db
    .select({ id: inventoryMovements.id })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.organizationId, orgId),
        eq(inventoryMovements.sourceType, OPENING_STOCK_SOURCE_TYPE),
        eq(inventoryMovements.sourceId, batchId)
      )
    );
  if (existing.length > 0) {
    const entries = await db.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        inArray(costEntries.movementId, existing.map((row) => row.id))
      ),
      columns: { amount: true, status: true, voucherId: true },
    });
    const voucherId = entries.find((entry) => entry.voucherId)?.voucherId ?? null;
    const voucher = voucherId
      ? await db.query.journalVouchers.findFirst({
          where: eq(journalVouchers.id, voucherId),
          columns: { documentNo: true },
        })
      : null;
    return {
      batchId,
      created: 0,
      totalAmount: Math.round(entries.reduce((sum, entry) => sum + Number(entry.amount), 0) * 100) / 100,
      status: entries.every((entry) => entry.status === "posted") ? "posted" : "draft",
      voucherId,
      voucherNo: voucher?.documentNo ?? null,
      counterAccount,
      dedup: true,
    };
  }

  // Код → бараа / агуулах (идэвхтэй). Олдохгүйг НЭГ дор жагсаана.
  const itemCodes = [...new Set(plan.lines.map((line) => line.itemCode))];
  const warehouseCodes = [...new Set(plan.lines.map((line) => line.warehouseCode))];
  const [items, whs] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: and(eq(inventoryItems.organizationId, orgId), inArray(inventoryItems.code, itemCodes)),
      columns: { id: true, code: true, name: true, isActive: true },
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.organizationId, orgId), inArray(warehouses.code, warehouseCodes)),
      columns: { id: true, code: true, isActive: true },
    }),
  ]);
  const itemByCode = new Map(items.filter((item) => item.isActive).map((item) => [item.code, item]));
  const whByCode = new Map(whs.filter((wh) => wh.isActive).map((wh) => [wh.code, wh]));
  const missing: string[] = [];
  for (const line of plan.lines) {
    if (!itemByCode.has(line.itemCode)) missing.push(`${line.row}-р мөр: бараа «${line.itemCode}» олдсонгүй (идэвхтэй)`);
    if (!whByCode.has(line.warehouseCode))
      missing.push(`${line.row}-р мөр: агуулах «${line.warehouseCode}» олдсонгүй (идэвхтэй)`);
  }
  if (missing.length > 0) throw new Error(`[ITEM_NOT_FOUND] ${missing.slice(0, 20).join("; ")}`);

  const dateProblem = openingStockDateProblem(date, await firstOtherMovementDate(db, orgId));
  if (dateProblem) throw new Error(dateProblem);
  await assertPeriodOpen(orgId, date);

  // Дансууд бичих МӨЧИД — тохиргооноос (JPR-006); Cr нь D-OS-1.
  const roles = await loadCostingAccountSettings(orgId, userId);
  const buildCode = await costingPostingCodeBuilder(orgId);
  const accountsByItem = new Map<string, string>();
  const checked = new Set<string>([counterAccount]);
  for (const line of plan.lines) {
    const item = itemByCode.get(line.itemCode)!;
    if (accountsByItem.has(item.id)) continue;
    const accounts = await itemAccountsFor(orgId, userId, item.id);
    const { debit } = entryPostingAccounts(
      "receipt_capitalize",
      { inventoryAccountNumber: accounts.inventoryAccountNumber, issueDebitAccountNumber: accounts.cogsAccountNumber },
      {
        clearing: roles.clearingAccountNumber,
        adjustmentGain: roles.adjustmentGainAccountNumber,
        adjustmentLoss: roles.adjustmentLossAccountNumber,
        nrvExpense: roles.nrvExpenseAccountNumber,
        nrvReserve: roles.nrvReserveAccountNumber,
      }
    );
    if (debit === counterAccount)
      throw new Error(`[INVALID_INPUT] ${item.code}: нөөцийн данс ба кредит данс ижил (${debit})`);
    if (!checked.has(debit)) {
      await assertEnabledMainAccount(orgId, debit);
      checked.add(debit);
    }
    accountsByItem.set(item.id, debit);
  }

  const description = input.description?.trim() || `[ОНБ] Нээлтийн барааны үлдэгдэл ${date}`;
  const stamp = date.replace(/-/g, "");
  const batchTag = batchId.slice(0, 6).toUpperCase();
  const status = input.post ? "posted" : "draft";

  const result = await db.transaction(async (tx) => {
    // Түгжээ: период (5, shared) → бараа (1) → өртгийн run (2) — guard.ts дараалал.
    await assertPeriodOpenInTx(tx, orgId, date);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 1)`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 2)`);
    // D-OS-2-г түгжээний ДОТОР дахин — зэрэгцээ хөдөлгөөн орсон байж болно.
    const raced = openingStockDateProblem(date, await firstOtherMovementDate(tx, orgId));
    if (raced) throw new Error(raced);

    let voucher: { id: string; documentNo: string | null } | null = null;
    if (input.post) {
      [voucher] = await tx
        .insert(journalVouchers)
        .values({
          userId,
          organizationId: orgId,
          date,
          description,
          documentNo: await nextVoucherNo(tx, orgId, "cost", date),
          status: "posted",
          externalRef: voucherRefOf(input.externalRef, batchId),
        })
        .returning({ id: journalVouchers.id, documentNo: journalVouchers.documentNo });
    }

    let sortOrder = 0;
    for (const line of plan.lines) {
      const item = itemByCode.get(line.itemCode)!;
      const wh = whByCode.get(line.warehouseCode)!;
      const debit = accountsByItem.get(item.id)!;
      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          userId,
          organizationId: orgId,
          documentNo: `ONB-${stamp}-${batchTag}-${String(line.row).padStart(3, "0")}`,
          movementType: "receipt",
          date,
          itemId: item.id,
          warehouseId: wh.id,
          toWarehouseId: null,
          quantity: String(line.quantity),
          description: `[ОНБ] Нээлтийн үлдэгдэл — ${item.name}`,
          status: "confirmed",
          confirmedAt: new Date(),
          sourceType: OPENING_STOCK_SOURCE_TYPE,
          sourceId: batchId,
        })
        .returning({ id: inventoryMovements.id, documentNo: inventoryMovements.documentNo });

      const [entry] = await tx
        .insert(costEntries)
        .values({
          userId,
          organizationId: orgId,
          movementId: movement.id,
          itemId: item.id,
          warehouseId: wh.id,
          periodCode: date.slice(0, 7),
          entryType: "receipt_capitalize",
          date,
          quantity: String(line.quantity),
          unitCost: String(line.unitCost),
          amount: String(line.amount),
          valuationSource: OPENING_VALUATION_SOURCE,
          debitAccountNumber: debit,
          creditAccountNumber: counterAccount,
          status,
          postedAt: input.post ? new Date() : null,
          voucherId: voucher?.id ?? null,
        })
        .returning({ id: costEntries.id });

      if (voucher) {
        const lineDescription = `[${movement.documentNo}] ${item.name} — ${line.quantity} × ${line.unitCost}`;
        await tx.insert(journalLines).values([
          {
            voucherId: voucher.id,
            costEntryId: entry.id,
            inventoryMovementId: movement.id,
            accountNumber: buildCode(debit),
            debit: String(line.amount),
            credit: "0",
            description: lineDescription,
            sortOrder: sortOrder++,
          },
          {
            voucherId: voucher.id,
            costEntryId: entry.id,
            inventoryMovementId: movement.id,
            accountNumber: buildCode(counterAccount),
            debit: "0",
            credit: String(line.amount),
            description: lineDescription,
            sortOrder: sortOrder++,
          },
        ]);
      }
    }

    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: input.post ? "post" : "create",
        entityType: "inventory",
        entityId: batchId,
        summary: `Нээлтийн барааны үлдэгдэл ${date} — ${plan.lines.length} мөр, ${plan.totalAmount.toLocaleString("en-US")}₮, Cr ${counterAccount}${voucher?.documentNo ? `, ${voucher.documentNo}` : " (ноорог)"}`,
      },
      tx
    );
    return voucher;
  });

  for (const path of ["/inventory", "/inventory/movements", "/costing", "/costing/entries", "/gl/journal"])
    revalidatePath(path);

  return {
    batchId,
    created: plan.lines.length,
    totalAmount: plan.totalAmount,
    status,
    voucherId: result?.id ?? null,
    voucherNo: result?.documentNo ?? null,
    counterAccount,
    dedup: false,
  };
}

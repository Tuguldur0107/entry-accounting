"use server";

// Урьдчилгаа (docs/dev/arap.md §5l): дансны роль, харилцагчийн үлдэгдэл,
// нэхэмжлэхтэй суутгах. Урьдчилгааг БҮРТГЭХ нь кассын баримт / банкны хуулгын
// мөр (lib/cash/import-statement.ts); энд зөвхөн тохиргоо ба суутгал.
// Суутгалын буцаалт = reverseArApOffset (voucherId) — суутгалын мөр хамт устна.
// Бүгд ActionResult (алдааг шидэхгүй).

import { and, eq, inArray, sql } from "drizzle-orm";

import { actionError, type ActionResult } from "@/lib/action-result";
import {
  advanceAccountFor,
  advanceSideOf,
  loadAdvanceBalances,
  loadAdvanceSettings,
  resolveAdvanceApplyAmount,
  type AdvanceSettings,
  type CounterpartyAdvanceBalance,
} from "@/lib/arap/advances";
import { arapLedger } from "@/lib/arap/document-kind";
import { logAuditEvent } from "@/lib/audit";
import { getActiveOrg, requireAnyModuleAction, requireModuleAction, requireRole } from "@/lib/auth";
import { assertEnabledMainAccount } from "@/lib/costing/posting-helpers";
import { db } from "@/lib/db";
import {
  arApDocuments,
  arApSettlements,
  arapAdvanceApplications,
  arapAdvanceSettings,
  counterparties,
  journalLines,
  journalVouchers,
} from "@/lib/db/schema";
import { nextVoucherNo } from "@/lib/gl/voucher-no";
import { revalidatePathSafe } from "@/lib/next/revalidate";
import { assertCalendarDate } from "@/lib/periods/document-date";
import { assertNotFuturePeriod, assertPeriodOpen, assertPeriodOpenInTx } from "@/lib/periods/guard";

function revalidateAdvances() {
  for (const root of ["/receivables", "/payables"]) {
    revalidatePathSafe(`${root}/documents`);
    revalidatePathSafe(`${root}/reports`);
  }
  revalidatePathSafe("/cash/statements");
  revalidatePathSafe("/gl/journal");
  revalidatePathSafe("/gl/reports");
}

const READ_CHECKS: [string, "read"][] = [
  ["ar", "read"],
  ["ap", "read"],
  ["cash", "read"],
];

export async function getAdvanceSettings(): Promise<ActionResult<{ settings: AdvanceSettings }>> {
  try {
    const { orgId } = await requireAnyModuleAction(READ_CHECKS);
    const settings = await loadAdvanceSettings(orgId);
    return {
      settings: {
        customerAdvanceAccountNumber: settings.customerAdvanceAccountNumber,
        supplierAdvanceAccountNumber: settings.supplierAdvanceAccountNumber,
      },
    };
  } catch (caught) {
    return actionError("getAdvanceSettings", caught, "Урьдчилгааны тохиргоог уншиж чадсангүй");
  }
}

/** Дансны роль солих — admin+; хоёр данс ялгаатай, идэвхтэй GL данс. */
export async function saveAdvanceSettings(input: {
  customerAdvanceAccountNumber: string;
  supplierAdvanceAccountNumber: string;
}): Promise<ActionResult<{ settings: AdvanceSettings }>> {
  try {
    const { orgId, userId } = await requireRole("admin");
    // Бүтэн 10-part сегмент код ирж болно — үндсэн (8 оронтой) дансыг авна.
    const mainOf = (value: string | null | undefined) => {
      const text = (value ?? "").trim();
      const parts = text.split(".");
      return parts.length === 10 ? parts[2] : text;
    };
    const customer = mainOf(input.customerAdvanceAccountNumber);
    const supplier = mainOf(input.supplierAdvanceAccountNumber);
    if (!/^\d{8}$/.test(customer) || !/^\d{8}$/.test(supplier))
      throw new Error("Урьдчилгааны данс 8 оронтой GL данс байна");
    if (customer === supplier)
      throw new Error("Урьдчилж орсон орлого ба урьдчилж төлсөн зардлын данс өөр байх ёстой");
    await assertEnabledMainAccount(orgId, customer);
    await assertEnabledMainAccount(orgId, supplier);
    const previous = await loadAdvanceSettings(orgId);
    await db
      .update(arapAdvanceSettings)
      .set({
        customerAdvanceAccountNumber: customer,
        supplierAdvanceAccountNumber: supplier,
        updatedAt: new Date(),
      })
      .where(eq(arapAdvanceSettings.organizationId, orgId));
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "advance_accounts",
      entityType: "settings",
      entityId: "arap_advance",
      summary: `Урьдчилгааны данс: орсон орлого ${previous.customerAdvanceAccountNumber} → ${customer}, төлсөн ${previous.supplierAdvanceAccountNumber} → ${supplier}`,
    });
    revalidateAdvances();
    return {
      settings: { customerAdvanceAccountNumber: customer, supplierAdvanceAccountNumber: supplier },
    };
  } catch (caught) {
    return actionError("saveAdvanceSettings", caught, "Урьдчилгааны тохиргоо хадгалагдсангүй");
  }
}

/** Харилцагчдын урьдчилгааны үлдэгдэл (MNT). */
export async function listAdvanceBalances(input: { counterpartyId?: string } = {}): Promise<
  ActionResult<{ balances: CounterpartyAdvanceBalance[]; settings: AdvanceSettings }>
> {
  try {
    const { orgId } = await requireAnyModuleAction(READ_CHECKS);
    const settings = await loadAdvanceSettings(orgId);
    const balances = await loadAdvanceBalances(orgId, {
      counterpartyId: input.counterpartyId || undefined,
      settings,
    });
    return {
      balances,
      settings: {
        customerAdvanceAccountNumber: settings.customerAdvanceAccountNumber,
        supplierAdvanceAccountNumber: settings.supplierAdvanceAccountNumber,
      },
    };
  } catch (caught) {
    return actionError("listAdvanceBalances", caught, "Урьдчилгааны үлдэгдлийг уншиж чадсангүй");
  }
}

/**
 * Нэхэмжлэхийн нээлттэй үлдэгдлийг тухайн харилцагчийн урьдчилгаагаар хаана:
 *   АР: Dr урьдчилж орсон орлого / Cr авлагын хяналтын данс
 *   АП: Dr өглөгийн хяналтын данс / Cr урьдчилж төлсөн
 * + ar_ap_settlements (кассгүй, voucherId) + arap_advance_applications.
 * Зөвхөн MNT; дүн урьдчилгаа ба нэхэмжлэхийн үлдэгдлээс хэтрэхгүй (транзакц
 * дотор харилцагчаар түгжиж дахин шалгана).
 */
export async function applyAdvanceToInvoice(input: {
  documentId: string;
  amount?: number | null;
  date: string;
}): Promise<ActionResult<{ voucherId: string; amount: number }>> {
  try {
    return await applyAdvanceCore(input);
  } catch (caught) {
    return actionError("applyAdvanceToInvoice", caught, "Урьдчилгааг суутгаж чадсангүй");
  }
}

async function applyAdvanceCore(input: {
  documentId: string;
  amount?: number | null;
  date: string;
}): Promise<{ voucherId: string; amount: number }> {
  const active = await getActiveOrg();
  const document = await db.query.arApDocuments.findFirst({
    where: and(
      eq(arApDocuments.id, (input.documentId ?? "").trim()),
      eq(arApDocuments.organizationId, active.orgId)
    ),
  });
  if (!document) throw new Error("Нэхэмжлэх олдсонгүй");
  const side = advanceSideOf(document.documentType);
  if (!side)
    throw new Error("Урьдчилгааг зөвхөн борлуулалтын / худалдан авалтын нэхэмжлэхтэй суутгана");
  const ledger = arapLedger(document.documentType);
  const { orgId, userId } = await requireModuleAction(ledger, "post");
  if (document.status !== "posted" && document.status !== "partially_paid")
    throw new Error(`${document.documentNo} төлбөр хүлээх төлөвт биш байна`);
  if (document.currency !== "MNT")
    throw new Error("Урьдчилгааны суутгал одоогоор зөвхөн MNT нэхэмжлэхэд");
  assertCalendarDate(input.date, "Суутгах огноо");
  if (input.date < document.date)
    throw new Error("Суутгах огноо нэхэмжлэхийн огнооноос өмнө байж болохгүй");
  await assertPeriodOpen(orgId, input.date);
  assertNotFuturePeriod(input.date);

  const counterparty = await db.query.counterparties.findFirst({
    where: and(eq(counterparties.id, document.counterpartyId), eq(counterparties.organizationId, orgId)),
    columns: { id: true, name: true },
  });
  if (!counterparty) throw new Error("Харилцагч олдсонгүй");
  const settings = await loadAdvanceSettings(orgId);
  const advanceAccount = advanceAccountFor(settings, side);
  await assertEnabledMainAccount(orgId, advanceAccount);

  let applied = 0;
  let voucherId = "";
  await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, input.date);
    // Нэг харилцагчийн урьдчилгааг зэрэг суутгаж хэтрүүлэхээс сэргийлнэ.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`arap-advance:${orgId}:${counterparty.id}`}))`
    );
    const [balance] = await loadAdvanceBalances(orgId, {
      counterpartyId: counterparty.id,
      side,
      settings,
      executor: tx,
    });
    const [fresh] = await tx
      .select({ totalAmount: arApDocuments.totalAmount, paidAmount: arApDocuments.paidAmount })
      .from(arApDocuments)
      .where(eq(arApDocuments.id, document.id));
    const resolved = resolveAdvanceApplyAmount({
      requested: input.amount ?? null,
      advanceBalance: balance?.balance ?? 0,
      invoiceBalance:
        Math.round((Number(fresh.totalAmount) - Number(fresh.paidAmount)) * 100) / 100,
    });
    if ("error" in resolved) throw new Error(resolved.error);
    applied = resolved.amount;
    const amountText = applied.toFixed(2);

    const [updated] = await tx
      .update(arApDocuments)
      .set({
        paidAmount: sql`${arApDocuments.paidAmount} + ${amountText}`,
        basePaidAmount: sql`COALESCE(${arApDocuments.basePaidAmount}, ${arApDocuments.paidAmount}) + ${amountText}`,
        status: sql`CASE WHEN ${arApDocuments.paidAmount} + ${amountText} >= ${arApDocuments.totalAmount} - 0.005 THEN 'paid' ELSE 'partially_paid' END`,
      })
      .where(
        and(
          eq(arApDocuments.id, document.id),
          inArray(arApDocuments.status, ["posted", "partially_paid"]),
          sql`${arApDocuments.totalAmount} - ${arApDocuments.paidAmount} >= ${amountText} - 0.005`
        )
      )
      .returning({ id: arApDocuments.id });
    if (!updated)
      throw new Error(`${document.documentNo} — үлдэгдэл өөрчлөгдсөн байна, дахин оролдоно уу`);

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: input.date,
        description: `Урьдчилгаа суутгав [${document.documentNo}] ${counterparty.name}`,
        documentNo: await nextVoucherNo(tx, orgId, ledger, input.date),
        status: "posted",
      })
      .returning({ id: journalVouchers.id });
    voucherId = voucher.id;
    const description = `Урьдчилгаа суутгав — ${document.documentNo}`;
    const debitAccount = side === "customer" ? advanceAccount : document.controlAccountNumber;
    const creditAccount = side === "customer" ? document.controlAccountNumber : advanceAccount;
    await tx.insert(journalLines).values([
      { voucherId: voucher.id, accountNumber: debitAccount, debit: amountText, credit: "0", description, sortOrder: 0 },
      { voucherId: voucher.id, accountNumber: creditAccount, debit: "0", credit: amountText, description, sortOrder: 1 },
    ]);
    await tx.insert(arApSettlements).values({
      userId,
      organizationId: orgId,
      documentId: document.id,
      cashDocumentId: null,
      voucherId: voucher.id,
      settlementDate: input.date,
      amount: amountText,
      baseAmount: amountText,
    });
    await tx.insert(arapAdvanceApplications).values({
      userId,
      organizationId: orgId,
      counterpartyId: counterparty.id,
      side,
      advanceAccountNumber: advanceAccount,
      documentId: document.id,
      voucherId: voucher.id,
      date: input.date,
      amount: amountText,
    });
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "advance_apply",
        entityType: "arap",
        entityId: document.id,
        summary: `Урьдчилгаа суутгав — ${document.documentNo}, ${counterparty.name}, ${applied.toLocaleString("en-US")} ₮ (${advanceAccount})`,
      },
      tx
    );
  });
  revalidateAdvances();
  return { voucherId, amount: applied };
}

"use server";

// Авлагын ECL нөөц (IFRS 9) ба найдваргүй авлага хасах — ENT-065.
// Шийдвэр D-ECL-1…4: lib/arap/ecl.ts, docs/cost README 1.2.
//
// ⚠️ Энэ файл ЗӨВХӨН async функц export хийнэ (төрөл lib/arap/ecl*.ts-д).

import { revalidatePath } from "next/cache";
import { and, eq, inArray, like, ne, sql } from "drizzle-orm";

import { actionError, type ActionResult } from "@/lib/action-result";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  arApDocuments,
  arApSettlements,
  arapEclSettings,
  arapWriteOffRecoveries,
  arapWriteOffs,
  chartOfAccounts,
  journalLines,
  journalVouchers,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import {
  ECL_DEFERRED_TAX_OBJECT,
  ECL_PROVISION_REF_PREFIX,
  WRITE_OFF_REASON_MIN,
  eclJournalLines,
  eclMatrixProblems,
  recoveryProblem,
  splitWriteOff,
  type EclBucket,
  type EclProvisionPlan,
} from "@/lib/arap/ecl";
import {
  creditBalanceOf,
  loadEclDrafts,
  loadEclPlan,
  loadEclSettings,
  type ArapWriteOffView,
  type EclOverviewResult,
  type EclSettingsView,
} from "@/lib/arap/ecl-db";
import { moduleOfVoucherNo, nextVoucherNo } from "@/lib/gl/voucher-no";
import { assertNotFuturePeriod, assertPeriodOpen, assertPeriodOpenInTx } from "@/lib/periods/guard";
import { extractMainAccount } from "@/lib/reports/balances";
import { postingCodeBuilderFromData } from "@/lib/gl/posting-code";

const round2 = (value: number) => Math.round(value * 100) / 100;

function revalidateEcl() {
  for (const path of ["/receivables", "/receivables/documents", "/receivables/ecl", "/gl/journal", "/gl/reports"])
    revalidatePath(path);
}

function assertDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) throw new Error(`${label} буруу байна (YYYY-MM-DD)`);
}

async function assertEnabledAccount(orgId: string, account: string, label: string) {
  const main = extractMainAccount(account.trim());
  if (!/^\d{8}$/.test(main)) throw new Error(`${label}: 8 оронтой данс сонгоно уу`);
  const row = await db.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.organizationId, orgId),
      eq(chartOfAccounts.number, main),
      eq(chartOfAccounts.isEnabled, true)
    ),
    columns: { id: true },
  });
  if (!row) throw new Error(`[ACCOUNT_NOT_FOUND] ${label}: ${main} идэвхтэй данс олдсонгүй — дансны тохиргооноос нэмнэ үү`);
  return main;
}

/** АР модулийн S9 тэмдэгтэй (AR) posting код. */
async function arPostingCodeBuilder(orgId: string): Promise<(main: string) => string> {
  const [configs, values] = await Promise.all([
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.organizationId, orgId) }),
    db.query.segmentValues.findMany({
      where: and(eq(segmentValues.organizationId, orgId), eq(segmentValues.isEnabled, true)),
    }),
  ]);
  return postingCodeBuilderFromData({ configs, values, moduleTag: "AR" });
}

// ── Тохиргоо ──────────────────────────────────────────────────────────────────

export async function getEclSettings(): Promise<ActionResult<{ settings: EclSettingsView }>> {
  try {
    const { orgId } = await requireModuleAction("ar", "read");
    return { settings: await loadEclSettings(orgId) };
  } catch (caught) {
    return actionError("getEclSettings", caught, "ECL тохиргоо уншигдсангүй");
  }
}

async function saveEclSettingsCore(input: {
  allowanceAccountNumber: string;
  expenseAccountNumber: string;
  deferredTaxAssetAccountNumber: string;
  deferredTaxExpenseAccountNumber: string;
  matrix: EclBucket[];
  taxRatePct: number | null;
}) {
  const { orgId, userId } = await requireModuleAction("ar", "post");
  await requireRole("admin");
  const problems = eclMatrixProblems(input.matrix);
  if (problems.length > 0) throw new Error(`[ECL_MATRIX_INVALID] ${problems.join("; ")}`);
  const taxRate = input.taxRatePct == null || String(input.taxRatePct) === "" ? null : Number(input.taxRatePct);
  if (taxRate != null && (!Number.isFinite(taxRate) || taxRate <= 0 || taxRate >= 100))
    throw new Error("ААНОАТ-ын хувь 0–100-ийн хооронд (хоосон = DTA бодохгүй)");
  const accounts = {
    allowanceAccountNumber: await assertEnabledAccount(orgId, input.allowanceAccountNumber, "ECL нөөцийн данс"),
    expenseAccountNumber: await assertEnabledAccount(orgId, input.expenseAccountNumber, "ECL зардлын данс"),
    deferredTaxAssetAccountNumber: await assertEnabledAccount(orgId, input.deferredTaxAssetAccountNumber, "Хойшлогдсон татварын хөрөнгө"),
    deferredTaxExpenseAccountNumber: await assertEnabledAccount(orgId, input.deferredTaxExpenseAccountNumber, "Хойшлогдсон татварын зардал"),
  };
  if (accounts.allowanceAccountNumber === accounts.expenseAccountNumber)
    throw new Error("Нөөц ба зардлын данс ялгаатай байна");
  const before = await loadEclSettings(orgId);
  const matrix = input.matrix.map((row) => ({
    maxDays: row.maxDays == null ? null : Number(row.maxDays),
    ratePct: Number(row.ratePct),
  }));
  await db
    .update(arapEclSettings)
    .set({ ...accounts, matrix, taxRatePct: taxRate == null ? null : String(taxRate), updatedAt: new Date() })
    .where(eq(arapEclSettings.organizationId, orgId));
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "update",
    entityType: "settings",
    entityId: orgId,
    summary: `ECL тохиргоо: matrix ${matrix.map((row) => `${row.maxDays ?? "∞"}:${row.ratePct}%`).join(", ")} (өмнө ${before.matrix.map((row) => `${row.maxDays ?? "∞"}:${row.ratePct}%`).join(", ")}); ААНОАТ ${taxRate ?? "—"}%; нөөц ${accounts.allowanceAccountNumber}, зардал ${accounts.expenseAccountNumber}`,
  });
  revalidateEcl();
}

export async function saveEclSettings(
  input: Parameters<typeof saveEclSettingsCore>[0]
): Promise<ActionResult> {
  try {
    await saveEclSettingsCore(input);
    return {};
  } catch (caught) {
    return actionError("saveEclSettings", caught, "ECL тохиргоо хадгалагдсангүй");
  }
}

// ── ECL тооцоо (сарын нөөц) ───────────────────────────────────────────────────

async function getEclOverviewCore(asOf: string): Promise<EclOverviewResult> {
  const { orgId } = await requireModuleAction("ar", "read");
  assertDate(asOf, "Огноо");
  const settings = await loadEclSettings(orgId);
  const [plan, drafts] = await Promise.all([loadEclPlan(orgId, asOf, settings), loadEclDrafts(orgId)]);
  return { asOf, settings, plan, drafts };
}

export async function getEclOverview(asOf: string): Promise<ActionResult<EclOverviewResult>> {
  try {
    return await getEclOverviewCore(asOf);
  } catch (caught) {
    return actionError("getEclOverview", caught, "ECL тооцоо уншигдсангүй");
  }
}

/**
 * Сарын ECL журнал — ЗААВАЛ НООРОГ (§9). Өмнөх ноорог ECL журнал солигдоно
 * (дахин ажиллуулах нь идемпотент); батлагдсаны дараа delta нь тэр дүнг хасна.
 */
async function runEclProvisionCore(input: { asOf: string }): Promise<{
  voucherId: string | null;
  documentNo: string | null;
  plan: EclProvisionPlan;
  replacedDrafts: number;
}> {
  const { orgId, userId } = await requireModuleAction("ar", "write");
  assertDate(input.asOf, "Огноо");
  await assertPeriodOpen(orgId, input.asOf);
  const settings = await loadEclSettings(orgId);
  const accounts = {
    allowance: await assertEnabledAccount(orgId, settings.allowanceAccountNumber, "ECL нөөцийн данс"),
    expense: await assertEnabledAccount(orgId, settings.expenseAccountNumber, "ECL зардлын данс"),
    deferredTaxAsset: settings.taxRatePct == null
      ? settings.deferredTaxAssetAccountNumber
      : await assertEnabledAccount(orgId, settings.deferredTaxAssetAccountNumber, "Хойшлогдсон татварын хөрөнгө"),
    deferredTaxExpense: settings.taxRatePct == null
      ? settings.deferredTaxExpenseAccountNumber
      : await assertEnabledAccount(orgId, settings.deferredTaxExpenseAccountNumber, "Хойшлогдсон татварын зардал"),
  };
  const buildCode = await arPostingCodeBuilder(orgId);

  return await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, input.asOf);
    // Өмнөх НООРОГ ECL журналууд (бүх огноо) — нэг л ноорог байна. Ижил
    // жилийнхийг ДУГААРТАЙ нь дахин ашиглана (устгаад шинээр авбал журналын
    // дугаарлалтад цоорхой гарна — sim ENT-065); бусдыг устгана.
    const staleDrafts = await tx
      .select({ id: journalVouchers.id, documentNo: journalVouchers.documentNo, date: journalVouchers.date })
      .from(journalVouchers)
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          eq(journalVouchers.status, "draft"),
          like(journalVouchers.externalRef, `${ECL_PROVISION_REF_PREFIX}%`)
        )
      );
    const plan = await loadEclPlan(orgId, input.asOf, settings);
    const lines = eclJournalLines(plan, input.asOf);
    const reuse =
      lines.length > 0
        ? staleDrafts.find((row) => row.documentNo && row.date.slice(0, 4) === input.asOf.slice(0, 4))
        : undefined;
    const dropIds = staleDrafts.filter((row) => row.id !== reuse?.id).map((row) => row.id);
    if (staleDrafts.length > 0)
      await tx.delete(journalLines).where(inArray(journalLines.voucherId, staleDrafts.map((row) => row.id)));
    if (dropIds.length > 0) await tx.delete(journalVouchers).where(inArray(journalVouchers.id, dropIds));
    if (lines.length === 0)
      return { voucherId: null, documentNo: null, plan, replacedDrafts: staleDrafts.length };

    // Ижил огноонд батлагдсан ECL журнал байвал ref-ийг дугаарлана (unique).
    const [{ count }] = await tx
      .select({ count: sql<string>`count(*)` })
      .from(journalVouchers)
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          like(journalVouchers.externalRef, `${ECL_PROVISION_REF_PREFIX}${input.asOf}%`),
          reuse ? ne(journalVouchers.id, reuse.id) : undefined
        )
      );
    const externalRef =
      Number(count) === 0
        ? `${ECL_PROVISION_REF_PREFIX}${input.asOf}`
        : `${ECL_PROVISION_REF_PREFIX}${input.asOf}#${Number(count) + 1}`;
    const taxNote = settings.taxRatePct == null ? " (ААНОАТ-ын хувь тохируулаагүй — хойшлогдсон татвар бодогдоогүй)" : "";
    const header = {
      date: input.asOf,
      description: `Авлагын ECL нөөц (IFRS 9) ${input.asOf} — шаардлагатай ${plan.requiredAllowance.toLocaleString("en-US")}₮${taxNote}`,
      externalRef,
    };
    const documentNo = reuse?.documentNo ?? (await nextVoucherNo(tx, orgId, "ar", input.asOf));
    const [voucher] = reuse
      ? await tx
          .update(journalVouchers)
          .set(header)
          .where(eq(journalVouchers.id, reuse.id))
          .returning({ id: journalVouchers.id })
      : await tx
          .insert(journalVouchers)
          .values({ userId, organizationId: orgId, documentNo, status: "draft", ...header })
          .returning({ id: journalVouchers.id });
    await tx.insert(journalLines).values(
      lines.map((line, index) => {
        const isTax = line.role === "deferredTaxAsset" || line.role === "deferredTaxExpense";
        return {
          voucherId: voucher.id,
          accountNumber: buildCode(accounts[line.role]),
          debit: String(line.debit),
          credit: String(line.credit),
          description: line.description,
          sortOrder: index,
          // DTA данс бусад түр зөрүүтэй хуваалцдаг — ECL-ийнхийг тэмдгээр ялгана.
          ...(isTax && line.role === "deferredTaxAsset"
            ? { businessObjectType: ECL_DEFERRED_TAX_OBJECT, businessObjectId: orgId }
            : {}),
        };
      })
    );
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "create",
        entityType: "journal",
        entityId: voucher.id,
        summary: `ECL нөөцийн ноорог журнал ${documentNo} — ${input.asOf}, delta ${plan.allowanceDelta.toLocaleString("en-US")}₮${plan.deferredTax ? `, DTA ${plan.deferredTax.delta.toLocaleString("en-US")}₮` : ""}`,
      },
      tx
    );
    return { voucherId: voucher.id, documentNo, plan, replacedDrafts: staleDrafts.length };
  }).finally(revalidateEcl);
}

export async function runEclProvision(input: {
  asOf: string;
}): Promise<ActionResult<Awaited<ReturnType<typeof runEclProvisionCore>>>> {
  try {
    return await runEclProvisionCore(input);
  } catch (caught) {
    return actionError("runEclProvision", caught, "ECL журнал үүсгэгдсэнгүй");
  }
}

// ── Найдваргүй авлага хасах ───────────────────────────────────────────────────

async function writeOffArApDocumentCore(input: {
  documentId: string;
  date: string;
  /** Баримтын валютаар; хоосон бол нээлттэй үлдэгдэл бүхэлдээ. */
  amount?: number | null;
  reason: string;
}): Promise<{ writeOffId: string; voucherId: string; documentNo: string; baseAmount: number; fromAllowance: number; toExpense: number }> {
  const { orgId, userId } = await requireModuleAction("ar", "post");
  assertDate(input.date, "Огноо");
  const reason = (input.reason ?? "").trim();
  if (reason.length < WRITE_OFF_REASON_MIN)
    throw new Error(`[REASON_REQUIRED] Хасах шалтгааныг бичнэ үү (${WRITE_OFF_REASON_MIN}+ тэмдэгт) — аудитад хадгалагдана`);
  const doc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, input.documentId), eq(arApDocuments.organizationId, orgId)),
  });
  if (!doc) throw new Error("Нэхэмжлэх олдсонгүй");
  if (doc.documentType !== "ar_invoice")
    throw new Error("[WRITE_OFF_AR_ONLY] Зөвхөн авлагын нэхэмжлэхийг найдваргүй болгож хасна");
  if (!["posted", "partially_paid"].includes(doc.status))
    throw new Error(`${doc.documentNo} нээлттэй үлдэгдэлгүй (төлөв ${doc.status})`);
  if (input.date < doc.date) throw new Error(`Хасах огноо нэхэмжлэхийн огноо (${doc.date})-оос өмнө байж болохгүй`);
  assertNotFuturePeriod(input.date);
  await assertPeriodOpen(orgId, input.date);

  const open = round2(Number(doc.totalAmount) - Number(doc.paidAmount));
  const baseOpen = round2(Number(doc.baseTotalAmount) - Number(doc.basePaidAmount));
  const amount = input.amount == null ? open : round2(Number(input.amount));
  if (!(amount > 0)) throw new Error("Хасах дүн 0-ээс их байна");
  if (amount > open + 0.005)
    throw new Error(`Хасах дүн нээлттэй үлдэгдлээс (${open.toLocaleString("en-US")} ${doc.currency}) их байна`);
  const full = Math.abs(amount - open) <= 0.005;
  const baseAmount = full ? baseOpen : Math.min(baseOpen, round2(amount * Number(doc.exchangeRate)));
  if (!(baseAmount > 0)) throw new Error("Хасах ₮ дүн 0 байна");

  const settings = await loadEclSettings(orgId);
  const allowance = await assertEnabledAccount(orgId, settings.allowanceAccountNumber, "ECL нөөцийн данс");
  const expense = await assertEnabledAccount(orgId, settings.expenseAccountNumber, "ECL зардлын данс");
  const buildCode = await arPostingCodeBuilder(orgId);
  const amountText = String(amount);

  const result = await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, input.date);
    const allowanceBalance = await creditBalanceOf(tx, orgId, allowance, input.date);
    const split = splitWriteOff(baseAmount, allowanceBalance);

    // Үлдэгдлийг атом хаана — зэрэгцээ төлбөртэй уралдвал бүхэлдээ буцна.
    const [updated] = await tx
      .update(arApDocuments)
      .set({
        paidAmount: sql`${arApDocuments.paidAmount} + ${amountText}`,
        basePaidAmount: sql`${arApDocuments.basePaidAmount} + ${String(baseAmount)}`,
        status: sql`CASE WHEN ${arApDocuments.paidAmount} + ${amountText} >= ${arApDocuments.totalAmount} - 0.005 THEN 'paid' ELSE 'partially_paid' END`,
      })
      .where(
        and(
          eq(arApDocuments.id, doc.id),
          eq(arApDocuments.organizationId, orgId),
          inArray(arApDocuments.status, ["posted", "partially_paid"]),
          sql`${arApDocuments.totalAmount} - ${arApDocuments.paidAmount} >= ${amountText} - 0.005`
        )
      )
      .returning({ id: arApDocuments.id });
    if (!updated) throw new Error(`${doc.documentNo} — үлдэгдэл өөрчлөгдсөн байна, дахин оролдоно уу`);

    const documentNo = await nextVoucherNo(tx, orgId, "ar", input.date);
    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: input.date,
        description: `Найдваргүй авлага хасалт [${doc.documentNo}] — ${reason}`,
        documentNo,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });
    const text = `Найдваргүй авлага хасалт — ${doc.documentNo}`;
    const lines = [];
    if (split.fromAllowance > 0)
      lines.push({ accountNumber: buildCode(allowance), debit: String(split.fromAllowance), credit: "0", description: `${text} (ECL нөөцөөс)` });
    if (split.toExpense > 0)
      lines.push({ accountNumber: buildCode(expense), debit: String(split.toExpense), credit: "0", description: `${text} (нөөц хүрэлцээгүй хэсэг)` });
    lines.push({ accountNumber: doc.controlAccountNumber, debit: "0", credit: String(baseAmount), description: text });
    await tx.insert(journalLines).values(lines.map((line, index) => ({ voucherId: voucher.id, sortOrder: index, ...line })));

    const [settlement] = await tx
      .insert(arApSettlements)
      .values({
        userId,
        organizationId: orgId,
        documentId: doc.id,
        cashDocumentId: null,
        voucherId: voucher.id,
        settlementDate: input.date,
        amount: amountText,
        baseAmount: String(baseAmount),
      })
      .returning({ id: arApSettlements.id });
    const [writeOff] = await tx
      .insert(arapWriteOffs)
      .values({
        userId,
        organizationId: orgId,
        documentId: doc.id,
        settlementId: settlement.id,
        voucherId: voucher.id,
        date: input.date,
        amount: amountText,
        baseAmount: String(baseAmount),
        allowanceAmount: String(split.fromAllowance),
        expenseAmount: String(split.toExpense),
        reason,
      })
      .returning({ id: arapWriteOffs.id });
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "write_off",
        entityType: "arap",
        entityId: doc.id,
        summary: `Найдваргүй авлага хасалт — ${doc.documentNo}, ${input.date}, ${baseAmount.toLocaleString("en-US")}₮ (нөөцөөс ${split.fromAllowance.toLocaleString("en-US")}, зардалд ${split.toExpense.toLocaleString("en-US")}); журнал ${documentNo}; шалтгаан: ${reason}`,
      },
      tx
    );
    return { writeOffId: writeOff.id, voucherId: voucher.id, documentNo, baseAmount, ...split };
  });
  revalidateEcl();
  return result;
}

export async function writeOffArApDocument(
  input: Parameters<typeof writeOffArApDocumentCore>[0]
): Promise<ActionResult<Awaited<ReturnType<typeof writeOffArApDocumentCore>>>> {
  try {
    return await writeOffArApDocumentCore(input);
  } catch (caught) {
    return actionError("writeOffArApDocument", caught, "Авлага хасагдсангүй");
  }
}

async function loadActiveWriteOff(orgId: string, writeOffId: string) {
  const writeOff = await db.query.arapWriteOffs.findFirst({
    where: and(eq(arapWriteOffs.id, writeOffId), eq(arapWriteOffs.organizationId, orgId)),
  });
  if (!writeOff) throw new Error("Хасалт олдсонгүй");
  if (writeOff.status !== "active") throw new Error("Хасалт аль хэдийн буцаагдсан байна");
  const doc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, writeOff.documentId), eq(arApDocuments.organizationId, orgId)),
  });
  if (!doc) throw new Error("Нэхэмжлэх олдсонгүй");
  return { writeOff, doc };
}

/** Хассан авлагын сэргэлт (D-ECL-4): Dr авлага / Cr ECL зардал, үлдэгдэл дахин нээгдэнэ. */
async function recoverArApWriteOffCore(input: {
  writeOffId: string;
  date: string;
  /** Баримтын валютаар; хоосон бол хассан дүнгийн үлдэгдэл бүхэлдээ. */
  amount?: number | null;
}): Promise<{ voucherId: string; documentNo: string; baseAmount: number }> {
  const { orgId, userId } = await requireModuleAction("ar", "post");
  assertDate(input.date, "Огноо");
  const { writeOff, doc } = await loadActiveWriteOff(orgId, input.writeOffId);
  if (input.date < writeOff.date) throw new Error(`Сэргэлтийн огноо хасалтын огноо (${writeOff.date})-оос өмнө байж болохгүй`);
  assertNotFuturePeriod(input.date);
  await assertPeriodOpen(orgId, input.date);
  const written = Number(writeOff.amount);
  const recovered = Number(writeOff.recoveredAmount);
  const amount = input.amount == null ? round2(written - recovered) : round2(Number(input.amount));
  const problem = recoveryProblem(amount, written, recovered);
  if (problem) throw new Error(problem);
  const remainingBase = round2(Number(writeOff.baseAmount) - Number(writeOff.recoveredBaseAmount));
  const baseAmount =
    Math.abs(amount - round2(written - recovered)) <= 0.005
      ? remainingBase
      : Math.min(remainingBase, round2((Number(writeOff.baseAmount) * amount) / written));
  const settings = await loadEclSettings(orgId);
  const expense = await assertEnabledAccount(orgId, settings.expenseAccountNumber, "ECL зардлын данс");
  const buildCode = await arPostingCodeBuilder(orgId);
  const amountText = String(amount);
  const baseText = String(baseAmount);

  const result = await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, input.date);
    const [claimed] = await tx
      .update(arapWriteOffs)
      .set({
        recoveredAmount: sql`${arapWriteOffs.recoveredAmount} + ${amountText}`,
        recoveredBaseAmount: sql`${arapWriteOffs.recoveredBaseAmount} + ${baseText}`,
      })
      .where(
        and(
          eq(arapWriteOffs.id, writeOff.id),
          eq(arapWriteOffs.status, "active"),
          sql`${arapWriteOffs.amount} - ${arapWriteOffs.recoveredAmount} >= ${amountText} - 0.005`
        )
      )
      .returning({ id: arapWriteOffs.id });
    if (!claimed) throw new Error("Хасалтын үлдэгдэл өөрчлөгдсөн байна, дахин оролдоно уу");

    // Нэхэмжлэхийн үлдэгдэл дахин нээгдэнэ → ердийн кассын орлогоор хаагдана.
    await tx
      .update(arApDocuments)
      .set({
        paidAmount: sql`GREATEST(${arApDocuments.paidAmount} - ${amountText}, 0)`,
        basePaidAmount: sql`GREATEST(${arApDocuments.basePaidAmount} - ${baseText}, 0)`,
        status: sql`CASE WHEN ${arApDocuments.paidAmount} - ${amountText} <= 0.005 THEN 'posted' ELSE 'partially_paid' END`,
      })
      .where(and(eq(arApDocuments.id, doc.id), eq(arApDocuments.organizationId, orgId)));
    if (writeOff.settlementId) {
      const [settlement] = await tx
        .update(arApSettlements)
        .set({
          amount: sql`${arApSettlements.amount} - ${amountText}`,
          baseAmount: sql`${arApSettlements.baseAmount} - ${baseText}`,
        })
        .where(eq(arApSettlements.id, writeOff.settlementId))
        .returning({ amount: arApSettlements.amount });
      if (settlement && Number(settlement.amount) <= 0.005) {
        await tx.update(arapWriteOffs).set({ settlementId: null }).where(eq(arapWriteOffs.id, writeOff.id));
        await tx.delete(arApSettlements).where(eq(arApSettlements.id, writeOff.settlementId));
      }
    }

    const documentNo = await nextVoucherNo(tx, orgId, "ar", input.date);
    const text = `Хассан авлагын сэргэлт — ${doc.documentNo}`;
    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: input.date,
        description: `${text} (ECL зардал бууруулна)`,
        documentNo,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });
    await tx.insert(journalLines).values([
      { voucherId: voucher.id, accountNumber: doc.controlAccountNumber, debit: baseText, credit: "0", description: text, sortOrder: 0 },
      { voucherId: voucher.id, accountNumber: buildCode(expense), debit: "0", credit: baseText, description: text, sortOrder: 1 },
    ]);
    await tx.insert(arapWriteOffRecoveries).values({
      userId,
      organizationId: orgId,
      writeOffId: writeOff.id,
      voucherId: voucher.id,
      date: input.date,
      amount: amountText,
      baseAmount: baseText,
    });
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "write_off_recovery",
        entityType: "arap",
        entityId: doc.id,
        summary: `Хассан авлагын сэргэлт — ${doc.documentNo}, ${input.date}, ${baseAmount.toLocaleString("en-US")}₮; журнал ${documentNo}`,
      },
      tx
    );
    return { voucherId: voucher.id, documentNo, baseAmount };
  });
  revalidateEcl();
  return result;
}

export async function recoverArApWriteOff(
  input: Parameters<typeof recoverArApWriteOffCore>[0]
): Promise<ActionResult<Awaited<ReturnType<typeof recoverArApWriteOffCore>>>> {
  try {
    return await recoverArApWriteOffCore(input);
  } catch (caught) {
    return actionError("recoverArApWriteOff", caught, "Сэргэлт бүртгэгдсэнгүй");
  }
}

/** Алдаатай хасалтыг ЭХ огноогоор буцаана — сэргэлтгүй үед л. */
async function reverseArApWriteOffCore(writeOffId: string): Promise<{ reversalVoucherId: string }> {
  const { orgId, userId } = await requireModuleAction("ar", "post");
  const { writeOff, doc } = await loadActiveWriteOff(orgId, writeOffId);
  if (Number(writeOff.recoveredAmount) > 0.005)
    throw new Error("[HAS_RECOVERY] Сэргэлттэй хасалтыг буцаахгүй — үлдсэн дүнг сэргэлтээр бүртгэнэ үү");
  const voucher = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.id, writeOff.voucherId), eq(journalVouchers.organizationId, orgId)),
    with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
  });
  if (!voucher || voucher.status !== "posted") throw new Error("Хасалтын журнал олдсонгүй эсвэл буцаагдсан");
  await assertPeriodOpen(orgId, voucher.date);

  const result = await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, voucher.date);
    const [claimed] = await tx
      .update(arapWriteOffs)
      .set({ status: "reversed", settlementId: null })
      .where(and(eq(arapWriteOffs.id, writeOff.id), eq(arapWriteOffs.status, "active"), sql`${arapWriteOffs.recoveredAmount} <= 0.005`))
      .returning({ id: arapWriteOffs.id });
    if (!claimed) throw new Error("Хасалтын төлөв өөрчлөгдсөн байна");
    await tx
      .update(journalVouchers)
      .set({ status: "reversed" })
      .where(and(eq(journalVouchers.id, voucher.id), eq(journalVouchers.status, "posted")));
    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: voucher.date,
        description: `Буцаалт: ${voucher.description}`,
        documentNo: await nextVoucherNo(tx, orgId, moduleOfVoucherNo(voucher.documentNo, "ar"), voucher.date),
        status: "posted",
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
    const amountText = String(writeOff.amount);
    const baseText = String(writeOff.baseAmount);
    await tx
      .update(arApDocuments)
      .set({
        paidAmount: sql`GREATEST(${arApDocuments.paidAmount} - ${amountText}, 0)`,
        basePaidAmount: sql`GREATEST(${arApDocuments.basePaidAmount} - ${baseText}, 0)`,
        status: sql`CASE WHEN ${arApDocuments.paidAmount} - ${amountText} <= 0.005 THEN 'posted' ELSE 'partially_paid' END`,
      })
      .where(and(eq(arApDocuments.id, doc.id), eq(arApDocuments.organizationId, orgId)));
    if (writeOff.settlementId) await tx.delete(arApSettlements).where(eq(arApSettlements.id, writeOff.settlementId));
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "reverse",
        entityType: "arap",
        entityId: doc.id,
        summary: `Найдваргүй авлагын хасалт буцаагдав — ${doc.documentNo}, ${Number(writeOff.baseAmount).toLocaleString("en-US")}₮`,
      },
      tx
    );
    return { reversalVoucherId: reversal.id };
  });
  revalidateEcl();
  return result;
}

export async function reverseArApWriteOff(
  writeOffId: string
): Promise<ActionResult<{ reversalVoucherId: string }>> {
  try {
    return await reverseArApWriteOffCore(writeOffId);
  } catch (caught) {
    return actionError("reverseArApWriteOff", caught, "Хасалт буцаагдсангүй");
  }
}

/** Нэхэмжлэхийн хасалтууд (панелийн хэсэг) — АР унших эрх. */
export async function listArapWriteOffs(
  documentId: string
): Promise<ActionResult<{ writeOffs: ArapWriteOffView[] }>> {
  try {
    const { orgId } = await requireModuleAction("ar", "read");
    const rows = await db.query.arapWriteOffs.findMany({
      where: and(eq(arapWriteOffs.organizationId, orgId), eq(arapWriteOffs.documentId, documentId)),
      orderBy: (row, { desc }) => [desc(row.createdAt)],
    });
    return {
      writeOffs: rows.map((row) => ({
        id: row.id,
        date: row.date,
        amount: Number(row.amount),
        baseAmount: Number(row.baseAmount),
        allowanceAmount: Number(row.allowanceAmount),
        expenseAmount: Number(row.expenseAmount),
        recoveredAmount: Number(row.recoveredAmount),
        reason: row.reason,
        status: row.status,
        voucherId: row.voucherId,
      })),
    };
  } catch (caught) {
    return actionError("listArapWriteOffs", caught, "Хасалтууд уншигдсангүй");
  }
}

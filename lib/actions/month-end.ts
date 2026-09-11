"use server";

// Сар хаалтын wizard — CLAUDE.md §4-ийн monthly close дарааллын статусыг
// НЭГ дэлгэцэнд цуглуулна:
//   1. Элэгдэл (FA)  2. FX тэгшитгэл  3. Өртөг тооцоо  4. НӨАТ тооцоо
//   5. Хангамж — захиалгын хаалт  6. Ноорог цэвэрлэгээ  7. Период хаах
// Энэ action зөвхөн УНШИНА — бичилт хийдэг алхмууд нь тус тусын
// баталгаажсан action-уудаар (runDepreciation, computeMonthlyCosting,
// createVatSettlementDraft, closePeriod) явна.

import {
  and,
  between,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";

import { roundMoney } from "@/lib/arap/accounting";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  accountingPeriods,
  arApDocumentLines,
  arApDocuments,
  cashAccounts,
  cashDocuments,
  cashFxRevaluations,
  costAllocations,
  costEntries,
  costPeriodResults,
  employees,
  faDepreciationEntries,
  fixedAssets,
  goodsReceipts,
  inventoryMovements,
  journalVouchers,
  payrollRuns,
  purchaseOrders,
} from "@/lib/db/schema";
import { isPeriodCode, periodRange } from "@/lib/periods/period";
import { getVatReturnData } from "@/lib/actions/vat";


/** Алхмын нэгдсэн статус: done ✓ · attention ⚠ · pending ○ · na —. */
export type StepStatus = "done" | "attention" | "pending" | "na";

export type MonthEndChecklist = {
  periodCode: string;
  periodStatus: "open" | "closed";
  closedAt: string | null;
  fa: {
    status: StepStatus;
    activeAssets: number;
    draftEntries: number;
    postedEntries: number;
  };
  fx: {
    status: StepStatus;
    accounts: {
      id: string;
      name: string;
      currency: string;
      lastValuationDate: string | null;
      done: boolean;
    }[];
  };
  costing: {
    status: StepStatus;
    calculated: number;
    blocked: number;
    draftEntries: number;
    postedEntries: number;
    hasActivity: boolean;
  };
  payroll: {
    status: StepStatus;
    activeEmployees: number;
    lineCount: number;
    voucherStatus: "none" | "draft" | "posted" | string;
  };
  vat: {
    status: StepStatus;
    outputVat: number;
    inputVat: number;
    payableVat: number;
    refundableVat: number;
    deadline: string;
    settlementStatus: "none" | "draft" | "posted" | string;
    hasActivity: boolean;
  };
  /**
   * Хангамж (docs/procurement §3.3 ⑧) — сарын хаалтыг хориглох нөхцөл:
   * тухайн сард батлагдсан хүлээн авалттай НЭЭЛТТЭЙ захиалга (PO).
   */
  procurement: {
    status: StepStatus;
    /** Энэ сард батлагдсан хүлээн авалттай, хаагдаагүй захиалгын тоо. */
    openOrdersWithReceipts: number;
    /** Батлагдаагүй хүлээн авалтын баримт. */
    draftReceipts: number;
    /** Бүрэлдэхүүнтэй боловч бүрэн хуваарилагдаагүй нэхэмжлэхийн мөр. */
    unallocatedCostLines: number;
    hasActivity: boolean;
  };
  drafts: {
    journal: number;
    cash: number;
    arap: number;
    inventory: number;
    faDep: number;
    costEntries: number;
    goodsReceipts: number;
    total: number;
  };
};

export async function getMonthEndChecklist(
  periodCode: string
): Promise<MonthEndChecklist> {
  const { orgId } = await getActiveOrg();
  if (!isPeriodCode(periodCode)) throw new Error("Тайлант үеийн код буруу байна");
  const { startDate, endDate } = periodRange(periodCode);

  const draftCount = (table: typeof journalVouchers | typeof cashDocuments | typeof arApDocuments | typeof inventoryMovements | typeof costEntries | typeof goodsReceipts) =>
    db
      .select({ n: count() })
      .from(table)
      .where(
        and(
          eq(table.organizationId, orgId),
          eq(table.status, "draft"),
          between(table.date, startDate, endDate)
        )
      );

  const [
    period,
    activeAssets,
    faEntries,
    fxAccounts,
    costResults,
    monthCostEntries,
    confirmedMovements,
    vatData,
    activeEmployeeRows,
    payrollRun,
    [journalDrafts],
    [cashDrafts],
    [arapDrafts],
    [inventoryDrafts],
    [faDrafts],
    [costDrafts],
    [receiptDrafts],
    [openOrdersWithReceiptRows],
    [ordersInPeriod],
    [receiptsInPeriod],
    costLineCandidates,
  ] = await Promise.all([
    db.query.accountingPeriods.findFirst({
      where: and(
        eq(accountingPeriods.organizationId, orgId),
        eq(accountingPeriods.code, periodCode)
      ),
      columns: { status: true, closedAt: true },
    }),
    db
      .select({ n: count() })
      .from(fixedAssets)
      .where(
        and(
          eq(fixedAssets.organizationId, orgId),
          eq(fixedAssets.status, "active")
        )
      ),
    db.query.faDepreciationEntries.findMany({
      where: and(
        eq(faDepreciationEntries.organizationId, orgId),
        eq(faDepreciationEntries.periodMonth, periodCode)
      ),
      columns: { status: true },
    }),
    db.query.cashAccounts.findMany({
      where: and(
        eq(cashAccounts.organizationId, orgId),
        eq(cashAccounts.isActive, true)
      ),
      columns: { id: true, name: true, currency: true },
    }),
    db.query.costPeriodResults.findMany({
      where: and(
        eq(costPeriodResults.organizationId, orgId),
        eq(costPeriodResults.periodCode, periodCode)
      ),
      columns: { status: true },
    }),
    db.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        between(costEntries.date, startDate, endDate)
      ),
      columns: { status: true },
    }),
    db
      .select({ n: count() })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.organizationId, orgId),
          eq(inventoryMovements.status, "confirmed"),
          between(inventoryMovements.date, startDate, endDate)
        )
      ),
    getVatReturnData(periodCode),
    db
      .select({ n: count() })
      .from(employees)
      .where(
        and(eq(employees.organizationId, orgId), eq(employees.isActive, true))
      ),
    db.query.payrollRuns.findFirst({
      where: and(
        eq(payrollRuns.organizationId, orgId),
        eq(payrollRuns.periodMonth, periodCode)
      ),
      with: {
        voucher: { columns: { status: true } },
        lines: { columns: { id: true } },
      },
    }),
    draftCount(journalVouchers),
    draftCount(cashDocuments),
    draftCount(arApDocuments),
    draftCount(inventoryMovements),
    db
      .select({ n: count() })
      .from(faDepreciationEntries)
      .where(
        and(
          eq(faDepreciationEntries.organizationId, orgId),
          eq(faDepreciationEntries.status, "draft"),
          eq(faDepreciationEntries.periodMonth, periodCode)
        )
      ),
    draftCount(costEntries),
    draftCount(goodsReceipts),
    // Хангамжийн хориг — closePeriod-ийнхтэй ИЖИЛ query (lock дотор дахин
    // шалгагддаг; энд зөвхөн хэрэглэгчид урьдчилан харуулна).
    db
      .select({ n: count() })
      .from(goodsReceipts)
      .innerJoin(
        purchaseOrders,
        eq(purchaseOrders.id, goodsReceipts.purchaseOrderId)
      )
      .where(
        and(
          eq(goodsReceipts.organizationId, orgId),
          eq(goodsReceipts.status, "confirmed"),
          between(goodsReceipts.date, startDate, endDate),
          eq(purchaseOrders.status, "open")
        )
      ),
    db
      .select({ n: count() })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.organizationId, orgId),
          between(purchaseOrders.date, startDate, endDate)
        )
      ),
    db
      .select({ n: count() })
      .from(goodsReceipts)
      .where(
        and(
          eq(goodsReceipts.organizationId, orgId),
          between(goodsReceipts.date, startDate, endDate)
        )
      ),
    // Хуваарилагдаагүй нэмэлт зардал: PO-той, батлагдсан АП нэхэмжлэхийн
    // бүрэлдэхүүнтэй мөрүүд. Хуваарилалтын нийлбэрийг доор тусад нь уншиж
    // мөрийн MNT дүнтэй харьцуулна (Σ < дүн бол хуваарилагдаагүй).
    db
      .select({
        id: arApDocumentLines.id,
        amount: arApDocumentLines.amount,
        exchangeRate: arApDocuments.exchangeRate,
      })
      .from(arApDocumentLines)
      .innerJoin(
        arApDocuments,
        eq(arApDocuments.id, arApDocumentLines.documentId)
      )
      .where(
        and(
          eq(arApDocuments.organizationId, orgId),
          isNotNull(arApDocuments.purchaseOrderId),
          inArray(arApDocuments.status, ["posted", "partially_paid", "paid"]),
          between(arApDocuments.date, startDate, endDate),
          isNotNull(arApDocumentLines.costComponentId)
        )
      ),
  ]);

  // ── FA элэгдэл ──
  const faDraftEntries = faEntries.filter((entry) => entry.status === "draft").length;
  const faPostedEntries = faEntries.filter((entry) => entry.status === "posted").length;
  const activeAssetCount = Number(activeAssets[0]?.n ?? 0);
  const faStatus: StepStatus =
    activeAssetCount === 0
      ? "na"
      : faDraftEntries > 0
        ? "attention"
        : faPostedEntries > 0
          ? "done"
          : "pending";

  // ── FX тэгшитгэл: валютын данс бүр сарын эцсийн өдрөөр posted тэгшитгэлтэй юу ──
  const foreignAccounts = fxAccounts.filter((account) => account.currency !== "MNT");
  const fxRows = await Promise.all(
    foreignAccounts.map(async (account) => {
      const latest = await db.query.cashFxRevaluations.findFirst({
        where: and(
          eq(cashFxRevaluations.organizationId, orgId),
          eq(cashFxRevaluations.cashAccountId, account.id),
          eq(cashFxRevaluations.status, "posted")
        ),
        orderBy: [
          desc(cashFxRevaluations.valuationDate),
          desc(cashFxRevaluations.revision),
        ],
        columns: { valuationDate: true },
      });
      return {
        id: account.id,
        name: account.name,
        currency: account.currency,
        lastValuationDate: latest?.valuationDate ?? null,
        done: latest?.valuationDate === endDate,
      };
    })
  );
  const fxStatus: StepStatus =
    foreignAccounts.length === 0
      ? "na"
      : fxRows.every((row) => row.done)
        ? "done"
        : "pending";

  // ── Өртөг тооцоо ──
  const blocked = costResults.filter((row) => row.status !== "calculated").length;
  const calculated = costResults.length - blocked;
  const costDraftEntries = monthCostEntries.filter(
    (entry) => entry.status === "draft"
  ).length;
  const costPostedEntries = monthCostEntries.filter(
    (entry) => entry.status === "posted"
  ).length;
  const hasInventoryActivity =
    Number(confirmedMovements[0]?.n ?? 0) > 0 || costResults.length > 0;
  const costingStatus: StepStatus = !hasInventoryActivity
    ? "na"
    : blocked > 0 || costDraftEntries > 0
      ? "attention"
      : costResults.length === 0
        ? "pending"
        : "done";

  // ── Цалин ──
  const activeEmployeeCount = Number(activeEmployeeRows[0]?.n ?? 0);
  const payrollVoucherStatus = payrollRun?.voucher?.status ?? "none";
  const payrollStatus: StepStatus =
    activeEmployeeCount === 0
      ? "na"
      : payrollVoucherStatus === "posted"
        ? "done"
        : payrollVoucherStatus === "draft" ||
            (payrollRun?.lines.length ?? 0) > 0
          ? "attention"
          : "pending";

  // ── НӨАТ ──
  const vatHasActivity =
    vatData.summary.outputVat !== 0 || vatData.summary.inputVat !== 0;
  const settlementStatus = vatData.settlement?.status ?? "none";
  const vatStatus: StepStatus = !vatHasActivity
    ? "na"
    : settlementStatus === "posted"
      ? "done"
      : settlementStatus === "draft"
        ? "attention"
        : "pending";

  // ── Хангамж ──
  // Мөр бүрийн MNT дүн vs хуваарилагдсан нийлбэр (cost_allocations.sourceLineId).
  // PO-той нэхэмжлэхийн бүрэлдэхүүнтэй мөр бүрэн хуваарилагдаагүй бол PO
  // хаагдахгүй тул сар хаалт мөн хүлээнэ.
  const candidateLineIds = costLineCandidates.map((line) => line.id);
  const allocatedByLine = new Map<string, number>();
  if (candidateLineIds.length > 0) {
    const allocationRows = await db
      .select({
        sourceLineId: costAllocations.sourceLineId,
        allocated: sql<string>`coalesce(sum(${costAllocations.totalAmount}), 0)`,
      })
      .from(costAllocations)
      .where(
        and(
          eq(costAllocations.organizationId, orgId),
          inArray(costAllocations.sourceLineId, candidateLineIds)
        )
      )
      .groupBy(costAllocations.sourceLineId);
    for (const row of allocationRows)
      if (row.sourceLineId)
        allocatedByLine.set(row.sourceLineId, Number(row.allocated ?? 0));
  }
  const unallocatedCostLines = costLineCandidates.filter((line) => {
    const lineMnt = roundMoney(
      Number(line.amount) * Number(line.exchangeRate ?? 1)
    );
    const allocated = roundMoney(allocatedByLine.get(line.id) ?? 0);
    return roundMoney(lineMnt - allocated) > 0.005;
  }).length;
  const openOrdersWithReceipts = Number(openOrdersWithReceiptRows?.n ?? 0);
  const draftReceipts = Number(receiptDrafts?.n ?? 0);
  const procurementHasActivity =
    Number(ordersInPeriod?.n ?? 0) > 0 ||
    Number(receiptsInPeriod?.n ?? 0) > 0 ||
    openOrdersWithReceipts > 0 ||
    unallocatedCostLines > 0;
  const procurementStatus: StepStatus = !procurementHasActivity
    ? "na"
    : openOrdersWithReceipts > 0 ||
        draftReceipts > 0 ||
        unallocatedCostLines > 0
      ? "attention"
      : "done";

  const drafts = {
    journal: Number(journalDrafts?.n ?? 0),
    cash: Number(cashDrafts?.n ?? 0),
    arap: Number(arapDrafts?.n ?? 0),
    inventory: Number(inventoryDrafts?.n ?? 0),
    faDep: Number(faDrafts?.n ?? 0),
    costEntries: Number(costDrafts?.n ?? 0),
    goodsReceipts: draftReceipts,
  };

  return {
    periodCode,
    periodStatus: period?.status === "closed" ? "closed" : "open",
    closedAt: period?.closedAt?.toISOString().slice(0, 16) ?? null,
    fa: {
      status: faStatus,
      activeAssets: activeAssetCount,
      draftEntries: faDraftEntries,
      postedEntries: faPostedEntries,
    },
    fx: { status: fxStatus, accounts: fxRows },
    costing: {
      status: costingStatus,
      calculated,
      blocked,
      draftEntries: costDraftEntries,
      postedEntries: costPostedEntries,
      hasActivity: hasInventoryActivity,
    },
    payroll: {
      status: payrollStatus,
      activeEmployees: activeEmployeeCount,
      lineCount: payrollRun?.lines.length ?? 0,
      voucherStatus: payrollVoucherStatus,
    },
    vat: {
      status: vatStatus,
      outputVat: vatData.summary.outputVat,
      inputVat: vatData.summary.inputVat,
      payableVat: vatData.summary.payableVat,
      refundableVat: vatData.summary.refundableVat,
      deadline: vatData.summary.deadline,
      settlementStatus,
      hasActivity: vatHasActivity,
    },
    procurement: {
      status: procurementStatus,
      openOrdersWithReceipts,
      draftReceipts,
      unallocatedCostLines,
      hasActivity: procurementHasActivity,
    },
    drafts: {
      ...drafts,
      total: Object.values(drafts).reduce((sum, n) => sum + n, 0),
    },
  };
}

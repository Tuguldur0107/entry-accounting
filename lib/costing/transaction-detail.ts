// Бараа материалын ГҮЙЛГЭЭНИЙ ДЭЛГЭРЭНГҮЙ (өртөг ба данстай) —
// docs/cost 03-report-specifications §3. Inventory, Cost, GL гурвын ГҮҮР.
//
// §3.2: батлагдсан GL бичилтээр хязгаарлахгүй — үнэлэгдээгүй, ноорог,
// батлагдсан, буцаагдсан БҮХ хөдөлгөөн харагдана. Эс бөгөөс GL-д ороогүй
// дэд дэвтрийн хөдөлгөөн нуугдана.

import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocuments,
  chartOfAccounts,
  costComponents,
  costingAccountSettings,
  costEntries,
  costPeriodResults,
  inventoryIssueTypes,
  inventoryMovements,
  journalVouchers,
  purchaseOrders,
} from "@/lib/db/schema";
import { extractMainAccount } from "@/lib/reports/balances";
import { periodCodeOf, periodRange } from "@/lib/periods/period";
import { PO_SOURCE_TYPE } from "@/lib/procurement/constants";
import {
  buildInventoryReconciliationRows,
  postedEntryAmount,
} from "./reconciliation-math";
import {
  computeRunningBalances,
  type RunningMovement,
} from "./running-balance";
import { scopeKey } from "./periodic";
import { roundMoney as round2 } from "@/lib/arap/accounting";
import type {
  GlBoundStatus,
  ReconciliationRow,
  TransactionDetailRow,
} from "./detail-types";

export type {
  GlBoundStatus,
  ReconciliationRow,
  TransactionDetailRow,
} from "./detail-types";
export { GL_BOUND_LABELS } from "./detail-types";

const DIRECTION_BY_TYPE: Record<string, "in" | "out" | "neutral"> = {
  receipt: "in",
  return_in: "in",
  issue: "out",
  return_out: "out",
  transfer: "neutral",
};

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  receipt: "Орлого",
  issue: "Зарлага",
  transfer: "Шилжүүлэг",
  adjustment: "Тохируулга",
  return_in: "Буцаалт (ирсэн)",
  return_out: "Буцаалт (гарсан)",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  manual: "Гараар",
  arap_line: "АР/АП баримт",
  gl_voucher: "GL журнал",
  cash_document: "Мөнгөн гүйлгээ",
  [PO_SOURCE_TYPE]: "Хүлээн авалт (PO)",
};

export const movementTypeLabel = (type: string) =>
  MOVEMENT_TYPE_LABELS[type] ?? type;
export const sourceTypeLabel = (type: string) =>
  SOURCE_TYPE_LABELS[type] ?? type;


/**
 * Тухайн огнооны мужийн бүх хөдөлгөөнийг өртөг, данс, GL төлөвтэй нь
 * буцаана. Нэг хөдөлгөөнд олон өртгийн бичилт (жишээ нь landed cost)
 * харьяалагдвал бичилт тус бүр ТУСДАА мөр болно — §3.10-ийн "нэг удаа
 * харагдана эсвэл задаргаа нь тодорхой байна" шаардлагад нийцүүлж
 * задаргааг ил гаргана.
 */
export async function loadTransactionDetail(
  orgId: string,
  range: { from: string; to: string }
): Promise<TransactionDetailRow[]> {
  // Running балансын хуримтлал периодын ЭХНЭЭС явдаг тул хайлтын цонхыг
  // эхний өдрийнх нь периодын эхлэл хүртэл өргөтгөж уншина; харуулахдаа
  // хүссэн мужаар нь шүүнэ.
  const windowStart = periodRange(periodCodeOf(range.from)).startDate;
  const movements = await db.query.inventoryMovements.findMany({
    where: and(
      eq(inventoryMovements.organizationId, orgId),
      gte(inventoryMovements.date, windowStart),
      lte(inventoryMovements.date, range.to)
    ),
    with: { item: true, warehouse: true },
    orderBy: (movement, { asc }) => [asc(movement.date), asc(movement.createdAt)],
  });
  if (movements.length === 0) return [];

  const movementIds = movements.map((movement) => movement.id);
  const [entries, accounts, issueTypes, components] = await Promise.all([
    db.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        inArray(costEntries.movementId, movementIds)
      ),
    }),
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.organizationId, orgId),
      columns: { number: true, name: true },
    }),
    db.query.inventoryIssueTypes.findMany({
      where: eq(inventoryIssueTypes.organizationId, orgId),
      columns: { id: true, code: true, name: true },
    }),
    db.query.costComponents.findMany({
      where: eq(costComponents.organizationId, orgId),
      columns: { id: true, code: true, name: true },
    }),
  ]);

  const voucherIds = [
    ...new Set(
      entries
        .map((entry) => entry.voucherId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const vouchers =
    voucherIds.length > 0
      ? await db.query.journalVouchers.findMany({
          where: and(
            eq(journalVouchers.organizationId, orgId),
            inArray(journalVouchers.id, voucherIds)
          ),
          columns: { id: true, date: true, description: true },
        })
      : [];

  const accountName = new Map(
    accounts.map((account) => [account.number, account.name])
  );
  const issueTypeLabel = new Map(
    issueTypes.map((type) => [type.id, `${type.code} · ${type.name}`])
  );
  const componentLabel = new Map(
    components.map((component) => [
      component.id,
      `${component.code} · ${component.name}`,
    ])
  );
  const voucherById = new Map(vouchers.map((voucher) => [voucher.id, voucher]));

  const entriesByMovement = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (!entry.movementId) continue;
    const list = entriesByMovement.get(entry.movementId);
    if (list) list.push(entry);
    else entriesByMovement.set(entry.movementId, [entry]);
  }

  // ── Running балансууд (§3.4) ────────────────────────────────────────────
  // Суурь: тухайн scope-периодын C1 + PWA (cost_period_results-ээс).
  const periodCodes = [...new Set(movements.map((m) => periodCodeOf(m.date)))];
  const periodResults = await db.query.costPeriodResults.findMany({
    where: and(
      eq(costPeriodResults.organizationId, orgId),
      inArray(costPeriodResults.periodCode, periodCodes),
      eq(costPeriodResults.status, "calculated")
    ),
  });
  const runningBasis = new Map(
    periodResults.map((row) => [
      `${scopeKey(row.itemId, row.warehouseId)}::${row.periodCode}`,
      {
        openingQty: Number(row.openingQty),
        openingAmount: Number(row.openingAmount),
        average:
          row.averageUnitCost === null ? null : Number(row.averageUnitCost),
      },
    ])
  );

  // Хөдөлгөөн → running үйл явдал. Зөвхөн БАТЛАГДСАН хөдөлгөөн нөөц хөдөлгөнө.
  const runningEvents: RunningMovement[] = [];
  for (const movement of movements) {
    if (movement.status !== "confirmed") continue;
    if (!movement.itemId || !movement.warehouseId) continue;
    const quantity = Number(movement.quantity);
    const absQty = Math.abs(quantity);
    const periodCode = periodCodeOf(movement.date);
    const shared = {
      itemId: movement.itemId,
      warehouseId: movement.warehouseId,
      periodCode,
      inboundAmount: null as number | null,
    };
    switch (movement.movementType) {
      case "receipt": {
        // Бодит орлогын дүн: идэвхтэй капитализаци + нэмэлт зардал.
        const amount = (entriesByMovement.get(movement.id) ?? [])
          .filter(
            (entry) =>
              entry.status !== "reversed" &&
              (entry.entryType === "receipt_capitalize" ||
                entry.entryType === "landed_cost")
          )
          .reduce((sum, entry) => sum + Number(entry.amount), 0);
        const hasCapitalize = (entriesByMovement.get(movement.id) ?? []).some(
          (entry) =>
            entry.status !== "reversed" &&
            entry.entryType === "receipt_capitalize"
        );
        runningEvents.push({
          ...shared,
          movementId: movement.id,
          kind: "priced-in",
          quantityDelta: absQty,
          inboundAmount: hasCapitalize ? Math.round(amount * 100) / 100 : null,
        });
        break;
      }
      case "return_in":
        runningEvents.push({
          ...shared,
          movementId: movement.id,
          kind: "avg-in",
          quantityDelta: absQty,
        });
        break;
      case "issue":
      case "return_out":
        runningEvents.push({
          ...shared,
          movementId: movement.id,
          kind: "avg-out",
          quantityDelta: -absQty,
        });
        break;
      case "adjustment":
        runningEvents.push({
          ...shared,
          movementId: movement.id,
          kind: quantity >= 0 ? "avg-in" : "avg-out",
          quantityDelta: quantity,
        });
        break;
      case "transfer": {
        // OD-014 (0.9): эх агуулахаас сарын дунджаар гарч, хүлээн авагчид
        // ТЭР дунджаар орно. Гаргах агуулахын утга дэлгэцэнд харагдана.
        runningEvents.push({
          ...shared,
          movementId: movement.id,
          kind: "avg-out",
          quantityDelta: -absQty,
        });
        if (movement.toWarehouseId) {
          const sourceAverage =
            runningBasis.get(`${scopeKey(movement.itemId!, movement.warehouseId!)}::${shared.periodCode}`)
              ?.average ?? null;
          runningEvents.push({
            ...shared,
            warehouseId: movement.toWarehouseId,
            movementId: `${movement.id}::in`,
            kind: "priced-in",
            quantityDelta: absQty,
            inboundAmount: sourceAverage === null ? null : round2(absQty * sourceAverage),
          });
        }
        break;
      }
    }
  }
  const runningByMovement = computeRunningBalances(runningEvents, runningBasis);

  const rows: TransactionDetailRow[] = [];
  for (const movement of movements) {
    // Өргөтгөсөн цонхны эхний хэсэг зөвхөн хуримтлалд — харагдахгүй.
    if (movement.date < range.from) continue;
    const quantity = Number(movement.quantity);
    const direction =
      movement.movementType === "adjustment"
        ? quantity >= 0
          ? "in"
          : "out"
        : (DIRECTION_BY_TYPE[movement.movementType] ?? "neutral");
    const absQty = Math.abs(quantity);

    const shared = {
      date: movement.date,
      sourceType: sourceTypeLabel(movement.sourceType),
      sourceDocumentNo: movement.documentNo,
      sourceId: movement.sourceId,
      movementId: movement.id,
      movementType: movementTypeLabel(movement.movementType),
      direction,
      itemCode: movement.item?.code ?? "—",
      itemName: movement.item?.name ?? "—",
      warehouseLabel: movement.warehouse
        ? `${movement.warehouse.code} · ${movement.warehouse.name}`
        : "—",
      unit: movement.item?.unit ?? "",
      qtyIn: direction === "in" ? absQty : null,
      qtyOut: direction === "out" ? absQty : null,
      createdAt: movement.createdAt
        .toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" })
        .slice(0, 16),
      runningQty: runningByMovement.get(movement.id)?.qty ?? null,
      runningAmount: runningByMovement.get(movement.id)?.amount ?? null,
    };

    const movementEntries = entriesByMovement.get(movement.id) ?? [];

    if (movementEntries.length === 0) {
      // Үнэлэгдээгүй — ГЭХДЭЭ мөр нь заавал харагдана (§3.2).
      rows.push({
        ...shared,
        id: movement.id,
        postingDate: null,
        unitCost: null,
        amount: null,
        costMethod: "—",
        costComponent: null,
        issueType: null,
        debitAccountCode: null,
        debitAccountName: null,
        creditAccountCode: null,
        creditAccountName: null,
        glStatus: "not-valued",
        journalNo: null,
        voucherId: null,
        costEntryId: null,
      });
      continue;
    }

    for (const entry of movementEntries) {
      const voucher = entry.voucherId
        ? voucherById.get(entry.voucherId)
        : undefined;
      const debit = entry.debitAccountNumber
        ? extractMainAccount(entry.debitAccountNumber)
        : null;
      const credit = entry.creditAccountNumber
        ? extractMainAccount(entry.creditAccountNumber)
        : null;
      const glStatus: GlBoundStatus =
        entry.status === "posted"
          ? "posted"
          : entry.status === "reversed"
            ? "reversed"
            : "pending";

      rows.push({
        ...shared,
        id: entry.id,
        postingDate: entry.postedAt
          ? entry.postedAt
              .toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" })
              .slice(0, 10)
          : null,
        unitCost: Number(entry.unitCost),
        amount: Number(entry.amount),
        costMethod:
          entry.valuationSource === "avg_cost"
            ? "Хугацааны жигнэсэн дундаж"
            : entry.valuationSource === "provisional_avg"
              ? "Урьдчилсан (явцын дундаж — сар хаалтад залруулагдана)"
              : "Гараар",
        costComponent: entry.costComponentId
          ? (componentLabel.get(entry.costComponentId) ?? null)
          : null,
        issueType: entry.issueTypeId
          ? (issueTypeLabel.get(entry.issueTypeId) ?? null)
          : null,
        debitAccountCode: debit,
        debitAccountName: debit ? (accountName.get(debit) ?? null) : null,
        creditAccountCode: credit,
        creditAccountName: credit ? (accountName.get(credit) ?? null) : null,
        glStatus,
        journalNo: voucher ? voucher.id.slice(0, 8) : null,
        voucherId: entry.voucherId,
        costEntryId: entry.id,
      });
    }
  }

  return rows;
}

/**
 * Бараа материалын дэд дэвтэр ↔ GL тулгалт (§5).
 *
 * Дэд дэвтрийн тал: батлагдсан өртгийн бичилтүүдийн нөлөө данс тус бүрээр.
 * GL тал: тухайн дансанд БҮХ journal мөр (гараар бичсэн нь ч орно).
 * PO хаалтын журнал (§5a ⑥) нь өртгийн бичилт БИШ тул тусдаа баганаар ил
 * гарч зөрүүнээс хасагдана — эс бөгөөс хаагдсан PO бүр худал зөрүү үүсгэнэ.
 * Зөрүү нь ил гарна — автоматаар нөхөхгүй (§5.6, AC-005).
 */
export async function loadInventoryGlReconciliation(
  orgId: string,
  range: { from: string; to: string }
): Promise<{
  rows: ReconciliationRow[];
  pendingCount: number;
  pendingAmount: number;
}> {
  const [entries, vouchers] = await Promise.all([
    db.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        gte(costEntries.date, range.from),
        lte(costEntries.date, range.to)
      ),
      columns: {
        status: true,
        amount: true,
        entryType: true,
        debitAccountNumber: true,
        creditAccountNumber: true,
      },
    }),
    db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.organizationId, orgId),
        gte(journalVouchers.date, range.from),
        lte(journalVouchers.date, range.to)
      ),
      with: { lines: true },
      columns: { id: true, date: true, status: true },
    }),
  ]);

  const accounts = await db.query.chartOfAccounts.findMany({
    where: eq(chartOfAccounts.organizationId, orgId),
    columns: { number: true, name: true },
  });
  const accountName = new Map(
    accounts.map((account) => [account.number, account.name])
  );

  // Дэд дэвтрийн тал — ЗӨВХӨН батлагдсан бичилт GL-д хүрсэн байна.
  const subledger = new Map<string, number>();
  let pendingCount = 0;
  let pendingAmount = 0;
  for (const entry of entries) {
    const amount = Number(entry.amount);
    if (entry.status !== "posted") {
      if (entry.status === "draft") {
        pendingCount += 1;
        pendingAmount += amount;
      }
      continue;
    }
    // Хадгалсан Дт/Кт хос чиглэлээ агуулдаг тул дүн нь абсолют (cogs_true_up
    // тэмдэгтэй хадгалагддаг — postedEntryAmount).
    const effect = postedEntryAmount(entry);
    if (entry.debitAccountNumber) {
      const main = extractMainAccount(entry.debitAccountNumber);
      subledger.set(main, (subledger.get(main) ?? 0) + effect);
    }
    if (entry.creditAccountNumber) {
      const main = extractMainAccount(entry.creditAccountNumber);
      subledger.set(main, (subledger.get(main) ?? 0) - effect);
    }
  }

  // PO хаалтын журналууд — огнооны мужаар хязгаарлахгүй (хаалт нь хожим
  // хийгдсэн ч тэр мужийн түр дансны үлдэгдлийг тэгшитгэдэг).
  const closedOrders = await db.query.purchaseOrders.findMany({
    where: and(
      eq(purchaseOrders.organizationId, orgId),
      isNotNull(purchaseOrders.closeVoucherId)
    ),
    columns: { closeVoucherId: true },
  });
  const poCloseVouchers = new Set(
    closedOrders
      .map((order) => order.closeVoucherId)
      .filter((id): id is string => Boolean(id))
  );

  // КЛИРИНГ рольтой данснууд ба АР/АП баримтын журналууд (ENT-021).
  const [roleSettings, components, arapVoucherRows] = await Promise.all([
    db.query.costingAccountSettings.findFirst({
      where: eq(costingAccountSettings.organizationId, orgId),
      columns: { clearingAccountNumber: true, apClearingAccountNumber: true },
    }),
    db.query.costComponents.findMany({
      where: eq(costComponents.organizationId, orgId),
      columns: { accountNumber: true },
    }),
    db
      .select({ voucherId: arApDocuments.voucherId })
      .from(arApDocuments)
      .where(and(eq(arApDocuments.organizationId, orgId), isNotNull(arApDocuments.voucherId))),
  ]);
  const clearingAccounts = new Set(
    [
      roleSettings?.clearingAccountNumber,
      roleSettings?.apClearingAccountNumber,
      ...components.map((component) => component.accountNumber),
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => extractMainAccount(value))
  );
  const arapVouchers = new Set(
    arapVoucherRows.map((row) => row.voucherId).filter((id): id is string => Boolean(id))
  );

  // GL тал — дэд дэвтрийн лавлагаатай / PO хаалт / гараар бичсэнийг ялгана (§5.4).
  const glLines = vouchers
    .filter((voucher) => voucher.status !== "draft")
    .flatMap((voucher) =>
      voucher.lines.map((line) => ({
        accountNumber: extractMainAccount(line.accountNumber),
        delta: Number(line.debit) - Number(line.credit),
        linked: Boolean(line.costEntryId),
        poClose: poCloseVouchers.has(voucher.id),
        sourceDoc:
          !line.costEntryId &&
          arapVouchers.has(voucher.id) &&
          clearingAccounts.has(extractMainAccount(line.accountNumber)),
      }))
    );

  const rows = buildInventoryReconciliationRows({
    subledger,
    glLines,
    accountName,
  });

  return {
    rows,
    pendingCount,
    pendingAmount: Math.round(pendingAmount * 100) / 100,
  };
}

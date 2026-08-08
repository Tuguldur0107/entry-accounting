// Бараа материалын ГҮЙЛГЭЭНИЙ ДЭЛГЭРЭНГҮЙ (өртөг ба данстай) —
// docs/cost 03-report-specifications §3. Inventory, Cost, GL гурвын ГҮҮР.
//
// §3.2: батлагдсан GL бичилтээр хязгаарлахгүй — үнэлэгдээгүй, ноорог,
// батлагдсан, буцаагдсан БҮХ хөдөлгөөн харагдана. Эс бөгөөс GL-д ороогүй
// дэд дэвтрийн хөдөлгөөн нуугдана.

import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  chartOfAccounts,
  costComponents,
  costEntries,
  costPeriodResults,
  inventoryIssueTypes,
  inventoryMovements,
  journalVouchers,
} from "@/lib/db/schema";
import { extractMainAccount } from "@/lib/reports/balances";
import { periodCodeOf, periodRange } from "@/lib/periods/period";
import {
  computeRunningBalances,
  type RunningMovement,
} from "./running-balance";
import { scopeKey } from "./periodic";
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
      case "transfer":
        // Гаргах агуулахын scope — дэлгэцэнд ЭНЭ утга харагдана.
        runningEvents.push({
          ...shared,
          movementId: movement.id,
          kind: "transfer",
          quantityDelta: -absQty,
        });
        if (movement.toWarehouseId)
          runningEvents.push({
            ...shared,
            warehouseId: movement.toWarehouseId,
            movementId: `${movement.id}::in`,
            kind: "transfer",
            quantityDelta: absQty,
          });
        break;
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
    if (entry.debitAccountNumber) {
      const main = extractMainAccount(entry.debitAccountNumber);
      subledger.set(main, (subledger.get(main) ?? 0) + amount);
    }
    if (entry.creditAccountNumber) {
      const main = extractMainAccount(entry.creditAccountNumber);
      subledger.set(main, (subledger.get(main) ?? 0) - amount);
    }
  }

  // GL тал — дэд дэвтрийн лавлагаатай/лавлагаагүйг ялгана (§5.4).
  const gl = new Map<string, number>();
  const unlinkedLines = new Map<string, number>();
  const unlinkedAmount = new Map<string, number>();
  for (const voucher of vouchers) {
    if (voucher.status === "draft") continue;
    for (const line of voucher.lines) {
      const main = extractMainAccount(line.accountNumber);
      const delta = Number(line.debit) - Number(line.credit);
      gl.set(main, (gl.get(main) ?? 0) + delta);
      if (!line.costEntryId) {
        unlinkedLines.set(main, (unlinkedLines.get(main) ?? 0) + 1);
        unlinkedAmount.set(main, (unlinkedAmount.get(main) ?? 0) + delta);
      }
    }
  }

  const codes = new Set([...subledger.keys()]);
  // GL талаас зөвхөн ХОЛБООТОЙ данснуудыг нэмнэ — бүх GL данс энэ тайланд
  // хамаарахгүй (§5.5: зөвхөн харьцуулах олонлогоо тодорхой байлгана).
  for (const [code, count] of unlinkedLines)
    if (subledger.has(code) && count > 0) codes.add(code);

  const rows: ReconciliationRow[] = [...codes]
    .map((code) => {
      const subledgerAmount = Math.round((subledger.get(code) ?? 0) * 100) / 100;
      const glAmount = Math.round((gl.get(code) ?? 0) * 100) / 100;
      return {
        accountNumber: code,
        accountName: accountName.get(code) ?? "",
        subledgerAmount,
        glAmount,
        difference: Math.round((subledgerAmount - glAmount) * 100) / 100,
        unlinkedGlLines: unlinkedLines.get(code) ?? 0,
        unlinkedGlAmount:
          Math.round((unlinkedAmount.get(code) ?? 0) * 100) / 100,
      };
    })
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));

  return {
    rows,
    pendingCount,
    pendingAmount: Math.round(pendingAmount * 100) / 100,
  };
}

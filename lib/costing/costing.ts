// Өртгийн тооцоолол — цэвэр (DB хамааралгүй, unit тесттэй) жигнэсэн дундаж.
//
// Costing run: баталсан-үнэлэгдээгүй хөдөлгөөнүүдийг он цагийн дарааллаар
// үнэлнэ. Орлогын unitCost-ыг хэрэглэгч (эсвэл ирээдүйд АП мөр) өгнө;
// зарлага/тохируулга тухайн үеийн дунджаар үнэлэгдэнэ. Тухайн барааны
// үнэлэгдээгүй орлого таарвал тэр бараа ЦААШ үнэлэгдэхгүй (дундаж нь
// тодорхойгүй болсон тул) — pending шалтгаантайгаа буцна.
//
// GL бичилт (clearing схем — өртгийн модуль үргэлж өөрөө бичнэ):
//   receipt_capitalize: Dr inventoryAccount / Cr 14000099 (клиринг)
//   issue_cogs:         Dr cogsAccount      / Cr inventoryAccount
//   adjustment_gain:    Dr inventoryAccount / Cr 51800003
//   adjustment_loss:    Dr 87100004         / Cr inventoryAccount

import {
  sortChronologically,
  type MovementRef,
} from "@/lib/inventory/balances";

export const CLEARING_ACCOUNT = "14000099";
export const ADJUSTMENT_GAIN_ACCOUNT = "51800003";
export const ADJUSTMENT_LOSS_ACCOUNT = "87100004";
// NRV (IAS 2 §9, §28–33): бууруулалтыг contra-нөөц дансаар — өртгийн суурь
// (дундаж) ХӨНДӨГДӨХГҮЙ; сэргээлт өмнөх бууруулалтын хэмжээнд л.
export const NRV_EXPENSE_ACCOUNT = "87100005";
export const NRV_RESERVE_ACCOUNT = "14900001";

export type CostEntryType =
  | "receipt_capitalize"
  | "issue_cogs"
  | "adjustment_gain"
  | "adjustment_loss"
  // Буцаалт (clearing схемийн mirror): гарах нь клиринг рүү, ирэх нь
  // COGS-оо буцаана — аль аль нь тухайн үеийн дунджаар.
  | "return_out"
  | "return_in"
  // Landed cost (IAS 2.11): клирингт суусан тээвэр/гааль зэрэг зардлыг
  // барааны өртөгт шингээнэ — БАТЛАГДМАГЦ тухайн огнооноос хойшхи
  // үнэлгээнд дундажийг өсгөнө.
  | "landed_cost"
  | "nrv_writedown"
  | "nrv_reversal";

export interface PostedEntryRef {
  movementId: string;
  entryType: CostEntryType;
  quantity: number;
  unitCost: number;
  amount: number;
}

export interface ComputedEntry {
  movementId: string;
  entryType: CostEntryType;
  date: string;
  quantity: number; // абсолют утга
  unitCost: number;
  amount: number; // MNT, 2 орон
  valuationSource: "manual" | "avg_cost";
}

export interface PendingMovement {
  movementId: string;
  reason: "unit-cost-required" | "blocked-by-unvalued-receipt";
}

export interface ItemCostState {
  qty: number;
  avgCost: number;
}

/** Батлагдсан landed cost — тухайн огнооны үлдэгдэлд үнийн нэмэгдэл. */
export interface ValueAdjustmentRef {
  id: string;
  itemId: string;
  date: string;
  amount: number;
  createdAt: string;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 10000) / 10000;

function applyReceipt(state: ItemCostState, qty: number, unitCost: number) {
  const newQty = round4(state.qty + qty);
  const newAvg =
    newQty <= 0
      ? state.avgCost
      : (state.qty * state.avgCost + qty * unitCost) / newQty;
  state.qty = newQty;
  state.avgCost = round4(newAvg);
}

function applyOut(state: ItemCostState, qty: number) {
  state.qty = round4(state.qty - qty);
}

/**
 * Costing run core. `movements` = АЛЬ ХЭДИЙН үнэлэгдсэн + үнэлэгдээгүй бүх
 * confirmed хөдөлгөөн (transfer орсон ч үнэлэгдэхгүй — GL нөлөөгүй);
 * `valued` = идэвхтэй (draft|posted) cost entry-ний movementId олонлог;
 * `receiptCosts` = орлогын movementId → unitCost (гараас/АП-аас).
 *
 * Дундаж өртгийн төлөвийг бүх үнэлэгдсэн entry-г он цагийн дарааллаар replay
 * хийж сэргээгээд, үнэлэгдээгүйг мөн дарааллаар нь боловсруулна.
 */
export function computeCostingRun(input: {
  movements: MovementRef[];
  valuedEntries: PostedEntryRef[];
  receiptCosts: Map<string, number>;
  asOfDate: string;
  /** Батлагдсан landed cost-ууд — стриймд огноогоор нь орж дундажийг өсгөнө. */
  valueAdjustments?: ValueAdjustmentRef[];
}): {
  entries: ComputedEntry[];
  pending: PendingMovement[];
  state: Map<string, ItemCostState>;
} {
  const valuedByMovement = new Map(
    input.valuedEntries.map((entry) => [entry.movementId, entry])
  );
  // Хөдөлгөөн + landed cost-ыг нэг он цагийн стрийм болгоно.
  type StreamEvent =
    | { kind: "movement"; date: string; createdAt: string; id: string; movement: MovementRef }
    | { kind: "adjust"; date: string; createdAt: string; id: string; adjust: ValueAdjustmentRef };
  const events: StreamEvent[] = [
    ...sortChronologically(input.movements).map((movement) => ({
      kind: "movement" as const,
      date: movement.date,
      createdAt: movement.createdAt,
      id: movement.id,
      movement,
    })),
    ...(input.valueAdjustments ?? []).map((adjust) => ({
      kind: "adjust" as const,
      date: adjust.date,
      createdAt: adjust.createdAt,
      id: adjust.id,
      adjust,
    })),
  ].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const byCreated = a.createdAt.localeCompare(b.createdAt);
    if (byCreated !== 0) return byCreated;
    return a.id.localeCompare(b.id);
  });
  const ordered = events;
  const state = new Map<string, ItemCostState>();
  const stateFor = (itemId: string) => {
    let s = state.get(itemId);
    if (!s) {
      s = { qty: 0, avgCost: 0 };
      state.set(itemId, s);
    }
    return s;
  };

  const entries: ComputedEntry[] = [];
  const pending: PendingMovement[] = [];
  // Үнэлэгдээгүй орлого таарсан бараа: дундаж нь тодорхойгүй тул дараагийн
  // бүх хөдөлгөөн нь blocked.
  const blockedItems = new Set<string>();

  for (const event of ordered) {
    if (event.date > input.asOfDate) continue;
    if (event.kind === "adjust") {
      // Landed cost: qty > 0 үед л дундажид шингэнэ (нөөцгүй үед орхино —
      // GL талдаа бичигдсэн, tie-out биш үнэлгээний тайланд л ялгарна).
      const adjustState = stateFor(event.adjust.itemId);
      if (adjustState.qty > 0)
        adjustState.avgCost = round4(
          adjustState.avgCost + event.adjust.amount / adjustState.qty
        );
      continue;
    }
    const movement = event.movement;
    if (movement.movementType === "transfer") continue; // GL нөлөөгүй

    const existing = valuedByMovement.get(movement.id);
    const itemState = stateFor(movement.itemId);

    if (existing) {
      // Replay: төлөвийг өмнө үнэлэгдсэнээр урагшлуулна.
      if (
        existing.entryType === "receipt_capitalize" ||
        existing.entryType === "adjustment_gain" ||
        existing.entryType === "return_in"
      )
        applyReceipt(itemState, existing.quantity, existing.unitCost);
      else applyOut(itemState, existing.quantity);
      continue;
    }

    if (blockedItems.has(movement.itemId)) {
      pending.push({
        movementId: movement.id,
        reason: "blocked-by-unvalued-receipt",
      });
      continue;
    }

    const qty = movement.quantity;
    if (movement.movementType === "receipt") {
      const unitCost = input.receiptCosts.get(movement.id);
      if (unitCost == null || !(unitCost >= 0)) {
        pending.push({ movementId: movement.id, reason: "unit-cost-required" });
        blockedItems.add(movement.itemId);
        continue;
      }
      applyReceipt(itemState, qty, unitCost);
      entries.push({
        movementId: movement.id,
        entryType: "receipt_capitalize",
        date: movement.date,
        quantity: qty,
        unitCost: round4(unitCost),
        amount: round2(qty * unitCost),
        valuationSource: "manual",
      });
      continue;
    }

    if (movement.movementType === "issue" || movement.movementType === "return_out") {
      const unitCost = itemState.avgCost;
      applyOut(itemState, qty);
      entries.push({
        movementId: movement.id,
        entryType: movement.movementType === "issue" ? "issue_cogs" : "return_out",
        date: movement.date,
        quantity: qty,
        unitCost,
        amount: round2(qty * unitCost),
        valuationSource: "avg_cost",
      });
      continue;
    }

    if (movement.movementType === "return_in") {
      // Худалдан авагчаас буцаж ирсэн бараа тухайн үеийн дунджаар нөөцөд
      // орж, COGS-ыг мөн дүнгээр бууруулна (ойролцоолол — эх зарлагын
      // өртгийг мөшгихгүй).
      const unitCost = itemState.avgCost;
      applyReceipt(itemState, qty, unitCost);
      entries.push({
        movementId: movement.id,
        entryType: "return_in",
        date: movement.date,
        quantity: qty,
        unitCost,
        amount: round2(qty * unitCost),
        valuationSource: "avg_cost",
      });
      continue;
    }

    // adjustment: signed qty — илүүдэл дунджаар орлогожно, дутагдал дунджаар гарна.
    const isGain = qty > 0;
    const absQty = Math.abs(qty);
    const unitCost = itemState.avgCost;
    if (isGain) applyReceipt(itemState, absQty, unitCost);
    else applyOut(itemState, absQty);
    entries.push({
      movementId: movement.id,
      entryType: isGain ? "adjustment_gain" : "adjustment_loss",
      date: movement.date,
      quantity: absQty,
      unitCost,
      amount: round2(absQty * unitCost),
      valuationSource: "avg_cost",
    });
  }

  return { entries, pending, state };
}

/** GL мөрийн Dr/Cr данс (main account, сегментгүй) — entry төрлөөс. */
export function entryPostingAccounts(
  entryType: CostEntryType,
  itemAccounts: { inventoryAccountNumber: string; cogsAccountNumber: string }
): { debit: string; credit: string } {
  switch (entryType) {
    case "receipt_capitalize":
      return {
        debit: itemAccounts.inventoryAccountNumber,
        credit: CLEARING_ACCOUNT,
      };
    case "issue_cogs":
      return {
        debit: itemAccounts.cogsAccountNumber,
        credit: itemAccounts.inventoryAccountNumber,
      };
    case "adjustment_gain":
      return {
        debit: itemAccounts.inventoryAccountNumber,
        credit: ADJUSTMENT_GAIN_ACCOUNT,
      };
    case "adjustment_loss":
      return {
        debit: ADJUSTMENT_LOSS_ACCOUNT,
        credit: itemAccounts.inventoryAccountNumber,
      };
    case "return_out":
      // Нийлүүлэгчид буцаалт: нөөцөөс гаргаж клирингт — АП талын кредит
      // ноот (Dr АП / Cr клиринг)-той клиринг дээр тулна.
      return {
        debit: CLEARING_ACCOUNT,
        credit: itemAccounts.inventoryAccountNumber,
      };
    case "return_in":
      // Борлуулалтын буцаалт: нөөц сэргэж COGS буурна (орлогын буцаалтыг
      // АР/GL талдаа тусад нь бичнэ).
      return {
        debit: itemAccounts.inventoryAccountNumber,
        credit: itemAccounts.cogsAccountNumber,
      };
    case "landed_cost":
      // Клирингт суусан нэмэлт зардлыг барааны дансанд капитализацилна.
      return {
        debit: itemAccounts.inventoryAccountNumber,
        credit: CLEARING_ACCOUNT,
      };
    case "nrv_writedown":
      return { debit: NRV_EXPENSE_ACCOUNT, credit: NRV_RESERVE_ACCOUNT };
    case "nrv_reversal":
      return { debit: NRV_RESERVE_ACCOUNT, credit: NRV_EXPENSE_ACCOUNT };
  }
}

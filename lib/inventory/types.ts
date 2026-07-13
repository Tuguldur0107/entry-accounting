export type InventoryItemView = {
  id: string;
  code: string;
  name: string;
  unit: string;
  isActive: boolean;
};

export type WarehouseView = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type InventoryMovementView = {
  id: string;
  documentNo: string;
  movementType: string;
  date: string;
  /** null = GL/кассаас үүссэн sentinel — бөглөж батална. */
  itemId: string | null;
  itemLabel: string;
  unit: string;
  warehouseId: string | null;
  warehouseName: string;
  toWarehouseId: string | null;
  toWarehouseName: string | null;
  quantity: number;
  description: string;
  status: string;
  sourceType: string;
  /** Идэвхтэй (draft|posted) cost entry-тэй эсэх — цуцлах боломжийг хаана. */
  hasCostEntry: boolean;
};

export type QtyBalanceRow = {
  itemId: string;
  itemLabel: string;
  unit: string;
  warehouseName: string;
  quantity: number;
};

export type CostEntryView = {
  id: string;
  movementId: string;
  documentNo: string;
  itemLabel: string;
  unit: string;
  entryType: string;
  date: string;
  quantity: number;
  unitCost: number;
  amount: number;
  valuationSource: string;
  status: string;
  voucherId: string | null;
};

export type PendingValuationView = {
  movementId: string;
  documentNo: string;
  date: string;
  movementType: string;
  itemLabel: string;
  unit: string;
  quantity: number;
  reason: "unit-cost-required" | "blocked-by-unvalued-receipt";
};

export type ValuationRow = {
  itemId: string;
  itemLabel: string;
  unit: string;
  quantity: number;
  avgCost: number;
  value: number;
};

export type TieOutRow = {
  accountNumber: string;
  accountName: string;
  subledgerValue: number;
  glBalance: number;
  difference: number;
};

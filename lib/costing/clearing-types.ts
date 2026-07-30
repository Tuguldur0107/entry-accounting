// Клирингийн тулгалтын CLIENT-д аюулгүй төрлүүд (§6).
// (Ачаалагч нь lib/costing/clearing-reconciliation.ts — DB-тэй тул client
// component-оос импортлохгүй.)

export interface ClearingObjectRow {
  account: string;
  /** Бизнес объектын төрөл — тулгалтын түлхүүрийн нэг хэсэг (§6.2). */
  objectType: string;
  objectId: string;
  objectLabel: string;
  componentLabel: string | null;
  opening: number;
  increase: number;
  cleared: number;
  /** Opening + Increase − Cleared — объект ДОТРОО тулна, хооронд нь шүүрдэхгүй. */
  ending: number;
  lastDate: string;
  known: boolean;
  status: "cleared" | "open" | "unknown";
}

export interface ClearingAccountSummary {
  account: string;
  opening: number;
  increase: number;
  cleared: number;
  ending: number;
  objectCount: number;
}

export interface ClearingReconciliation {
  accounts: ClearingAccountSummary[];
  rows: ClearingObjectRow[];
  /** Объектгүй (гар журнал) мөрүүд — ил үлдэгдэл. */
  unknownCount: number;
  unknownAmount: number;
}

import type { ColDef, ColGroupDef } from "ag-grid-community";

// Column type registry IDs — every editable column declares one of these.
// New kinds may only be added in `lib/grid/columnTypes.ts`.
export type ColumnTypeId =
  | "text"
  | "number-money"
  | "account-segment"
  | "debit"
  | "credit"
  | "date"
  | "switch"
  | "select"
  | "readonly-text"
  | "readonly-money";

export interface CellValidationResult {
  ok: boolean;
  errorMn?: string;
}

export type CellValidator<V = unknown, R = Record<string, unknown>> = (
  value: V,
  row?: R
) => CellValidationResult;

export interface RowMeta {
  isDirty: boolean;
  isInvalid: boolean;
  isDeleted?: boolean;
  isNew?: boolean;
  errors: Record<string, string>;
}

export interface BatchPatch<T = Record<string, unknown>> {
  create: Array<T & { __tempId: string }>;
  update: Array<Partial<T> & { id: string }>;
  delete: string[];
}

export interface EaColDef<TData = unknown> extends Omit<ColDef<TData>, "type"> {
  eaType?: ColumnTypeId;
  validator?: CellValidator;
}

export type EaColumnDefs<TData = unknown> = Array<
  EaColDef<TData> | ColGroupDef<TData>
>;

export interface CellPatch {
  rowId: string;
  field: string;
  prev: unknown;
  next: unknown;
}

export interface HistoryEntry {
  label: string;
  patches: CellPatch[];
}

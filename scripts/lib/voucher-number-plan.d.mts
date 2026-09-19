// `voucher-number-plan.mjs` нь plain JS (production-д tsx байхгүй байж
// болзошгүй тул script нь TS импортлохгүй) — тестээс төрөлтэй дуудахын тулд
// зарлалыг энд тусад нь бичнэ.

export type JournalModuleKey =
  | "gl"
  | "cash"
  | "fx"
  | "ar"
  | "ap"
  | "inv"
  | "cost"
  | "fa"
  | "proc"
  | "payroll"
  | "vat";

export const MODULE_CODES: Record<JournalModuleKey, string>;

export interface PendingVoucher {
  id: string;
  organizationId: string;
  /** YYYY-MM-DD */
  date: string;
  externalRef?: string | null;
  reversalOfVoucherId?: string | null;
}

export interface UsedDocumentNo {
  organizationId: string;
  documentNo: string | null;
}

export interface VoucherNumberUpdate {
  id: string;
  documentNo: string;
}

export interface VoucherNumberCounter {
  organizationId: string;
  scope: string;
  value: number;
}

export interface VoucherNumberPlan {
  updates: VoucherNumberUpdate[];
  counters: VoucherNumberCounter[];
  byModule: Map<JournalModuleKey, number>;
}

export function scopeOf(moduleKey: string, date: string): string;
export function formatNo(scope: string, seq: number): string;
export function moduleFromExternalRef(
  ref: string | null | undefined
): JournalModuleKey | null;
export function inheritReversalModules(
  vouchers: PendingVoucher[],
  moduleById: Map<string, JournalModuleKey>
): Map<string, JournalModuleKey>;
export function planVoucherNumbers(input: {
  vouchers: PendingVoucher[];
  moduleById?: Map<string, JournalModuleKey>;
  usedDocumentNos?: UsedDocumentNo[];
}): VoucherNumberPlan;

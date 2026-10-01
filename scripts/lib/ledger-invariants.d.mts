// `ledger-invariants.mjs` нь plain JS (production-д tsx байхгүй байж болзошгүй) —
// тест болон апп-аас төрөлтэй дуудахын тулд зарлалыг энд тусад нь бичнэ.
import type { Sql } from "postgres";

export const LEDGER_TRIGGER_NAMES: readonly string[];
export const LEDGER_CONSTRAINT_NAME: string;
export const IMBALANCED_VOUCHERS_SQL: string;
export const DUAL_SIDED_LINES_SQL: string;

export interface LedgerInvariantPlan {
  constraint: boolean;
  balanceTriggers: boolean;
  protectTrigger: boolean;
  warnings: string[];
}

export function planLedgerInvariants(counts: {
  imbalancedVouchers: number;
  dualSidedLines: number;
}): LedgerInvariantPlan;

export const LEDGER_INVARIANT_GROUPS: readonly {
  key: "constraint" | "balanceTriggers" | "protectTrigger";
  label: string;
  functionSql?: string;
  triggers?: readonly string[];
}[];

export interface LedgerInvariantStatus {
  triggers: number;
  expectedTriggers: number;
  drXorCr: boolean;
}

export function readLedgerInvariantStatus(sql: Sql): Promise<LedgerInvariantStatus>;

export function applyLedgerInvariants(
  sql: Sql,
  log?: (line: string) => void
): Promise<{ failures: number; skipped: number; status: LedgerInvariantStatus | null }>;

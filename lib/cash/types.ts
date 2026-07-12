export type CashAccountView = {
  id: string;
  name: string;
  accountType: string;
  bankName: string | null;
  accountNumber: string | null;
  currency: string;
  glAccountNumber: string;
  openingBalance: number;
  isActive: boolean;
  balance: number;
};

export type CashHealthStatus =
  | "balanced"
  | "negative"
  | "cash-gl-diff"
  | "bank-cash-diff"
  | "no-statement"
  | "missing-rate"
  | "stale-statement";

export type CashHealthRow = {
  id: string;
  accountName: string;
  accountType: string;
  currency: string;
  isActive: boolean;
  openingBalance: number;
  receipts: number;
  payments: number;
  cashBalance: number;
  cashBalanceMnt: number | null;
  glBalance: number;
  bankBalance: number | null;
  bankBalanceDate: string | null;
  cashToGlDifference: number | null;
  bankToCashDifference: number | null;
  status: CashHealthStatus;
  actionLabel: string;
  actionHref: string;
  explanation: string;
  negativeTrigger:
    | {
        date: string;
        documentNo: string;
        description: string;
        amount: number;
        balanceAfter: number;
      }
    | null;
};

export type CashDocumentView = {
  id: string;
  documentNo: string;
  documentType: string;
  date: string;
  fromCashAccountId: string | null;
  fromAccountName: string | null;
  toCashAccountId: string | null;
  toAccountName: string | null;
  counterAccountNumber: string | null;
  cashFlowCode: string | null;
  counterparty: string | null;
  description: string;
  amount: number;
  currency: string;
  /** 0 = rate unknown (GL-derived FX draft awaiting a rate before posting). */
  exchangeRate: number;
  /** MNT value — for MNT documents identical to `amount`. */
  baseAmount: number;
  status: string;
  voucherId: string | null;
  /** Set when the document was auto-derived from a GL voucher. */
  sourceVoucherId: string | null;
};

export type CashGlAccountOption = {
  number: string;
  name: string;
};

export type CashFlowOption = {
  code: string;
  name: string;
};

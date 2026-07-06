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


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
  /** S8 мөнгөн гүйлгээний ангилал — МГ код. */
  cashFlowCode: string | null;
  /** МГ нэр — segment_values(8)-ээс; код байхгүй/олдохгүй бол null. */
  cashFlowName: string | null;
  /** Харилцагчийн нэр (бүртгэлтэй бол бүртгэлийн нэр, үгүй бол чөлөөт текст). */
  counterparty: string | null;
  /** Харилцагчийн бүртгэлийн холбоос. */
  counterpartyId: string | null;
  /** Харилцагчийн код (counterparties.code); холбоосгүй / код оноогоогүй бол null. */
  counterpartyCode: string | null;
  /** Мөнгөн хөрөнгийн дансны GL код (шилжүүлэгт "эх → хүлээн авах"). */
  cashAccountGlNumber: string;
  description: string;
  amount: number;
  currency: string;
  /** 0 = rate unknown (GL-derived FX draft awaiting a rate before posting). */
  exchangeRate: number;
  /** MNT value — for MNT documents identical to `amount`. */
  baseAmount: number;
  status: string;
  voucherId: string | null;
  /** Холбогдсон GL журналын дугаар (§2a) — хуучин бичилтэд null. */
  voucherNo: string | null;
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

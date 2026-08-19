import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";

export type AccountClass =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense"
  | "other";

export interface AccountTotals {
  openDebit: number;
  openCredit: number;
  periodDebit: number;
  periodCredit: number;
  closeDebit: number;
  closeCredit: number;
}

export interface BalanceRow {
  activeKey: string;
  segmentParts: Record<number, string>;
  mainAccount: string;
  name: string;
  cls: AccountClass;
  totals: AccountTotals;
}

const EPSILON = 0.01;

export function isBalanced(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON;
}

// Мөнгөн дүнгийн НЭГДСЭН формат: тогтмол 2 орон, сөрөгт жинхэнэ хасах
// тэмдэг (U+2212 — hyphen-ээс өргөн, тоотой ижил өндөртэй типографийн
// стандарт). parseMntInput энэ тэмдгийг буцааж таньдаг (round-trip).
export const fmtMnt = (n: number): string => {
  const formatted = Math.abs(n).toLocaleString("mn-MN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `−${formatted}` : formatted;
};

// Journal data stores accountNumber as a 10-segment dotted string.
// parts[i-1] holds segment i. Inactive segments default to 0-padded on write.
export function extractSegmentParts(accountNumber: string): Record<number, string> {
  const result: Record<number, string> = {};
  const parts = accountNumber.split(".");
  if (parts.length === 10) {
    for (let i = 1; i <= 10; i++) result[i] = parts[i - 1] ?? "";
  } else if (parts.length === 1 && /^\d{8}$/.test(accountNumber)) {
    result[3] = accountNumber;
  }
  return result;
}

export function extractMainAccount(accountNumber: string): string {
  const parts = accountNumber.split(".");
  if (parts.length === 10) return parts[2] ?? accountNumber;
  if (parts.length === 1) return accountNumber;
  for (const p of parts) {
    if (/^\d{8}$/.test(p)) return p;
  }
  return accountNumber;
}

// Active key drops inactive segments — entries differing only by inactive
// segments aggregate into the same bucket (read behaviour = "all").
export function getActiveKey(accountNumber: string, activeSegIds: number[]): string {
  const parts = accountNumber.split(".");
  if (parts.length !== 10) return accountNumber;
  return activeSegIds.map((id) => parts[id - 1] ?? "").join(".");
}

export function getAccountClass(mainAccount: string): AccountClass {
  switch (mainAccount.charAt(0)) {
    case "1":
    case "2":
      return "asset";
    case "3":
      return "liability";
    case "4":
      return "equity";
    case "5":
      return "revenue";
    case "6":
    case "7":
    case "8":
      return "expense";
    default:
      return "other";
  }
}

export function resolveAccountName(
  mainAccount: string,
  accounts: ChartOfAccount[],
): string {
  const found = accounts.find((a) => a.number === mainAccount);
  return found?.name ?? "";
}

export function aggregateBalances(
  vouchers: JournalVoucherWithLines[],
  accounts: ChartOfAccount[],
  activeSegIds: number[],
  appliedFrom: string,
  appliedTo: string,
): BalanceRow[] {
  const map: Record<
    string,
    {
      activeKey: string;
      openDebit: number;
      openCredit: number;
      periodDebit: number;
      periodCredit: number;
    }
  > = {};

  for (const v of vouchers) {
    const inPeriod = v.date >= appliedFrom && v.date <= appliedTo;
    const beforePeriod = v.date < appliedFrom;
    if (!inPeriod && !beforePeriod) continue;

    for (const l of v.lines) {
      const d = Number(l.debit);
      const c = Number(l.credit);
      const key = getActiveKey(l.accountNumber, activeSegIds);
      if (!map[key]) {
        map[key] = {
          activeKey: key,
          openDebit: 0,
          openCredit: 0,
          periodDebit: 0,
          periodCredit: 0,
        };
      }
      const t = map[key];
      if (beforePeriod) {
        t.openDebit += d;
        t.openCredit += c;
      } else {
        t.periodDebit += d;
        t.periodCredit += c;
      }
    }
  }

  const out: BalanceRow[] = [];
  for (const b of Object.values(map)) {
    const openNet = b.openDebit - b.openCredit;
    const closeNet = openNet + b.periodDebit - b.periodCredit;

    const totals: AccountTotals = {
      openDebit: openNet > 0 ? openNet : 0,
      openCredit: openNet < 0 ? -openNet : 0,
      periodDebit: b.periodDebit,
      periodCredit: b.periodCredit,
      closeDebit: closeNet > 0 ? closeNet : 0,
      closeCredit: closeNet < 0 ? -closeNet : 0,
    };

    const keyParts = b.activeKey.split(".");
    const segmentParts: Record<number, string> = {};
    activeSegIds.forEach((id, idx) => {
      segmentParts[id] = keyParts[idx] ?? "";
    });

    const mainAccount = activeSegIds.includes(3)
      ? segmentParts[3] ?? ""
      : extractMainAccount(b.activeKey);

    out.push({
      activeKey: b.activeKey,
      segmentParts,
      mainAccount,
      name: resolveAccountName(mainAccount, accounts),
      cls: getAccountClass(mainAccount),
      totals,
    });
  }

  out.sort((a, b) => a.activeKey.localeCompare(b.activeKey));
  return out;
}

export interface PnL {
  revenue: number;
  expense: number;
  netIncome: number;
}

export function computeNetIncome(rows: BalanceRow[]): PnL {
  let revenue = 0;
  let expense = 0;
  for (const r of rows) {
    const pd = r.totals.periodDebit;
    const pc = r.totals.periodCredit;
    if (r.cls === "revenue") revenue += pc - pd;
    else if (r.cls === "expense") expense += pd - pc;
  }
  return { revenue, expense, netIncome: revenue - expense };
}

// Cash accounts: main accounts beginning with "11" (касс, банк).
export function isCashMainAccount(mainAccount: string): boolean {
  return mainAccount.startsWith("11");
}

export type CashFlowSection = "operating" | "investing" | "financing";

export function classifyCashFlow(contraMainAccount: string): CashFlowSection {
  const cls = getAccountClass(contraMainAccount);
  if (cls === "revenue" || cls === "expense") return "operating";
  if (cls === "asset") {
    // 1XXX current assets except cash → operating (working capital);
    // 2XXX non-current → investing.
    return contraMainAccount.startsWith("2") ? "investing" : "operating";
  }
  // liability + equity → financing
  return "financing";
}

export interface CashFlowLine {
  activeKey: string;
  segmentParts: Record<number, string>;
  mainAccount: string;
  name: string;
  section: CashFlowSection;
  amount: number; // positive = inflow, negative = outflow
}

export interface CashFlowReport {
  operating: CashFlowLine[];
  investing: CashFlowLine[];
  financing: CashFlowLine[];
  totals: { operating: number; investing: number; financing: number; net: number };
  cashOpenDebit: number;
  cashOpenCredit: number;
  cashCloseDebit: number;
  cashCloseCredit: number;
}

export function buildCashFlow(
  vouchers: JournalVoucherWithLines[],
  accounts: ChartOfAccount[],
  activeSegIds: number[],
  appliedFrom: string,
  appliedTo: string,
): CashFlowReport {
  const lineMap: Record<
    string,
    {
      activeKey: string;
      section: CashFlowSection;
      mainAccount: string;
      amount: number;
    }
  > = {};

  for (const v of vouchers) {
    if (v.date < appliedFrom || v.date > appliedTo) continue;

    const cashImpact = v.lines.reduce((acc, l) => {
      const main = extractMainAccount(l.accountNumber);
      if (!isCashMainAccount(main)) return acc;
      return acc + Number(l.debit) - Number(l.credit);
    }, 0);

    if (Math.abs(cashImpact) <= EPSILON) continue;

    for (const l of v.lines) {
      const main = extractMainAccount(l.accountNumber);
      if (isCashMainAccount(main)) continue;

      // Contra cash flow: Dr to contra means cash went out to contra;
      // Cr to contra means cash came in from contra.
      const flow = Number(l.credit) - Number(l.debit);
      if (Math.abs(flow) <= EPSILON) continue;

      const key = getActiveKey(l.accountNumber, activeSegIds);
      const section = classifyCashFlow(main);

      if (!lineMap[key]) {
        lineMap[key] = {
          activeKey: key,
          section,
          mainAccount: main,
          amount: 0,
        };
      }
      lineMap[key].amount += flow;
    }
  }

  const lines: CashFlowLine[] = Object.values(lineMap)
    .filter((b) => Math.abs(b.amount) > EPSILON)
    .map((b) => {
      const keyParts = b.activeKey.split(".");
      const segmentParts: Record<number, string> = {};
      activeSegIds.forEach((id, idx) => {
        segmentParts[id] = keyParts[idx] ?? "";
      });
      return {
        activeKey: b.activeKey,
        segmentParts,
        mainAccount: b.mainAccount,
        name: resolveAccountName(b.mainAccount, accounts),
        section: b.section,
        amount: b.amount,
      };
    });

  lines.sort((a, b) => a.activeKey.localeCompare(b.activeKey));

  const operating = lines.filter((l) => l.section === "operating");
  const investing = lines.filter((l) => l.section === "investing");
  const financing = lines.filter((l) => l.section === "financing");
  const sumOf = (arr: CashFlowLine[]) => arr.reduce((s, l) => s + l.amount, 0);
  const totals = {
    operating: sumOf(operating),
    investing: sumOf(investing),
    financing: sumOf(financing),
    net: 0,
  };
  totals.net = totals.operating + totals.investing + totals.financing;

  // Cash account opening/closing balances
  let cashOpenD = 0;
  let cashOpenC = 0;
  let cashCloseD = 0;
  let cashCloseC = 0;
  for (const v of vouchers) {
    const beforePeriod = v.date < appliedFrom;
    const upToEnd = v.date <= appliedTo;
    for (const l of v.lines) {
      const main = extractMainAccount(l.accountNumber);
      if (!isCashMainAccount(main)) continue;
      const d = Number(l.debit);
      const c = Number(l.credit);
      if (beforePeriod) {
        cashOpenD += d;
        cashOpenC += c;
      }
      if (upToEnd) {
        cashCloseD += d;
        cashCloseC += c;
      }
    }
  }
  // Net presentation (debit balance = cash on hand)
  const openNet = cashOpenD - cashOpenC;
  const closeNet = cashCloseD - cashCloseC;

  return {
    operating,
    investing,
    financing,
    totals,
    cashOpenDebit: openNet > 0 ? openNet : 0,
    cashOpenCredit: openNet < 0 ? -openNet : 0,
    cashCloseDebit: closeNet > 0 ? closeNet : 0,
    cashCloseCredit: closeNet < 0 ? -closeNet : 0,
  };
}

import { and, eq, inArray } from "drizzle-orm";

import {
  GlDashboard,
  type GlAlerts,
  type GlClassSummary,
  type GlModuleFlowRow,
  type GlMonthTrendRow,
  type GlRecentVoucherRow,
  type GlTopAccountRow,
} from "@/components/gl/gl-dashboard";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { chartOfAccounts, journalVouchers } from "@/lib/db/schema";
import { extractMainAccount, getAccountClass } from "@/lib/reports/balances";

const round2 = (x: number) => Math.round(x * 100) / 100;

/** S9 модулийн тэмдэглэгээ — legacy (10 биш хэсэгтэй) кодыг GL гэж үзнэ. */
function sourceModuleOf(accountNumber: string): string {
  const parts = accountNumber.split(".");
  return parts.length === 10 && parts[8] ? parts[8] : "GL";
}

function monthShift(base: string, offset: number): string {
  const [year, month] = base.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}

/** Сарын эхний ба сүүлийн өдөр — drill-down холбоосуудад. */
function monthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

const MODULE_LABELS: Record<string, string> = {
  GL: "Гар журнал",
  CA: "Мөнгөн хөрөнгө",
  CO: "Өртөг",
  FA: "Үндсэн хөрөнгө",
};

export default async function GlDashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const month = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Ulaanbaatar" })
    .slice(0, 7);

  // Тайлангийн хуудастай ижил ачаалалт: журналууд мөрүүдтэйгээ + дансны мод.
  const [vouchers, accounts] = await Promise.all([
    db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.userId, userId),
        inArray(journalVouchers.status, ["draft", "posted", "reversed"])
      ),
      with: { lines: true },
      orderBy: (voucher, { desc }) => [desc(voucher.date), desc(voucher.createdAt)],
    }),
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.userId, userId),
        eq(chartOfAccounts.isEnabled, true)
      ),
    }),
  ]);
  const nameByMain = new Map(accounts.map((account) => [account.number, account.name]));

  // ── Нэгдсэн гүйлт: бүх нийлбэрийг нэг дамжилтаар ────────────────────────────
  let totalDebit = 0;
  let totalCredit = 0;
  // Ангиллын нийлбэрүүд (өссөн дүнгээр, posted)
  let assets = 0;
  let liabilities = 0;
  let equity = 0;
  let cumRevenue = 0;
  let cumExpense = 0;
  // Энэ сарын P&L
  let monthRevenue = 0;
  let monthExpense = 0;
  // Трэнд (сүүлийн 6 сар), топ данс, модулийн урсгал
  const trendMonths = Array.from({ length: 6 }, (_, i) => monthShift(month, i - 5));
  const trendMap = new Map<string, { debit: number; count: number }>(
    trendMonths.map((m) => [m, { debit: 0, count: 0 }])
  );
  const accountTurnover = new Map<string, number>();
  const moduleFlow = new Map<string, { count: number; debit: number }>();
  // Анхааруулга
  let draftCount = 0;
  let unbalancedDraftCount = 0;
  let reversedThisMonth = 0;

  for (const voucher of vouchers) {
    if (voucher.status === "draft") {
      draftCount += 1;
      let dr = 0;
      let cr = 0;
      for (const line of voucher.lines) {
        dr += Number(line.debit);
        cr += Number(line.credit);
      }
      if (Math.abs(dr - cr) > 0.01) unbalancedDraftCount += 1;
      continue;
    }
    // Сторно хийгдсэн эх журналыг НИЙЛБЭРТ ОРУУЛНА — түүний сторно журнал
    // (posted, Дт/Кт сольсон) хамт орж харилцан цуцлагдана. Тайлангийн
    // хуудас яг ийм дүрмээр ачаалдаг ("posted" + "reversed").
    if (voucher.status === "reversed" && voucher.date.startsWith(month))
      reversedThisMonth += 1;

    const inMonth = voucher.date.startsWith(month);
    const trendKey = voucher.date.slice(0, 7);
    const trendCell = trendMap.get(trendKey);
    let voucherDebit = 0;
    const modules = new Set<string>();

    for (const line of voucher.lines) {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      totalDebit += debit;
      totalCredit += credit;
      voucherDebit += debit;

      const main = extractMainAccount(line.accountNumber);
      const cls = getAccountClass(main);
      if (cls === "asset") assets += debit - credit;
      else if (cls === "liability") liabilities += credit - debit;
      else if (cls === "equity") equity += credit - debit;
      else if (cls === "revenue") {
        cumRevenue += credit - debit;
        if (inMonth) monthRevenue += credit - debit;
      } else if (cls === "expense") {
        cumExpense += debit - credit;
        if (inMonth) monthExpense += debit - credit;
      }

      if (inMonth) {
        accountTurnover.set(
          main,
          (accountTurnover.get(main) ?? 0) + debit + credit
        );
        modules.add(sourceModuleOf(line.accountNumber));
      }
    }

    if (trendCell) {
      trendCell.debit += voucherDebit;
      trendCell.count += 1;
    }
    if (inMonth) {
      // Журналыг гол эх сурвалжаар нь нэг удаа тоолно (GL биш тэмдэглэгээ
      // давамгайлна — жишээ нь кассын журналд counter GL мөр байдаг).
      const source =
        [...modules].find((entry) => entry !== "GL") ?? [...modules][0] ?? "GL";
      const cell = moduleFlow.get(source) ?? { count: 0, debit: 0 };
      cell.count += 1;
      cell.debit += voucherDebit;
      moduleFlow.set(source, cell);
    }
  }

  const classSummary: GlClassSummary = {
    assets: round2(assets),
    liabilities: round2(liabilities),
    // Эздийн өмчид өссөн дүнгийн цэвэр ашиг багтана — А = Ө + Э шалгалт
    // ингэж л тэнцэнэ.
    equity: round2(equity + cumRevenue - cumExpense),
    monthRevenue: round2(monthRevenue),
    monthExpense: round2(monthExpense),
    monthNetIncome: round2(monthRevenue - monthExpense),
  };

  const trend: GlMonthTrendRow[] = trendMonths.map((m) => ({
    month: m,
    debit: round2(trendMap.get(m)!.debit),
    count: trendMap.get(m)!.count,
  }));

  const topAccounts: GlTopAccountRow[] = [...accountTurnover.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([main, turnover]) => ({
      main,
      name: nameByMain.get(main) ?? "",
      turnover: round2(turnover),
    }));

  const moduleRows: GlModuleFlowRow[] = [...moduleFlow.entries()]
    .sort((a, b) => b[1].debit - a[1].debit)
    .map(([key, cell]) => ({
      key,
      module: MODULE_LABELS[key] ?? key,
      count: cell.count,
      debit: round2(cell.debit),
    }));

  const alerts: GlAlerts = {
    draftCount,
    unbalancedDraftCount,
    reversedThisMonth,
  };

  const recent: GlRecentVoucherRow[] = vouchers.slice(0, 10).map((voucher) => {
    const modules = new Set<string>();
    const mains: string[] = [];
    for (const line of voucher.lines) {
      modules.add(sourceModuleOf(line.accountNumber));
      const main = extractMainAccount(line.accountNumber);
      if (main && !mains.includes(main)) mains.push(main);
    }
    const sourceKey =
      [...modules].find((entry) => entry !== "GL") ?? [...modules][0] ?? "GL";
    return {
      id: voucher.id,
      date: voucher.date,
      description: voucher.description,
      module: MODULE_LABELS[sourceKey] ?? sourceKey,
      accounts:
        mains.slice(0, 3).join(", ") +
        (mains.length > 3 ? ` +${mains.length - 3}` : ""),
      lineCount: voucher.lines.length,
      amount: round2(
        voucher.lines.reduce((sum, line) => sum + Number(line.debit), 0)
      ),
      status: voucher.status,
    };
  });

  const postedCount = vouchers.filter((v) => v.status === "posted").length;

  return (
    <GlDashboard
      month={month}
      postedCount={postedCount}
      accountCount={accounts.length}
      totalDebit={round2(totalDebit)}
      totalCredit={round2(totalCredit)}
      classSummary={classSummary}
      trend={trend}
      topAccounts={topAccounts}
      moduleRows={moduleRows}
      alerts={alerts}
      recent={recent}
      monthStart={monthRange(month).start}
      monthEnd={monthRange(month).end}
    />
  );
}

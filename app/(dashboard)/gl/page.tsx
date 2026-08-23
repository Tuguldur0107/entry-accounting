// П28 үргэлжлэл — GL хяналтын самбарын нэгтгэл СЕРВЕР талд:
//   • ваучер-түвшний бүх үзүүлэлт (Дт/Кт, ангиллын нөлөө, трэнд, модулийн
//     урсгал, drill индекс) — loadVoucherSummaries-ийн SQL GROUP BY-гаас,
//     мөрүүд JS-д ачаалагдахгүй
//   • сарын топ данс — loadBalanceRowsFast-ийн period нийлбэрээс
//     (snapshot + SQL delta)

import { and, eq } from "drizzle-orm";

import {
  GlDashboard,
  type GlAlerts,
  type GlDraftItem,
  type GlDrillVoucher,
  type GlClassSummary,
  type GlModuleFlowRow,
  type GlMonthTrendRow,
  type GlRecentVoucherRow,
  type GlTopAccountRow,
} from "@/components/gl/gl-dashboard";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { db } from "@/lib/db";
import { chartOfAccounts } from "@/lib/db/schema";
import { loadBalanceRowsFast } from "@/lib/reports/period-balances";
import {
  loadVoucherSummaries,
  type VoucherSummary,
} from "@/lib/reports/voucher-summaries";
import { roundMoney as round2 } from "@/lib/arap/accounting";


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

/** Журналын гол эх сурвалж — GL биш тэмдэглэгээ давамгайлна. */
function drillSourceOf(voucher: VoucherSummary): string {
  return (
    voucher.modules.find((entry) => entry !== "GL") ?? voucher.modules[0] ?? "GL"
  );
}

export default async function GlDashboardPage() {
  const { orgId } = await getActiveOrg();

  // Самбарын сар = topbar-ийн периодын сонголтын зангуу сар.
  const month = (await getPeriodSelection()).periodCode;
  const { start: monthStart, end: monthEnd } = monthRange(month);

  const accounts = await db.query.chartOfAccounts.findMany({
    where: and(
      eq(chartOfAccounts.organizationId, orgId),
      eq(chartOfAccounts.isEnabled, true)
    ),
  });

  const [vouchers, monthRows] = await Promise.all([
    loadVoucherSummaries(orgId),
    // Энэ сарын идэвхтэй данс — үндсэн данс (S3) түвшний period эргэлт.
    loadBalanceRowsFast(orgId, monthStart, monthEnd, accounts, [3]),
  ]);

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
  // Трэнд (сүүлийн 6 сар), модулийн урсгал
  const trendMonths = Array.from({ length: 6 }, (_, i) => monthShift(month, i - 5));
  const trendMap = new Map<string, { debit: number; count: number }>(
    trendMonths.map((m) => [m, { debit: 0, count: 0 }])
  );
  const moduleFlow = new Map<string, { count: number; debit: number }>();
  // Анхааруулга
  let draftCount = 0;
  let unbalancedDraftCount = 0;
  let reversedThisMonth = 0;
  const draftItems: GlDraftItem[] = [];
  // Задаргааны индекс — журнал бүрийн компакт мэдээлэл (клиент шүүнэ).
  const drillVouchers: GlDrillVoucher[] = [];

  for (const voucher of vouchers) {
    if (voucher.status === "draft") {
      draftCount += 1;
      const unbalanced = Math.abs(voucher.debit - voucher.credit) > 0.01;
      if (unbalanced) unbalancedDraftCount += 1;
      // vouchers огноогоор desc эрэмбэтэй тул эхний 5 нь хамгийн шинэ нь.
      if (draftItems.length < 5)
        draftItems.push({
          id: voucher.id,
          date: voucher.date,
          description: voucher.description,
          amount: round2(voucher.debit),
          unbalanced,
        });
      drillVouchers.push({
        id: voucher.id,
        date: voucher.date,
        description: voucher.description,
        status: voucher.status,
        moduleKey: "GL",
        mains: [],
        lineCount: voucher.lineCount,
        debit: round2(voucher.debit),
        cls: { asset: 0, liability: 0, equity: 0, revenue: 0, expense: 0 },
      });
      continue;
    }
    // Буцаагдсан эх журналыг НИЙЛБЭРТ ОРУУЛНА — түүний буцаалтын журнал
    // (posted, Дт/Кт сольсон) хамт орж харилцан цуцлагдана. Тайлангийн
    // хуудас яг ийм дүрмээр ачаалдаг ("posted" + "reversed").
    if (voucher.status === "reversed" && voucher.date.startsWith(month))
      reversedThisMonth += 1;

    const inMonth = voucher.date.startsWith(month);
    const trendCell = trendMap.get(voucher.date.slice(0, 7));

    totalDebit += voucher.debit;
    totalCredit += voucher.credit;
    assets += voucher.cls.asset;
    liabilities += voucher.cls.liability;
    equity += voucher.cls.equity;
    cumRevenue += voucher.cls.revenue;
    cumExpense += voucher.cls.expense;
    if (inMonth) {
      monthRevenue += voucher.cls.revenue;
      monthExpense += voucher.cls.expense;
    }

    const drillSource = drillSourceOf(voucher);
    drillVouchers.push({
      id: voucher.id,
      date: voucher.date,
      description: voucher.description,
      status: voucher.status,
      moduleKey: drillSource,
      mains: voucher.mains,
      lineCount: voucher.lineCount,
      debit: round2(voucher.debit),
      cls: {
        asset: round2(voucher.cls.asset),
        liability: round2(voucher.cls.liability),
        equity: round2(voucher.cls.equity),
        revenue: round2(voucher.cls.revenue),
        expense: round2(voucher.cls.expense),
      },
    });

    if (trendCell) {
      trendCell.debit += voucher.debit;
      trendCell.count += 1;
    }
    if (inMonth) {
      // Журналыг гол эх сурвалжаар нь нэг удаа тоолно (GL биш тэмдэглэгээ
      // давамгайлна — жишээ нь кассын журналд counter GL мөр байдаг).
      const cell = moduleFlow.get(drillSource) ?? { count: 0, debit: 0 };
      cell.count += 1;
      cell.debit += voucher.debit;
      moduleFlow.set(drillSource, cell);
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

  const topAccounts: GlTopAccountRow[] = monthRows
    .map((row) => ({
      main: row.mainAccount,
      name: row.name,
      turnover: round2(row.totals.periodDebit + row.totals.periodCredit),
    }))
    .filter((row) => row.turnover > 0)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, 8);

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

  const recent: GlRecentVoucherRow[] = vouchers.slice(0, 10).map((voucher) => ({
    id: voucher.id,
    date: voucher.date,
    description: voucher.description,
    module: MODULE_LABELS[drillSourceOf(voucher)] ?? drillSourceOf(voucher),
    accounts:
      voucher.mains.slice(0, 3).join(", ") +
      (voucher.mains.length > 3 ? ` +${voucher.mains.length - 3}` : ""),
    lineCount: voucher.lineCount,
    amount: round2(voucher.debit),
    status: voucher.status,
  }));

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
      draftItems={draftItems}
      recent={recent}
      drillVouchers={drillVouchers}
      monthStart={monthStart}
      monthEnd={monthEnd}
    />
  );
}

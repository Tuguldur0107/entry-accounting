// Системийн үндсэн хяналтын самбар — нэвтэрсний дараа хамгийн эхэнд харагдана.
// Модуль тус бүрийн самбар өөрийн гүн задаргаатай; ЭНЭ хуудас нь зөвхөн
// БҮХ модулийн нэгдсэн зураглал + анхаарах зүйлс + хурдан үйлдлийг өгнө.
//
// Тооцооллын дүрэм бүрийг модулийн хуудаснуудтай ижил байлгасан:
//   • GL ангилал/баланс — extractMainAccount + getAccountClass (gl/page.tsx)
//   • Мөнгөн хөрөнгө   — calculateCashBalances, зөвхөн MNT актив данс (cash/page.tsx)
//   • AR/AP           — totalAmount − paidAmount, зөвхөн posted документ
//   • Буцаалт         — "posted" + "reversed" хамт тоологдож харилцан цуцлагдана

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  HomeDashboard,
  type HomeAging,
  type HomeAlert,
  type HomeClassSummary,
  type HomeKpi,
  type HomeModuleTile,
  type HomeRecentRow,
  type HomeQueueItem,
  type HomeTaxDeadline,
} from "@/components/dashboard/home-dashboard";
import { computeTaxDeadlines } from "@/lib/tax/calendar";
import { getActiveOrg } from "@/lib/auth";
import { calculateCashBalances } from "@/lib/cash/balances";
import { db } from "@/lib/db";
import {
  accountingPeriods,
  arApDocuments,
  bankStatementLines,
  bankStatements,
  cashAccounts,
  cashDocuments,
  chartOfAccounts,
  fixedAssets,
  inventoryMovements,
  journalVouchers,
} from "@/lib/db/schema";
import { getPeriodSelection } from "@/lib/periods/selection";
import { extractMainAccount, getAccountClass } from "@/lib/reports/balances";

const round2 = (x: number) => Math.round(x * 100) / 100;

export default async function HomePage() {
  const { orgId } = await getActiveOrg();
  const { periodCode, today } = await getPeriodSelection();

  const [
    vouchers,
    accounts,
    cashAccountRows,
    cashDocumentRows,
    arApRows,
    assetRows,
    movementRows,
    periodRows,
  ] = await Promise.all([
    db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.organizationId, orgId),
        inArray(journalVouchers.status, ["draft", "posted", "reversed"])
      ),
      with: { lines: true },
      orderBy: (voucher, { desc }) => [desc(voucher.date), desc(voucher.createdAt)],
    }),
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isEnabled, true)
      ),
    }),
    db.query.cashAccounts.findMany({ where: eq(cashAccounts.organizationId, orgId) }),
    db.query.cashDocuments.findMany({ where: eq(cashDocuments.organizationId, orgId) }),
    db.query.arApDocuments.findMany({
      where: eq(arApDocuments.organizationId, orgId),
      // П15: aging-ийн топ харилцагчийн төвлөрөлд нэр хэрэгтэй.
      with: { counterparty: { columns: { name: true } } },
    }),
    db.query.fixedAssets.findMany({ where: eq(fixedAssets.organizationId, orgId) }),
    db.query.inventoryMovements.findMany({
      where: eq(inventoryMovements.organizationId, orgId),
    }),
    db.query.accountingPeriods.findMany({
      where: eq(accountingPeriods.organizationId, orgId),
    }),
  ]);

  // Тулгагдаагүй банкны мөр — ажлын дарааллын тоолуур (зөвхөн count).
  const [bankUnmatchedRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bankStatementLines)
    .innerJoin(
      bankStatements,
      eq(bankStatementLines.statementId, bankStatements.id)
    )
    .where(
      and(
        eq(bankStatements.organizationId, orgId),
        isNull(bankStatementLines.cashDocumentId)
      )
    );
  const bankUnmatchedCount = bankUnmatchedRow?.n ?? 0;

  const nameByMain = new Map(accounts.map((a) => [a.number, a.name]));

  /* ── GL: ангиллын нийлбэр, Дт/Кт, ноорог ────────────────────────────────── */
  let totalDebit = 0;
  let totalCredit = 0;
  let assets = 0;
  let liabilities = 0;
  let equity = 0;
  let cumRevenue = 0;
  let cumExpense = 0;
  let monthRevenue = 0;
  let monthExpense = 0;
  let draftCount = 0;
  let unbalancedDraftCount = 0;
  let postedCount = 0;
  let monthVoucherCount = 0;

  for (const voucher of vouchers) {
    const inMonth = voucher.date.startsWith(periodCode);

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

    if (voucher.status === "posted") postedCount += 1;
    if (inMonth) monthVoucherCount += 1;

    for (const line of voucher.lines) {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      totalDebit += debit;
      totalCredit += credit;

      const cls = getAccountClass(extractMainAccount(line.accountNumber));
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
    }
  }

  const classSummary: HomeClassSummary = {
    assets: round2(assets),
    liabilities: round2(liabilities),
    // Өссөн дүнгийн цэвэр ашиг өмчид багтана — А = Ө + Э ингэж тэнцэнэ
    equity: round2(equity + cumRevenue - cumExpense),
    monthRevenue: round2(monthRevenue),
    monthExpense: round2(monthExpense),
    monthNetIncome: round2(monthRevenue - monthExpense),
  };

  /* ── Мөнгөн хөрөнгө: MNT актив дансны нийлбэр ────────────────────────────── */
  const balanceMap = calculateCashBalances(cashAccountRows, cashDocumentRows);
  const mntAccounts = cashAccountRows.filter(
    (a) => a.currency === "MNT" && a.isActive
  );
  const cashTotal = round2(
    mntAccounts.reduce((sum, a) => sum + (balanceMap.get(a.id) ?? 0), 0)
  );
  const fxAccountCount = cashAccountRows.filter(
    (a) => a.currency !== "MNT" && a.isActive
  ).length;

  /* ── П15: мөнгөн байрлалын 30 хоногийн явц (MNT идэвхтэй данс) ──────────── */
  // calculateCashBalances-тай ИЖИЛ дүрэм: зөвхөн posted, amount талбараар,
  // transfer нь гарах данснаас хасагдаж орох дансанд нэмэгдэнэ.
  const mntIds = new Set(mntAccounts.map((a) => a.id));
  const netByDate = new Map<string, number>();
  for (const doc of cashDocumentRows) {
    if (doc.status !== "posted") continue;
    const amount = Number(doc.amount);
    let net = 0;
    if (
      (doc.documentType === "receipt" || doc.documentType === "transfer") &&
      doc.toCashAccountId &&
      mntIds.has(doc.toCashAccountId)
    )
      net += amount;
    if (
      (doc.documentType === "payment" || doc.documentType === "transfer") &&
      doc.fromCashAccountId &&
      mntIds.has(doc.fromCashAccountId)
    )
      net -= amount;
    if (net !== 0) netByDate.set(doc.date, (netByDate.get(doc.date) ?? 0) + net);
  }
  const DAY_MS = 24 * 60 * 60 * 1000;
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const cashSeries: { date: string; value: number }[] = [];
  {
    // Өнөөдрөөс ухарч: өмнөх өдрийн үлдэгдэл = тухайн өдрийнх − өдрийн урсгал.
    let running = cashTotal;
    for (let index = 0; index < 30; index += 1) {
      const date = new Date(todayMs - index * DAY_MS).toISOString().slice(0, 10);
      cashSeries.unshift({ date, value: round2(running) });
      running -= netByDate.get(date) ?? 0;
    }
  }

  /* ── AR / AP: төлөгдөөгүй үлдэгдэл, хугацаа хэтэрсэн, aging (П15) ────────── */
  // Хэсэгчлэн төлөгдсөн (partially_paid) нэхэмжлэх мөн нээлттэй үлдэгдэлтэй
  // тул posted-той хамт тоологдоно.
  const OPEN_STATUSES = new Set(["posted", "partially_paid"]);
  let arOutstanding = 0;
  let apOutstanding = 0;
  let arOverdue = 0;
  let apOverdue = 0;
  let arApDraftCount = 0;
  const emptyAging = (): HomeAging => ({
    total: 0,
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61plus: 0,
    topName: null,
    topShare: 0,
  });
  const arAging = emptyAging();
  const apAging = emptyAging();
  const arByCounterparty = new Map<string, number>();
  const apByCounterparty = new Map<string, number>();

  for (const doc of arApRows) {
    if (doc.status === "draft") {
      arApDraftCount += 1;
      continue;
    }
    if (!OPEN_STATUSES.has(doc.status)) continue;
    const open = Number(doc.totalAmount) - Number(doc.paidAmount);
    if (open <= 0.01) continue;
    const overdueDays = Math.floor(
      (todayMs - new Date(`${doc.dueDate}T00:00:00Z`).getTime()) / DAY_MS
    );
    const isAr = doc.documentType.startsWith("ar_");
    const aging = isAr ? arAging : apAging;
    const byCounterparty = isAr ? arByCounterparty : apByCounterparty;
    aging.total += open;
    if (overdueDays <= 0) aging.current += open;
    else if (overdueDays <= 30) aging.d1_30 += open;
    else if (overdueDays <= 60) aging.d31_60 += open;
    else aging.d61plus += open;
    const name = doc.counterparty?.name ?? "?";
    byCounterparty.set(name, (byCounterparty.get(name) ?? 0) + open);
    if (isAr) {
      arOutstanding += open;
      if (overdueDays > 0) arOverdue += 1;
    } else {
      apOutstanding += open;
      if (overdueDays > 0) apOverdue += 1;
    }
  }
  for (const [aging, byCounterparty] of [
    [arAging, arByCounterparty],
    [apAging, apByCounterparty],
  ] as const) {
    aging.total = round2(aging.total);
    aging.current = round2(aging.current);
    aging.d1_30 = round2(aging.d1_30);
    aging.d31_60 = round2(aging.d31_60);
    aging.d61plus = round2(aging.d61plus);
    const top = [...byCounterparty.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && aging.total > 0) {
      aging.topName = top[0];
      aging.topShare = Math.round((top[1] / aging.total) * 100);
    }
  }

  /* ── П15: орлого/зардлын сүүлийн 6 сарын тренд ──────────────────────────── */
  const trendMonths: string[] = [];
  {
    const [year, month] = today.split("-").map(Number);
    for (let index = 5; index >= 0; index -= 1)
      trendMonths.push(
        new Date(Date.UTC(year, month - 1 - index, 1)).toISOString().slice(0, 7)
      );
  }
  const trendByMonth = new Map(
    trendMonths.map((code) => [code, { revenue: 0, expense: 0 }])
  );
  for (const voucher of vouchers) {
    if (voucher.status === "draft") continue;
    const slot = trendByMonth.get(voucher.date.slice(0, 7));
    if (!slot) continue;
    for (const line of voucher.lines) {
      const cls = getAccountClass(extractMainAccount(line.accountNumber));
      if (cls === "revenue")
        slot.revenue += Number(line.credit) - Number(line.debit);
      else if (cls === "expense")
        slot.expense += Number(line.debit) - Number(line.credit);
    }
  }
  const trend = trendMonths.map((code) => ({
    month: code,
    revenue: round2(trendByMonth.get(code)!.revenue),
    expense: round2(trendByMonth.get(code)!.expense),
  }));

  const kpi: HomeKpi = {
    cash: { total: cashTotal, series: cashSeries },
    arAging,
    apAging,
    trend,
  };

  /* ── Үндсэн хөрөнгө, Бараа материал ──────────────────────────────────────── */
  const activeAssets = assetRows.filter((a) => a.status === "active");
  const assetCost = round2(
    activeAssets.reduce((sum, a) => sum + Number(a.cost), 0)
  );
  const draftAssetCount = assetRows.filter((a) => a.status === "draft").length;
  const draftMovementCount = movementRows.filter((m) => m.status === "draft").length;
  const postedMovementCount = movementRows.filter(
    (m) => m.status === "posted" && m.date.startsWith(periodCode)
  ).length;

  /* ── Период ──────────────────────────────────────────────────────────────── */
  const currentPeriod = periodRows.find((p) => p.code === periodCode);
  const periodStatus: "open" | "closed" | "missing" = currentPeriod
    ? (currentPeriod.status as "open" | "closed")
    : "missing";

  /* ── Модулийн хавтангууд ─────────────────────────────────────────────────── */
  const modules: HomeModuleTile[] = [
    {
      key: "gl",
      label: "Ерөнхий журнал",
      href: "/gl",
      value: `${postedCount}`,
      valueLabel: "бичигдсэн журнал",
      note:
        draftCount > 0
          ? `${draftCount} ноорог хүлээгдэж байна`
          : `${monthVoucherCount} бичилт · энэ тайлант үе`,
      tone: unbalancedDraftCount > 0 ? "danger" : "default",
    },
    {
      key: "cash",
      label: "Мөнгөн хөрөнгө",
      href: "/cash",
      value: cashTotal,
      valueLabel: "MNT үлдэгдэл",
      note:
        fxAccountCount > 0
          ? `${mntAccounts.length} MNT · ${fxAccountCount} валют данс`
          : `${mntAccounts.length} данс`,
      tone: cashTotal < 0 ? "danger" : "default",
    },
    {
      key: "receivables",
      label: "Авлага",
      href: "/receivables",
      value: round2(arOutstanding),
      valueLabel: "төлөгдөөгүй",
      note: arOverdue > 0 ? `${arOverdue} хугацаа хэтэрсэн` : "хугацаа хэтэрсэнгүй",
      tone: arOverdue > 0 ? "warning" : "default",
    },
    {
      key: "payables",
      label: "Өглөг",
      href: "/payables",
      value: round2(apOutstanding),
      valueLabel: "төлөгдөөгүй",
      note: apOverdue > 0 ? `${apOverdue} хугацаа хэтэрсэн` : "хугацаа хэтэрсэнгүй",
      tone: apOverdue > 0 ? "warning" : "default",
    },
    {
      key: "inventory",
      label: "Бараа материал",
      href: "/inventory",
      value: `${postedMovementCount}`,
      valueLabel: "хөдөлгөөн · энэ тайлант үе",
      note: draftMovementCount > 0 ? `${draftMovementCount} ноорог` : "ноорог алга",
      tone: draftMovementCount > 0 ? "warning" : "default",
    },
    {
      key: "fa",
      label: "Үндсэн хөрөнгө",
      href: "/fa",
      value: assetCost,
      valueLabel: `${activeAssets.length} хөрөнгийн өртөг`,
      note: draftAssetCount > 0 ? `${draftAssetCount} ноорог карт` : "бүгд активчилсан",
      tone: draftAssetCount > 0 ? "warning" : "default",
    },
  ];

  /* ── Анхаарах шаардлагатай ───────────────────────────────────────────────── */
  const alerts: HomeAlert[] = [];
  if (unbalancedDraftCount > 0)
    alerts.push({
      tone: "danger",
      title: `${unbalancedDraftCount} ноорог журнал тэнцэхгүй`,
      detail: "Дебет ≠ Кредит — бичихээс өмнө засна.",
      href: "/gl/journal",
      action: "Журнал руу",
    });
  if (draftCount > 0)
    alerts.push({
      tone: "warning",
      title: `${draftCount} ноорог журнал хүлээгдэж байна`,
      detail: "Ноорог нь тайланд ороогүй — шалгаад бичнэ.",
      href: "/gl/journal",
      action: "Журнал руу",
    });
  if (periodStatus === "missing")
    alerts.push({
      tone: "warning",
      title: `${periodCode} тайлант үе үүсээгүй`,
      detail: "Тайлант үе үүсгэвэл хаалт, бичилтийн хяналт бүрэн ажиллана.",
      href: "/settings/periods",
      action: "Тайлант үе рүү",
    });
  if (periodStatus === "closed")
    alerts.push({
      tone: "default",
      title: `${periodCode} тайлант үе хаагдсан`,
      detail: "Хаагдсан тайлант үед шинэ бичилт хийхгүй.",
      href: "/settings/periods",
      action: "Тайлант үе рүү",
    });
  if (arOverdue > 0)
    alerts.push({
      tone: "warning",
      title: `${arOverdue} авлагын хугацаа хэтэрсэн`,
      detail: "Төлөгдөх хугацаа өнгөрсөн нэхэмжлэл.",
      href: "/receivables/documents",
      action: "Авлага руу",
    });
  if (apOverdue > 0)
    alerts.push({
      tone: "warning",
      title: `${apOverdue} өглөгийн хугацаа хэтэрсэн`,
      detail: "Төлөх хугацаа өнгөрсөн нэхэмжлэх.",
      href: "/payables/documents",
      action: "Өглөг руу",
    });
  if (arApDraftCount > 0)
    alerts.push({
      tone: "default",
      title: `${arApDraftCount} ноорог нэхэмжлэл`,
      detail: "Авлага/өглөгийн ноорог документ.",
      href: "/receivables/documents",
      action: "Харах",
    });
  if (draftMovementCount > 0)
    alerts.push({
      tone: "default",
      title: `${draftMovementCount} ноорог барааны хөдөлгөөн`,
      detail: "Бичигдээгүй хөдөлгөөн өртөгт ороогүй.",
      href: "/inventory/movements",
      action: "Хөдөлгөөн руу",
    });

  /* ── Сүүлийн бичилтүүд ───────────────────────────────────────────────────── */
  const recent: HomeRecentRow[] = vouchers.slice(0, 8).map((voucher) => {
    const mains: string[] = [];
    let amount = 0;
    for (const line of voucher.lines) {
      amount += Number(line.debit);
      const main = extractMainAccount(line.accountNumber);
      if (main && !mains.includes(main)) mains.push(main);
    }
    return {
      id: voucher.id,
      date: voucher.date,
      description: voucher.description,
      accounts:
        mains
          .slice(0, 2)
          .map((m) => nameByMain.get(m) ?? m)
          .join(", ") + (mains.length > 2 ? ` +${mains.length - 2}` : ""),
      amount: round2(amount),
      status: voucher.status,
    };
  });

  // Ажлын дараалал — exception-first: анхаарал шаардсаныг л үзүүлнэ,
  // тоо нь 0 бол карт гарахгүй (Сар хаалт үргэлж харагдана).
  const cashDraftCount = cashDocumentRows.filter(
    (doc) => doc.status === "draft"
  ).length;
  const queueCandidates: HomeQueueItem[] = [
    {
      key: "gl-drafts",
      label: "Ноорог журнал батлагдахыг хүлээж байна",
      count: draftCount,
      href: "/gl/journal",
      icon: "journal",
    },
    {
      key: "bank-unmatched",
      label: "Тулгагдаагүй банкны мөр",
      count: bankUnmatchedCount,
      href: "/cash/statements",
      icon: "bank",
    },
    {
      key: "arap-drafts",
      label: "Ноорог АР/АП баримт",
      count: arApDraftCount,
      href: "/receivables/documents",
      icon: "document",
    },
    {
      key: "cash-drafts",
      label: "Ноорог кассын баримт",
      count: cashDraftCount,
      href: "/cash/transactions",
      icon: "movement",
    },
    {
      key: "inv-drafts",
      label: "Ноорог бараа хөдөлгөөн",
      count: draftMovementCount,
      href: "/inventory/movements",
      icon: "inventory",
    },
    {
      key: "fa-drafts",
      label: "Ноорог хөрөнгийн карт",
      count: draftAssetCount,
      href: "/fa/assets",
      icon: "fixedAsset",
    },
    {
      key: "overdue-ar",
      label: "Хугацаа хэтэрсэн авлага",
      count: arOverdue,
      href: "/receivables/documents",
      icon: "warning",
    },
  ];
  const queue = queueCandidates.filter((item) => item.count > 0);

  // Татварын хуанли: НӨАТ/ХАОАТ-д системд мөрдөгддөг журналын marker бий
  // (vat-settlement:YYYY-MM, payroll:YYYY-MM) — "журнал үүссэн үү" төлөвийг
  // аль хэдийн ачаалсан vouchers жагсаалтаас шууд харна.
  const taxDeadlines: HomeTaxDeadline[] = computeTaxDeadlines(today).map(
    (deadline) => {
      const marker =
        deadline.key === "vat"
          ? `vat-settlement:${deadline.period}`
          : deadline.key === "pit"
            ? `payroll:${deadline.period}`
            : null;
      return {
        ...deadline,
        prepared: marker
          ? vouchers.some((voucher) => voucher.externalRef === marker)
          : null,
        href:
          deadline.key === "vat"
            ? `/vat?period=${deadline.period}`
            : deadline.key === "pit" || deadline.key === "si"
              ? "/payroll"
              : "/gl/reports",
      };
    }
  );

  return (
    <HomeDashboard
      periodCode={periodCode}
      periodStatus={periodStatus}
      totalDebit={round2(totalDebit)}
      totalCredit={round2(totalCredit)}
      accountCount={accounts.length}
      classSummary={classSummary}
      modules={modules}
      alerts={alerts}
      recent={recent}
      queue={queue}
      taxDeadlines={taxDeadlines}
      kpi={kpi}
    />
  );
}

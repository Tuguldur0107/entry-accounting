// Системийн үндсэн хяналтын самбар — нэвтэрсний дараа хамгийн эхэнд харагдана.
// Модуль тус бүрийн самбар өөрийн гүн задаргаатай; ЭНЭ хуудас нь зөвхөн
// БҮХ модулийн нэгдсэн зураглал + анхаарах зүйлс + хурдан үйлдлийг өгнө.
//
// Тооцооллын дүрэм бүрийг модулийн хуудаснуудтай ижил байлгасан:
//   • GL ангилал/баланс — extractMainAccount + getAccountClass (gl/page.tsx)
//   • Мөнгөн хөрөнгө   — calculateCashBalances, зөвхөн MNT актив данс (cash/page.tsx)
//   • AR/AP           — totalAmount − paidAmount, зөвхөн posted документ
//   • Буцаалт         — "posted" + "reversed" хамт тоологдож харилцан цуцлагдана

import { and, eq, inArray } from "drizzle-orm";

import {
  HomeDashboard,
  type HomeAlert,
  type HomeClassSummary,
  type HomeModuleTile,
  type HomeRecentRow,
  type HomeTaxDeadline,
} from "@/components/dashboard/home-dashboard";
import { computeTaxDeadlines } from "@/lib/tax/calendar";
import { getActiveOrg } from "@/lib/auth";
import { calculateCashBalances } from "@/lib/cash/balances";
import { db } from "@/lib/db";
import {
  accountingPeriods,
  arApDocuments,
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
    db.query.arApDocuments.findMany({ where: eq(arApDocuments.organizationId, orgId) }),
    db.query.fixedAssets.findMany({ where: eq(fixedAssets.organizationId, orgId) }),
    db.query.inventoryMovements.findMany({
      where: eq(inventoryMovements.organizationId, orgId),
    }),
    db.query.accountingPeriods.findMany({
      where: eq(accountingPeriods.organizationId, orgId),
    }),
  ]);

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

  /* ── AR / AP: төлөгдөөгүй үлдэгдэл ба хугацаа хэтэрсэн ──────────────────── */
  let arOutstanding = 0;
  let apOutstanding = 0;
  let arOverdue = 0;
  let apOverdue = 0;
  let arApDraftCount = 0;

  for (const doc of arApRows) {
    if (doc.status === "draft") {
      arApDraftCount += 1;
      continue;
    }
    if (doc.status !== "posted") continue;
    const open = Number(doc.totalAmount) - Number(doc.paidAmount);
    if (open <= 0.01) continue;
    if (doc.documentType.startsWith("ar_")) {
      arOutstanding += open;
      if (doc.dueDate < today) arOverdue += 1;
    } else {
      apOutstanding += open;
      if (doc.dueDate < today) apOverdue += 1;
    }
  }

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
      taxDeadlines={taxDeadlines}
    />
  );
}

import { and, desc, eq, gt, lte } from "drizzle-orm";

import { CashDashboard } from "@/components/cash/cash-dashboard";
import { getActiveOrg } from "@/lib/auth";
import {
  findCashSnapshotAnchor,
  loadCashBalancesFast,
  sumCashMovements,
} from "@/lib/cash/period-balances";
import { loadMainBalancesFast } from "@/lib/reports/period-balances";
import {
  computeCashCoreRows,
  type CashCoreRow,
} from "@/lib/cash/reconciliation";
import type {
  CashAccountView,
  CashDocumentView,
  CashHealthRow,
  CashHealthStatus,
} from "@/lib/cash/types";
import { db } from "@/lib/db";
import {
  bankStatements,
  cashAccounts,
  cashDocuments,
  cashFxRevaluations,
} from "@/lib/db/schema";

function todayInUlaanbaatar() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

// Тулгалт хуудасны цөм статусыг самбарын нарийвчилсан төлөвт хөрвүүлнэ:
// сөрөг үлдэгдэл түрүүлж анхааруулна, "exception"-ыг аль тал зөрснөөр задална.
function classifyHealthStatus(core: CashCoreRow): CashHealthStatus {
  if (core.cashBalance < -0.01) return "negative";
  if (core.status === "exception") {
    if (
      core.cashToGlDifference != null &&
      Math.abs(core.cashToGlDifference) > 0.01
    )
      return "cash-gl-diff";
    return "bank-cash-diff";
  }
  return core.status;
}

function healthAction(status: CashHealthStatus) {
  switch (status) {
    case "negative":
      return {
        actionLabel: "Хасах болгосон гүйлгээг шалгах",
        actionHref: "/cash/transactions",
        explanation:
          "Дотоод cash бүртгэлийн зарлага орлогоос давсан байна. Эхний үлдэгдэл, дутуу орлого эсвэл буруу зарлагыг шалгана.",
      };
    case "cash-gl-diff":
      return {
        actionLabel: "Тулгалт дээр GL зөрүү шалгах",
        actionHref: "/cash/reconciliation",
        explanation:
          "Cash бүртгэл ба GL cash дансны үлдэгдэл зөрсөн байна. CashAccountId-тэй GL бичилт, буцаалт, гар аргаар хийсэн журнал шалгана.",
      };
    case "bank-cash-diff":
      return {
        actionLabel: "Хуулга ба бүртгэлийг тулгах",
        actionHref: "/cash/reconciliation",
        explanation:
          "Банкны хуулгын үлдэгдэл cash бүртгэлээс зөрсөн байна. Банкны шимтгэл, хүү, дутуу импорт, замд яваа гүйлгээг ангилна.",
      };
    case "no-statement":
      return {
        actionLabel: "Дансны хуулга импортлох",
        actionHref: "/cash/statements",
        explanation:
          "Энэ дансанд банкны хуулгын үлдэгдэл байхгүй тул bank-to-cash тулгалт бүрэн хийгдэхгүй.",
      };
    case "missing-rate":
      return {
        actionLabel: "Ханш татаж тэгшитгэх",
        actionHref: "/cash/reconciliation",
        explanation:
          "Валютын дансанд хаалтын ханш байхгүй тул MNT дүн болон GL-тэй тулгах боломжгүй.",
      };
    case "stale-statement":
      return {
        actionLabel: "Сүүлийн хуулга шинэчлэх",
        actionHref: "/cash/statements",
        explanation:
          "Хуулгын нотлох огноо өнөөдрийн байдлаас хуучин байна. Шинэ хуулга импортолж тулгалтаа шинэчилнэ.",
      };
    default:
      return {
        actionLabel: "Тэнцсэн",
        actionHref: "/cash/reconciliation",
        explanation:
          "Cash, GL болон банкны боломжит нотолгоо зөвшөөрөгдөх хязгаарт тэнцсэн байна.",
      };
  }
}

export default async function CashDashboardPage() {
  const { orgId } = await getActiveOrg();
  const asOf = todayInUlaanbaatar();

  const [accounts, documents, glBalances, statements, fxRevaluations] =
    await Promise.all([
    db.query.cashAccounts.findMany({
      where: eq(cashAccounts.organizationId, orgId),
      orderBy: (account, { asc }) => [asc(account.name)],
    }),
    // Зөвхөн СҮҮЛИЙН snapshot-оос ХОЙШХИ баримт (хаагдсан үеийнх snapshot-д
    // нэгтгэгдсэн; ноорог хаагдсан үед үлдэж чадахгүй). Үлдэгдэл, GL тал нь
    // доор snapshot + delta-гаар (loadCashBalancesFast / loadMainBalancesFast).
    (async () => {
      const anchor = await findCashSnapshotAnchor(orgId, asOf);
      return db.query.cashDocuments.findMany({
        where: and(
          eq(cashDocuments.organizationId, orgId),
          ...(anchor ? [gt(cashDocuments.date, anchor.endDate)] : [])
        ),
        with: { fromAccount: true, toAccount: true },
        orderBy: [desc(cashDocuments.date), desc(cashDocuments.createdAt)],
      });
    })(),
    // GL тал: ваучерыг JS-д ачаалахгүй — үндсэн дансаар snapshot + delta.
    loadMainBalancesFast(orgId, asOf),
    db.query.bankStatements.findMany({
      where: eq(bankStatements.organizationId, orgId),
      with: { lines: true },
    }),
    db.query.cashFxRevaluations.findMany({
      where: and(
        eq(cashFxRevaluations.organizationId, orgId),
        lte(cashFxRevaluations.valuationDate, asOf)
      ),
      orderBy: [
        desc(cashFxRevaluations.valuationDate),
        desc(cashFxRevaluations.createdAt),
      ],
    }),
  ]);

  // Данс бүрийн үлдэгдэл/зөрүү/статус — тулгалт хуудастай ХАМТЫН цөм
  // (өмнө нь хоёр хуудас тус тусдаа тооцоод зөрдөг байсан).
  // Кассын үлдэгдэл: snapshot + delta; бүх түүхийн орлого/зарлагын нийлбэр SQL-ээр.
  const [cashBalances, lifetimeFlows] = await Promise.all([
    loadCashBalancesFast(orgId, accounts, asOf),
    sumCashMovements(orgId, { lteDate: asOf }),
  ]);
  const coreRows = computeCashCoreRows({
    accounts,
    documents,
    vouchers: [],
    statements,
    fxRevaluations,
    asOf,
    cashBalances,
    glBalances,
  });

  const accountViews: CashAccountView[] = accounts.map((account) => ({
    ...account,
    openingBalance: Number(account.openingBalance),
    balance: coreRows.get(account.id)?.cashBalance ?? 0,
  }));
  const documentViews: CashDocumentView[] = documents.map((document) => ({
    id: document.id,
    documentNo: document.documentNo,
    documentType: document.documentType,
    date: document.date,
    fromCashAccountId: document.fromCashAccountId,
    fromAccountName: document.fromAccount?.name ?? null,
    toCashAccountId: document.toCashAccountId,
    toAccountName: document.toAccount?.name ?? null,
    counterAccountNumber: document.counterAccountNumber,
    cashFlowCode: document.cashFlowCode,
    counterparty: document.counterparty,
    description: document.description,
    amount: Number(document.amount),
    currency: document.currency,
    exchangeRate: Number(document.exchangeRate ?? 1),
    baseAmount: Number(document.baseAmount ?? document.amount),
    status: document.status,
    voucherId: document.voucherId,
    sourceVoucherId: document.sourceVoucherId,
  }));

  const mntAccountIds = new Set(
    accounts.filter((account) => account.currency === "MNT").map((account) => account.id)
  );
  const postedToday = documents.filter(
    (document) => document.status === "posted" && document.date === asOf
  );

  const todayReceipts = postedToday
    .filter(
      (document) =>
        document.documentType === "receipt" &&
        !!document.toCashAccountId &&
        mntAccountIds.has(document.toCashAccountId)
    )
    .reduce((sum, document) => sum + Number(document.amount), 0);
  const todayPayments = postedToday
    .filter(
      (document) =>
        document.documentType === "payment" &&
        !!document.fromCashAccountId &&
        mntAccountIds.has(document.fromCashAccountId)
    )
    .reduce((sum, document) => sum + Number(document.amount), 0);

  const chronologicalDocuments = [...documents]
    .filter((document) => document.status === "posted" && document.date <= asOf)
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return a.documentNo.localeCompare(b.documentNo);
    });

  const healthRows: CashHealthRow[] = accounts.map((account) => {
    // Сөрөг үлдэгдлийн анхны мөчийг snapshot-оос ХОЙШХИ баримтаас хайна
    // (хаагдсан үеийн сөрөг нь тэр үед нээлттэй байхад илэрсэн). Эхлэл =
    // үлдэгдэл − snapshot-оос хойшхи цэвэр хөдөлгөөн = snapshot-ын үлдэгдэл.
    const finalBalance = coreRows.get(account.id)?.cashBalance ?? 0;
    const postAnchorNet = chronologicalDocuments.reduce((sum, document) => {
      let effect = 0;
      if (document.toCashAccountId === account.id) effect += Number(document.amount);
      if (document.fromCashAccountId === account.id) effect -= Number(document.amount);
      return sum + effect;
    }, 0);
    let running = Math.round((finalBalance - postAnchorNet) * 100) / 100;
    const receipts = lifetimeFlows.get(account.id)?.inflow ?? 0;
    const payments = lifetimeFlows.get(account.id)?.outflow ?? 0;
    let negativeTrigger: CashHealthRow["negativeTrigger"] = null;

    for (const document of chronologicalDocuments) {
      let effect = 0;
      const amount = Number(document.amount);
      if (document.toCashAccountId === account.id) effect += amount;
      if (document.fromCashAccountId === account.id) effect -= amount;
      if (effect === 0) continue;
      running = Math.round((running + effect) * 100) / 100;
      if (!negativeTrigger && running < -0.01) {
        negativeTrigger = {
          date: document.date,
          documentNo: document.documentNo,
          description: document.description,
          amount: Math.abs(effect),
          balanceAfter: running,
        };
      }
    }

    const core = coreRows.get(account.id)!;
    const status = classifyHealthStatus(core);
    const action = healthAction(status);

    return {
      id: account.id,
      accountName: account.name,
      accountType: account.accountType,
      currency: account.currency,
      isActive: account.isActive,
      openingBalance: Number(account.openingBalance),
      receipts,
      payments,
      cashBalance: core.cashBalance,
      cashBalanceMnt: core.cashBalanceMnt,
      glBalance: core.glBalance,
      bankBalance: core.bankBalance,
      bankBalanceDate: core.bankBalanceDate,
      cashToGlDifference: core.cashToGlDifference,
      bankToCashDifference: core.bankToCashDifference,
      status,
      actionLabel: action.actionLabel,
      actionHref: action.actionHref,
      explanation: action.explanation,
      negativeTrigger,
    };
  });

  const activeHealthRows = healthRows.filter((row) => row.isActive);
  const issueCount = activeHealthRows.filter((row) => row.status !== "balanced").length;
  const negativeCount = activeHealthRows.filter((row) => row.status === "negative").length;

  return (
    <CashDashboard
      healthRows={healthRows}
      recentDocuments={documentViews.slice(0, 6)}
      summary={{
        totalMnt: accountViews
          .filter((account) => account.currency === "MNT" && account.isActive)
          .reduce((sum, account) => sum + account.balance, 0),
        todayReceipts,
        todayPayments,
        draftCount: documents.filter((document) => document.status === "draft")
          .length,
        issueCount,
        negativeCount,
      }}
    />
  );
}

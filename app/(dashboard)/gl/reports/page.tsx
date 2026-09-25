// П28 үргэлжлэл — тайлангийн нэгтгэл СЕРВЕР талд (snapshot + SQL delta).
//
// Муж/тайлангийн солилт бүр угаасаа server round-trip (PeriodFilter →
// router.refresh, HeaderReportSelect → router.replace) тул клиент талын
// aggregateBalances шаардлагагүй — сонгогдсон тайлан ЗӨВХӨН өөрийн
// хэрэгтэй өгөгдлийг ачаална, ваучерууд клиент рүү дамжихгүй:
//   • gl-balance       — activeSegIds түвшний BalanceRow[]
//   • balance-sheet    — үндсэн данс [3] түвшний BalanceRow[]; close-суурьтай
//                        тул from-оос үл хамаарч snapshot зангуу ажиллана
//   • income-statement — мөн [3] түвшний BalanceRow[] (period нийлбэр)
//   • cash-flow        — журнал бүрийн контра хослол шаардлагатай тул зөвхөн
//                        [from,to] доторх ваучерууд + кассын нээлт/хаалт
//                        [3] мөрүүдээс (cashNetsFromRows)

import { db } from "@/lib/db";
import {
  journalVouchers,
  chartOfAccounts,
  segmentConfigs,
  segmentValues,
  reportLineMappings,
} from "@/lib/db/schema";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { eq, and, gte, inArray, lte } from "drizzle-orm";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { cashNetsFromRows } from "@/lib/reports/balances";
import { loadBalanceRowsFast } from "@/lib/reports/period-balances";
import { loadVoucherCfCodes } from "@/lib/reports/cf-codes";
import { ReportsView, type ReportData } from "@/components/gl/reports-view";
import { computeEbalanceStatements } from "@/lib/reports/ebalance";

type SearchParams = Promise<{ start?: string; end?: string; report?: string }>;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { start, end, report } = await searchParams;
  const period = await getPeriodSelection();

  const from = start ?? period.from;
  const to = end ?? period.to;

  // Танигдаагүй утга (registry-д нэмэгдсэн ч view нь хараахан байхгүй шинэ
  // тайлан) хоосон дэлгэц биш Гүйлгээ баланс руу унана — хуучин клиент
  // талын fallback-тай ижил дүрэм.
  const reportType =
    report === "balance-sheet" ||
    report === "income-statement" ||
    report === "cash-flow" ||
    report === "ebalance"
      ? report
      : "gl-balance";

  const [accounts, rawSegConfigs, lineMappings, cfSegRows] = await Promise.all([
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.organizationId, orgId),
    }),
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.organizationId, orgId),
    }),
    db.query.reportLineMappings.findMany({
      where: and(
        eq(reportLineMappings.organizationId, orgId),
        inArray(reportLineMappings.reportType, [
          "balance-sheet",
          "income-statement",
          "cash-flow",
        ])
      ),
    }),
    // S8 = мөнгөн урсгалын код — CF mapping-ийн хоёр дахь хэмжигдэхүүн.
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.organizationId, orgId),
        eq(segmentValues.segmentId, 8),
        eq(segmentValues.isEnabled, true)
      ),
    }),
  ]);
  const balanceSheetMappings = lineMappings.filter(
    (m) => m.reportType === "balance-sheet"
  );
  const incomeStatementMappings = lineMappings.filter(
    (m) => m.reportType === "income-statement"
  );
  const cashFlowMappings = lineMappings.filter(
    (m) => m.reportType === "cash-flow"
  );
  const cfSegmentValues = cfSegRows
    // "0000" (бүх тэг) = кодгүй default — extractCfCode үүнийг хоосонд
    // тооцдог тул сонгуулбал хэзээ ч таарахгүй, жагсаалтад оруулахгүй.
    .filter((v) => !/^0*$/.test(v.code))
    .map((v) => ({ code: v.code, name: v.name }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const segConfigMap = new Map(rawSegConfigs.map((c) => [c.segmentId, c]));
  const activeSegIds = SEGMENT_DEFS
    .filter((def) => def.id === 3 || segConfigMap.get(def.id)?.isEnabled === true)
    .map((def) => def.id);

  let data: ReportData;
  if (reportType === "balance-sheet" || reportType === "income-statement") {
    // Байгууллагын түвшний тайлан — үндсэн данс (S3)-аар нэгтгэнэ.
    const rows = await loadBalanceRowsFast(orgId, from, to, accounts, [3]);
    data = { kind: reportType, rows };
  } else if (reportType === "ebalance") {
    // e-Balance маягт — БС/ОДТ-ийн [3] мөрүүд + МГТ-ийн ваучерууд, бүгд серверт
    // бодогдож 4 маягт л клиент рүү очно (lib/reports/ebalance.ts ЦЭВЭР, тесттэй).
    const [rows, vouchers, voucherCfCodes] = await Promise.all([
      loadBalanceRowsFast(orgId, from, to, accounts, [3]),
      db.query.journalVouchers.findMany({
        where: and(
          eq(journalVouchers.organizationId, orgId),
          inArray(journalVouchers.status, ["posted", "reversed"]),
          gte(journalVouchers.date, from),
          lte(journalVouchers.date, to)
        ),
        with: { lines: true },
      }),
      loadVoucherCfCodes(orgId),
    ]);
    const cashNets = cashNetsFromRows(rows);
    data = {
      kind: "ebalance",
      report: computeEbalanceStatements({
        rows,
        accounts,
        bsMappings: balanceSheetMappings,
        isMappings: incomeStatementMappings,
        cfMappings: cashFlowMappings,
        vouchers,
        voucherCfCodes: new Map(Object.entries(voucherCfCodes)),
        from,
        to,
        cashOpenNet: cashNets.openNet,
        cashCloseNet: cashNets.closeNet,
      }),
    };
  } else if (reportType === "cash-flow") {
    const [vouchers, mainRows, voucherCfCodes] = await Promise.all([
      db.query.journalVouchers.findMany({
        where: and(
          eq(journalVouchers.organizationId, orgId),
          inArray(journalVouchers.status, ["posted", "reversed"]),
          gte(journalVouchers.date, from),
          lte(journalVouchers.date, to)
        ),
        with: { lines: true },
      }),
      loadBalanceRowsFast(orgId, from, to, accounts, [3]),
      loadVoucherCfCodes(orgId),
    ]);
    const cashNets = cashNetsFromRows(mainRows);
    data = {
      kind: "cash-flow",
      vouchers,
      voucherCfCodes,
      cashOpenNet: cashNets.openNet,
      cashCloseNet: cashNets.closeNet,
    };
  } else {
    data = {
      kind: "gl-balance",
      rows: await loadBalanceRowsFast(orgId, from, to, accounts, activeSegIds),
    };
  }

  return (
    <ReportsView
      data={data}
      accounts={accounts}
      activeSegIds={activeSegIds}
      appliedFrom={from}
      appliedTo={to}
      balanceSheetMappings={balanceSheetMappings}
      incomeStatementMappings={incomeStatementMappings}
      cashFlowMappings={cashFlowMappings}
      cfSegmentValues={cfSegmentValues}
    />
  );
}

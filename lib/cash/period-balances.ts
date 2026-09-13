// Кассын дансны ХУРДАН үлдэгдэл уншигч (snapshot + delta) — lib/reports/
// period-balances.ts-ийн кассын хувилбар.
//
//   balance(asOf) = сүүлийн хаагдсан периодын snapshot (endDate ≤ asOf)
//                 + Σ posted баримт (endDate < date ≤ asOf)   — SQL GROUP BY
//   snapshot байхгүй бол: нээлтийн үлдэгдэл + Σ posted баримт (date ≤ asOf)
//
// Үр дүн нь calculateCashBalances(accounts, documents)-тай ЯГ ИЖИЛ (тест:
// tests/cash-period-balances.test.ts) — зөвхөн баримтыг JS-д ачаалдаггүй.
// Хаагдсан периодод бичилт хориотой (assertPeriodOpen) тул snapshot хуучирдаггүй.

import { and, desc, eq, gt, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accountingPeriods,
  cashAccountPeriodBalances,
  cashDocuments,
} from "@/lib/db/schema";

export type CashFlowSums = { inflow: number; outflow: number };

/**
 * Данс бүрийн posted баримтын орлого/зарлагын нийлбэр (дансны валютаар),
 * огнооны мужаар. Хилүүд бүгд сонголттой: gtDate/gteDate доод, lteDate дээд.
 */
export async function sumCashMovements(
  orgId: string,
  bounds: { gtDate?: string; gteDate?: string; lteDate?: string }
): Promise<Map<string, CashFlowSums>> {
  const base = [
    eq(cashDocuments.organizationId, orgId),
    eq(cashDocuments.status, "posted"),
  ];
  if (bounds.gtDate) base.push(gt(cashDocuments.date, bounds.gtDate));
  if (bounds.gteDate) base.push(gte(cashDocuments.date, bounds.gteDate));
  if (bounds.lteDate) base.push(lte(cashDocuments.date, bounds.lteDate));

  const [inflows, outflows] = await Promise.all([
    db
      .select({
        accountId: cashDocuments.toCashAccountId,
        total: sql<string>`coalesce(sum(${cashDocuments.amount}), 0)`,
      })
      .from(cashDocuments)
      .where(
        and(
          ...base,
          inArray(cashDocuments.documentType, ["receipt", "transfer"]),
          isNotNull(cashDocuments.toCashAccountId)
        )
      )
      .groupBy(cashDocuments.toCashAccountId),
    db
      .select({
        accountId: cashDocuments.fromCashAccountId,
        total: sql<string>`coalesce(sum(${cashDocuments.amount}), 0)`,
      })
      .from(cashDocuments)
      .where(
        and(
          ...base,
          inArray(cashDocuments.documentType, ["payment", "transfer"]),
          isNotNull(cashDocuments.fromCashAccountId)
        )
      )
      .groupBy(cashDocuments.fromCashAccountId),
  ]);

  const sums = new Map<string, CashFlowSums>();
  const entry = (id: string) => {
    const current = sums.get(id) ?? { inflow: 0, outflow: 0 };
    sums.set(id, current);
    return current;
  };
  for (const row of inflows)
    if (row.accountId) entry(row.accountId).inflow += Number(row.total);
  for (const row of outflows)
    if (row.accountId) entry(row.accountId).outflow += Number(row.total);
  return sums;
}

/** asOf-оос өмнө/тэнцүү дуусдаг, кассын snapshot-той хамгийн сүүлийн хаалттай период. */
export async function findCashSnapshotAnchor(orgId: string, asOf?: string) {
  const conditions = [
    eq(accountingPeriods.organizationId, orgId),
    eq(accountingPeriods.status, "closed"),
    sql`exists (
      select 1 from ${cashAccountPeriodBalances}
      where ${cashAccountPeriodBalances.organizationId} = ${accountingPeriods.organizationId}
        and ${cashAccountPeriodBalances.periodCode} = ${accountingPeriods.code}
    )`,
  ];
  if (asOf) conditions.push(lte(accountingPeriods.endDate, asOf));
  const [anchor] = await db
    .select({ code: accountingPeriods.code, endDate: accountingPeriods.endDate })
    .from(accountingPeriods)
    .where(and(...conditions))
    .orderBy(desc(accountingPeriods.endDate))
    .limit(1);
  return anchor ?? null;
}

/**
 * ЦЭВЭР (тесттэй): snapshot-ын үлдэгдэл (байхгүй бол нээлт) + delta урсгал.
 * Snapshot-ын дараа үүссэн данс snapshot-д байхгүй → нээлтээс эхэлнэ.
 */
export function mergeCashBalances(
  accounts: { id: string; openingBalance: string | number }[],
  snapshot: Map<string, number>,
  delta: Map<string, CashFlowSums>
): Map<string, number> {
  const balances = new Map<string, number>();
  for (const account of accounts) {
    const start = snapshot.get(account.id) ?? Number(account.openingBalance);
    const flow = delta.get(account.id);
    balances.set(
      account.id,
      Math.round((start + (flow?.inflow ?? 0) - (flow?.outflow ?? 0)) * 100) / 100
    );
  }
  return balances;
}

/**
 * Данс бүрийн үлдэгдэл (дансны валютаар) asOf-оор; asOf өгөөгүй бол бүх
 * posted баримт (calculateCashBalances-ийн "одоогийн үлдэгдэл"-тэй ижил).
 */
export async function loadCashBalancesFast(
  orgId: string,
  accounts: { id: string; openingBalance: string | number }[],
  asOf?: string
): Promise<Map<string, number>> {
  const anchor = await findCashSnapshotAnchor(orgId, asOf);
  const [snapshotRows, delta] = await Promise.all([
    anchor
      ? db.query.cashAccountPeriodBalances.findMany({
          where: and(
            eq(cashAccountPeriodBalances.organizationId, orgId),
            eq(cashAccountPeriodBalances.periodCode, anchor.code)
          ),
          columns: { cashAccountId: true, closingBalance: true },
        })
      : Promise.resolve([]),
    sumCashMovements(orgId, { gtDate: anchor?.endDate, lteDate: asOf }),
  ]);
  const snapshot = new Map(
    snapshotRows.map((row) => [row.cashAccountId, Number(row.closingBalance)])
  );
  return mergeCashBalances(accounts, snapshot, delta);
}

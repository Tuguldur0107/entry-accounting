// П28 — Сервер талын ХУРДАН үлдэгдэл уншигч (snapshot + delta).
//
//   opening = сүүлийн тохирох snapshot-ийн кумулятив хаалт
//           + (snapshot дууссанаас from хүртэлх) SQL нийлбэр
//   period  = [from, to] мужийн SQL нийлбэр
//
// Ваучерууд JS-д ОГТ ачаалагдахгүй — бүх нэгтгэл Postgres-д GROUP BY-гаар.
// Snapshot нь бүх ваучерын кумулятив нийлбэрээс бодогдсон тул завсрын
// сарууд хаагдсан эсэхээс үл хамааран зөв (correct by construction);
// тохирох snapshot байхгүй бол бүхэлдээ SQL нийлбэрээр унших тул үр дүн
// ямар ч үед aggregateBalances-тай ижил (tests/period-balances.test.ts).
//
// Статусын шүүлт тайлангуудтай ИЖИЛ: "posted","reversed".

import { and, desc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accountPeriodBalances,
  accountingPeriods,
  journalLines,
  journalVouchers,
  type ChartOfAccount,
} from "@/lib/db/schema";
import {
  finalizeBalanceRows,
  getActiveKey,
  type ActiveKeySums,
  type BalanceRow,
} from "@/lib/reports/balances";

/** [gtDate, ltDate) буюу нээлтийн, [gteDate, lteDate] буюу периодын нийлбэр. */
async function sumLines(
  orgId: string,
  bounds: { gtDate?: string; ltDate?: string; gteDate?: string; lteDate?: string }
): Promise<{ accountNumber: string; debit: number; credit: number }[]> {
  const conditions = [
    eq(journalVouchers.organizationId, orgId),
    inArray(journalVouchers.status, ["posted", "reversed"]),
  ];
  if (bounds.gtDate) conditions.push(gt(journalVouchers.date, bounds.gtDate));
  if (bounds.ltDate) conditions.push(lt(journalVouchers.date, bounds.ltDate));
  if (bounds.gteDate)
    conditions.push(gte(journalVouchers.date, bounds.gteDate));
  if (bounds.lteDate)
    conditions.push(lte(journalVouchers.date, bounds.lteDate));

  const rows = await db
    .select({
      accountNumber: journalLines.accountNumber,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalVouchers, eq(journalLines.voucherId, journalVouchers.id))
    .where(and(...conditions))
    .groupBy(journalLines.accountNumber);

  return rows.map((row) => ({
    accountNumber: row.accountNumber,
    debit: Number(row.debit),
    credit: Number(row.credit),
  }));
}

export async function loadBalanceRowsFast(
  orgId: string,
  from: string,
  to: string,
  accounts: ChartOfAccount[],
  activeSegIds: number[]
): Promise<BalanceRow[]> {
  // from-оос ӨМНӨ дуусдаг, snapshot-той хамгийн сүүлийн хаалттай период.
  const [anchor] = await db
    .select({
      code: accountingPeriods.code,
      endDate: accountingPeriods.endDate,
    })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.organizationId, orgId),
        eq(accountingPeriods.status, "closed"),
        lt(accountingPeriods.endDate, from),
        sql`exists (
          select 1 from ${accountPeriodBalances}
          where ${accountPeriodBalances.organizationId} = ${accountingPeriods.organizationId}
            and ${accountPeriodBalances.periodCode} = ${accountingPeriods.code}
        )`
      )
    )
    .orderBy(desc(accountingPeriods.endDate))
    .limit(1);

  const [snapshotRows, openDelta, periodSums] = await Promise.all([
    anchor
      ? db.query.accountPeriodBalances.findMany({
          where: and(
            eq(accountPeriodBalances.organizationId, orgId),
            eq(accountPeriodBalances.periodCode, anchor.code)
          ),
        })
      : Promise.resolve([]),
    // Нээлтийн delta: snapshot дууссанаас from хүртэл (байхгүй бол бүх түүх).
    sumLines(orgId, { gtDate: anchor?.endDate, ltDate: from }),
    sumLines(orgId, { gteDate: from, lteDate: to }),
  ]);

  return mergeBalanceSources(
    {
      snapshotRows: snapshotRows.map((row) => ({
        accountNumber: row.accountNumber,
        openingDebit: Number(row.openingDebit),
        openingCredit: Number(row.openingCredit),
        periodDebit: Number(row.periodDebit),
        periodCredit: Number(row.periodCredit),
      })),
      openDelta,
      periodSums,
    },
    accounts,
    activeSegIds
  );
}

export type SnapshotSums = {
  accountNumber: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
};

export type DeltaSums = {
  accountNumber: string;
  debit: number;
  credit: number;
};

/**
 * Гурван эх сурвалжийг (snapshot кумулятив + нээлтийн delta + периодын
 * нийлбэр) activeKey түвшинд нэгтгэнэ — цэвэр, тесттэй.
 */
export function mergeBalanceSources(
  sources: {
    snapshotRows: SnapshotSums[];
    openDelta: DeltaSums[];
    periodSums: DeltaSums[];
  },
  accounts: ChartOfAccount[],
  activeSegIds: number[]
): BalanceRow[] {
  const map = new Map<string, ActiveKeySums>();
  const bucket = (accountNumber: string): ActiveKeySums => {
    const key = getActiveKey(accountNumber, activeSegIds);
    let entry = map.get(key);
    if (!entry) {
      entry = {
        activeKey: key,
        openDebit: 0,
        openCredit: 0,
        periodDebit: 0,
        periodCredit: 0,
      };
      map.set(key, entry);
    }
    return entry;
  };

  for (const row of sources.snapshotRows) {
    const entry = bucket(row.accountNumber);
    // Snapshot-ийн кумулятив хаалт (нээлт + период) = тайлангийн нээлт.
    entry.openDebit += row.openingDebit + row.periodDebit;
    entry.openCredit += row.openingCredit + row.periodCredit;
  }
  for (const row of sources.openDelta) {
    const entry = bucket(row.accountNumber);
    entry.openDebit += row.debit;
    entry.openCredit += row.credit;
  }
  for (const row of sources.periodSums) {
    const entry = bucket(row.accountNumber);
    entry.periodDebit += row.debit;
    entry.periodCredit += row.credit;
  }

  return finalizeBalanceRows([...map.values()], accounts, activeSegIds);
}

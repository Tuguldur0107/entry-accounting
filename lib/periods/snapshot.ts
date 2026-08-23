// П28 — Период хаагдах үед дансны үлдэгдлийн snapshot бичих/устгах.
// closePeriod-ийн exclusive advisory lock-той транзакц ДОТОР дуудагдана —
// шинэ бичилт зэрэг орох боломжгүй тул snapshot нь хаагдсан агшны үнэн
// төлөв. Дахин нээхэд устдаг (хуучин snapshot худал мэдээлэл болохгүй).
//
// SQL-ийн GROUP BY нэгтгэл — ваучеруудыг JS-д ачаалахгүй. Статусын шүүлт
// тайлангуудтай ИЖИЛ ("posted","reversed" — буцаалт хосоороо нэт 0).

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { accountPeriodBalances } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function writePeriodSnapshot(
  tx: Tx,
  params: {
    orgId: string;
    userId: string;
    code: string;
    startDate: string;
    endDate: string;
  }
): Promise<void> {
  const { orgId, userId, code, startDate, endDate } = params;
  // Дахин хаалт (reopen → close) хуучин мөрүүдийг орлуулна.
  await tx
    .delete(accountPeriodBalances)
    .where(
      and(
        eq(accountPeriodBalances.organizationId, orgId),
        eq(accountPeriodBalances.periodCode, code)
      )
    );
  await tx.execute(sql`
    INSERT INTO account_period_balances
      (user_id, organization_id, period_code, account_number,
       opening_debit, opening_credit, period_debit, period_credit)
    SELECT
      ${userId},
      ${orgId},
      ${code},
      l.account_number,
      COALESCE(SUM(CASE WHEN v.date < ${startDate} THEN l.debit ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN v.date < ${startDate} THEN l.credit ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN v.date >= ${startDate} THEN l.debit ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN v.date >= ${startDate} THEN l.credit ELSE 0 END), 0)
    FROM journal_lines l
    JOIN journal_vouchers v ON v.id = l.voucher_id
    WHERE v.organization_id = ${orgId}
      AND v.status IN ('posted', 'reversed')
      AND v.date <= ${endDate}
    GROUP BY l.account_number
  `);
}

export async function deletePeriodSnapshot(
  tx: Tx,
  params: { orgId: string; code: string }
): Promise<void> {
  await tx
    .delete(accountPeriodBalances)
    .where(
      and(
        eq(accountPeriodBalances.organizationId, params.orgId),
        eq(accountPeriodBalances.periodCode, params.code)
      )
    );
}

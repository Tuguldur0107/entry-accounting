// Кассын дансны периодын хаалтын үлдэгдэл — бичих/устгах (П28-ын кассын
// хувилбар). closePeriod-ийн exclusive lock-той транзакц ДОТОР дуудагдана
// тул хаагдсан агшны үнэн төлөв; дахин нээхэд устдаг.
//
// Дүрэм lib/cash/balances.ts calculateCashBalances-тай ЯГ ИЖИЛ:
//   receipt|transfer → toCashAccount руу НЭМНЭ, payment|transfer → fromCashAccount-аас ХАСНА,
//   зөвхөн status = posted, amount талбараар (дансны валютаар).
// Нэгтгэл Postgres-д — баримт JS-д ачаалагдахгүй.

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { cashAccountPeriodBalances } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function writeCashPeriodSnapshot(
  tx: Tx,
  params: { orgId: string; userId: string; code: string; endDate: string }
): Promise<void> {
  const { orgId, userId, code, endDate } = params;
  await tx
    .delete(cashAccountPeriodBalances)
    .where(
      and(
        eq(cashAccountPeriodBalances.organizationId, orgId),
        eq(cashAccountPeriodBalances.periodCode, code)
      )
    );
  await tx.execute(sql`
    INSERT INTO cash_account_period_balances
      (user_id, organization_id, period_code, cash_account_id, currency, closing_balance)
    SELECT
      ${userId},
      ${orgId},
      ${code},
      a.id,
      a.currency,
      a.opening_balance
        + COALESCE((
            SELECT SUM(d.amount) FROM cash_documents d
            WHERE d.organization_id = ${orgId}
              AND d.status = 'posted'
              AND d.date <= ${endDate}
              AND d.document_type IN ('receipt', 'transfer')
              AND d.to_cash_account_id = a.id
          ), 0)
        - COALESCE((
            SELECT SUM(d.amount) FROM cash_documents d
            WHERE d.organization_id = ${orgId}
              AND d.status = 'posted'
              AND d.date <= ${endDate}
              AND d.document_type IN ('payment', 'transfer')
              AND d.from_cash_account_id = a.id
          ), 0)
    FROM cash_accounts a
    WHERE a.organization_id = ${orgId}
  `);
}

export async function deleteCashPeriodSnapshot(
  tx: Tx,
  params: { orgId: string; code: string }
): Promise<void> {
  await tx
    .delete(cashAccountPeriodBalances)
    .where(
      and(
        eq(cashAccountPeriodBalances.organizationId, params.orgId),
        eq(cashAccountPeriodBalances.periodCode, params.code)
      )
    );
}

// Ledger-ийн integrity assertion (П27) — "хэзээ ч зөрчигдөхгүй байх ёстой"
// нөхцөлүүдийг DB-ээс шалгана. DB trigger-ууд (2026-08-19-ledger-invariants)
// шинэ бичилтийг хамгаалдаг; энэ шалгалт нь ХУУЧИН дата + trigger-ээс өмнөх
// үеийн бичилтийг давхар баталгаажуулж, сар хаалтын хуудсанд харагдана.

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

export interface LedgerIntegrityResult {
  /** posted/reversed атлаа ΣДт≠ΣКт журналууд. */
  unbalancedVouchers: {
    id: string;
    date: string;
    description: string;
    imbalance: number;
  }[];
  /** Дт, Кт хоёул бөглөгдсөн мөрийн тоо. */
  bothSidesLineCount: number;
  /** Шалгагдсан posted/reversed журналын тоо. */
  checkedVoucherCount: number;
  ok: boolean;
}

export async function runLedgerIntegrityCheck(
  orgId: string
): Promise<LedgerIntegrityResult> {
  const [unbalancedRows, bothSides, checked] = await Promise.all([
    db.execute(sql`
      select v.id, v.date, v.description,
             round(sum(l.debit - l.credit), 2) as imbalance
      from journal_vouchers v
      join journal_lines l on l.voucher_id = v.id
      where v.organization_id = ${orgId}
        and v.status in ('posted', 'reversed')
      group by v.id, v.date, v.description
      having abs(sum(l.debit - l.credit)) > 0.011
      order by v.date desc
      limit 20`),
    db.execute(sql`
      select count(*)::int as n
      from journal_lines l
      join journal_vouchers v on v.id = l.voucher_id
      where v.organization_id = ${orgId}
        and l.debit <> 0 and l.credit <> 0`),
    db.execute(sql`
      select count(*)::int as n
      from journal_vouchers
      where organization_id = ${orgId}
        and status in ('posted', 'reversed')`),
  ]);

  const unbalancedVouchers = (unbalancedRows as unknown as {
    id: string;
    date: string;
    description: string;
    imbalance: string;
  }[]).map((row) => ({
    id: row.id,
    date: row.date,
    description: row.description,
    imbalance: Number(row.imbalance),
  }));
  const bothSidesLineCount = Number(
    (bothSides as unknown as { n: number }[])[0]?.n ?? 0
  );

  return {
    unbalancedVouchers,
    bothSidesLineCount,
    checkedVoucherCount: Number(
      (checked as unknown as { n: number }[])[0]?.n ?? 0
    ),
    ok: unbalancedVouchers.length === 0 && bothSidesLineCount === 0,
  };
}

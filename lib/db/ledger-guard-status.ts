// Журналын DB түвшний хамгаалалтын төлөв — `/api/health`-ийн `ledger` хэсэг.
// Хамгаалалтыг deploy бүрд `scripts/apply-ledger-invariants.mjs` тавина; тэр
// алгассан/унасан ч deploy зогсдоггүй тул энд ИЛ харагдана (Entry Console).
// Нэрс нь scripts/lib/ledger-invariants.mjs-тэй ИЖИЛ байх ёстой
// (tests/ledger-invariants.test.ts шалгана) — app нь scripts/-ийг импортлохгүй.
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

export const LEDGER_GUARD_TRIGGERS = [
  "ea_journal_lines_balanced",
  "ea_journal_vouchers_balanced",
  "ea_journal_lines_protect",
  "ea_journal_vouchers_posted_note",
] as const;
export const LEDGER_GUARD_CONSTRAINT = "journal_lines_dr_xor_cr";

export interface LedgerGuardStatus {
  /** Бүх хамгаалалт тавигдсан эсэх. */
  ok: boolean;
  triggers: number;
  expectedTriggers: number;
  drXorCr: boolean;
}

export async function ledgerGuardStatus(): Promise<LedgerGuardStatus | null> {
  try {
    const rows = (await db.execute(sql`
      select
        (select count(*)::int from pg_trigger
          where not tgisinternal
            and tgname in (${sql.join(LEDGER_GUARD_TRIGGERS.map((name) => sql`${name}`), sql`, `)})) as triggers,
        (select count(*)::int from pg_constraint where conname = ${LEDGER_GUARD_CONSTRAINT}) as constraints`)) as unknown as {
      triggers: number;
      constraints: number;
    }[];
    const row = rows[0];
    const triggers = Number(row?.triggers ?? 0);
    const drXorCr = Number(row?.constraints ?? 0) > 0;
    return {
      ok: triggers === LEDGER_GUARD_TRIGGERS.length && drXorCr,
      triggers,
      expectedTriggers: LEDGER_GUARD_TRIGGERS.length,
      drXorCr,
    };
  } catch {
    // Health-ийг хэзээ ч унагахгүй.
    return null;
  }
}

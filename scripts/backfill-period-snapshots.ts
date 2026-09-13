// Хаагдсан тайлант үеүдэд GL (account_period_balances) ба кассын
// (cash_account_period_balances) snapshot ДУТУУ бол нөхөж бичнэ. Идемпотент —
// байгаа snapshot-ыг хөндөхгүй. Snapshot байхгүй үед ч уншигчид бүх түүхийг
// нийлж ЗӨВ ажилладаг (correct by construction), энэ нь зөвхөн хурдны нөхөлт.
// Ажиллуулах: npx tsx scripts/backfill-period-snapshots.ts
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../lib/db");
  const { accountingPeriods } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { sql } = await import("drizzle-orm");
  const { writePeriodSnapshot } = await import("../lib/periods/snapshot");
  const { writeCashPeriodSnapshot } = await import("../lib/cash/period-snapshot");

  const closed = await db.query.accountingPeriods.findMany({
    where: eq(accountingPeriods.status, "closed"),
    orderBy: (p, { asc }) => [asc(p.organizationId), asc(p.code)],
  });
  let written = 0;
  for (const period of closed) {
    const [{ gl, cash }] = (await db.execute(sql`
      select
        (select count(*) from account_period_balances b where b.organization_id = ${period.organizationId} and b.period_code = ${period.code})::int as gl,
        (select count(*) from cash_account_period_balances c where c.organization_id = ${period.organizationId} and c.period_code = ${period.code})::int as cash
    `)) as unknown as { gl: number; cash: number }[];
    if (gl > 0 && cash > 0) continue;
    await db.transaction(async (tx) => {
      if (gl === 0)
        await writePeriodSnapshot(tx, {
          orgId: period.organizationId,
          userId: period.userId,
          code: period.code,
          startDate: period.startDate,
          endDate: period.endDate,
        });
      if (cash === 0)
        await writeCashPeriodSnapshot(tx, {
          orgId: period.organizationId,
          userId: period.userId,
          code: period.code,
          endDate: period.endDate,
        });
    });
    written += 1;
    console.log(`✓ ${period.organizationId.slice(0, 8)} ${period.code} — gl:${gl === 0 ? "бичив" : "байсан"} cash:${cash === 0 ? "бичив" : "байсан"}`);
  }
  console.log(`Дууслаа — ${closed.length} хаагдсан үе, ${written} нөхөгдөв.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

// Татварын дансны үлдэгдэл + хуулга — Татвар модулийн удирдлагын хэсгийн
// НЭГ эх сурвалж. GL-ийн journal_lines-аас шууд уншина (батлагдсан +
// буцаагдсан журнал — тайлангийн конвенцтой ижил); orgId параметртэй тул
// "use server" файлд БИШ (lib/vat/settings.ts-тэй ижил шалтгаанаар).

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chartOfAccounts, journalLines, journalVouchers } from "@/lib/db/schema";

export interface TaxAccountBalance {
  main: string;
  name: string;
  /** Dr − Cr нийлбэр (батлагдсан + буцаагдсан журналаар). */
  balance: number;
}

export interface TaxLedgerEntry {
  /** journal_lines.id — grid-ийн давтагдашгүй мөрийн түлхүүр. */
  lineId: string;
  voucherId: string;
  date: string;
  description: string;
  accountMain: string;
  debit: number;
  credit: number;
  status: string;
}

export interface TaxLedgerData {
  accounts: TaxAccountBalance[];
  entries: TaxLedgerEntry[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export async function loadTaxLedger(
  orgId: string,
  mains: string[],
  entryLimit = 100
): Promise<TaxLedgerData> {
  if (mains.length === 0) return { accounts: [], entries: [] };

  // Мөрийн данс 10 хэсэгт dotted код (хуучин дата ганц 8 оронтой байж болно)
  // — үндсэн данс (S3)-ыг SQL талд задална.
  const mainExpr = sql<string>`case when position('.' in ${journalLines.accountNumber}) > 0 then split_part(${journalLines.accountNumber}, '.', 3) else ${journalLines.accountNumber} end`;
  const scope = and(
    eq(journalVouchers.organizationId, orgId),
    inArray(journalVouchers.status, ["posted", "reversed"]),
    inArray(mainExpr, mains)
  );

  const [totals, rows, names] = await Promise.all([
    db
      .select({
        main: mainExpr,
        debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(journalVouchers, eq(journalLines.voucherId, journalVouchers.id))
      .where(scope)
      .groupBy(mainExpr),
    db
      .select({
        lineId: journalLines.id,
        voucherId: journalVouchers.id,
        date: journalVouchers.date,
        voucherDescription: journalVouchers.description,
        lineDescription: journalLines.description,
        status: journalVouchers.status,
        main: mainExpr,
        debit: journalLines.debit,
        credit: journalLines.credit,
      })
      .from(journalLines)
      .innerJoin(journalVouchers, eq(journalLines.voucherId, journalVouchers.id))
      .where(scope)
      .orderBy(desc(journalVouchers.date), desc(journalVouchers.createdAt))
      .limit(entryLimit),
    db.query.chartOfAccounts.findMany({
      // Идэвхгүй данс ч багтана — хуучин бичилтийн нэр харагдах ёстой.
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        inArray(chartOfAccounts.number, mains)
      ),
      columns: { number: true, name: true },
    }),
  ]);

  const nameByMain = new Map(names.map((row) => [row.number, row.name]));
  const totalByMain = new Map(
    totals.map((row) => [row.main, round2(Number(row.debit) - Number(row.credit))])
  );

  return {
    // mains-ийн дарааллаар — бичилтгүй данс ч 0 үлдэгдэлтэй харагдана.
    accounts: mains.map((main) => ({
      main,
      name: nameByMain.get(main) ?? "",
      balance: totalByMain.get(main) ?? 0,
    })),
    entries: rows.map((row) => ({
      lineId: row.lineId,
      voucherId: row.voucherId,
      date: row.date,
      description: row.lineDescription || row.voucherDescription,
      accountMain: row.main,
      debit: Number(row.debit),
      credit: Number(row.credit),
      status: row.status,
    })),
  };
}

// П28 үргэлжлэл — самбаруудын (GL хяналт, нүүр) ваучер-түвшний нэгтгэл.
//
// Урьд нь хоёр самбар БҮХ журналыг мөрүүдтэй нь JS-д ачаалж давхардсан
// гүйлтээр нэгтгэдэг байсан. Одоо нэгтгэл нь Postgres-д GROUP BY-гаар:
// журнал бүрд нэг мөр (Дт/Кт нийлбэр, ангиллын цэвэр нөлөө, үндсэн данс
// болон S9 модулийн жагсаалт) буцна — мөрүүд JS-д огт ачаалагдахгүй.
//
// Задлалын дүрэм lib/reports/balances.ts-тэй ИЖИЛ:
//   • үндсэн данс: 10 хэсэгт код → 3-р хэсэг, бусад нь код өөрөө
//     (extractMainAccount)
//   • ангилал: үндсэн дансны эхний орон — 1/2 актив, 3 өр төлбөр,
//     4 өмч, 5 орлого, 6/7/8 зардал (getAccountClass)
//   • модуль: 10 хэсэгт кодын 9-р хэсэг, хоосон бол "GL" (sourceModuleOf)

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { journalLines, journalVouchers } from "@/lib/db/schema";

export interface VoucherClassImpact {
  asset: number;
  liability: number;
  equity: number;
  revenue: number;
  expense: number;
}

export interface VoucherSummary {
  id: string;
  date: string;
  description: string;
  status: string;
  externalRef: string | null;
  lineCount: number;
  debit: number;
  credit: number;
  /** Ангилалд үзүүлсэн цэвэр нөлөө (актив/зардал Дт−Кт, бусад Кт−Дт). */
  cls: VoucherClassImpact;
  /** Мөрийн дарааллаар, давхардалгүй үндсэн данснууд. */
  mains: string[];
  /** Мөрийн дарааллаар, давхардалгүй S9 модулиуд ("GL" fallback-тай). */
  modules: string[];
}

// 10 хэсэгт dotted код (9 цэгтэй) эсэхийг шалгана — өөр хэлбэрийн код
// (legacy 8 оронтой г.м) extractMainAccount-ийн адил өөрөө main нь болно.
const TEN_PART = sql`${journalLines.accountNumber} like '%.%.%.%.%.%.%.%.%.%'`;
const MAIN = sql<string>`case when ${TEN_PART} then split_part(${journalLines.accountNumber}, '.', 3) else ${journalLines.accountNumber} end`;
const MODULE = sql<string>`case when ${TEN_PART} and split_part(${journalLines.accountNumber}, '.', 9) <> '' then split_part(${journalLines.accountNumber}, '.', 9) else 'GL' end`;

/** Ангиллын цэвэр нөлөөний нийлбэр — dir нь тэмдгийн чиглэл. */
function clsSum(firstDigits: string[], dir: "debit" | "credit") {
  const signed =
    dir === "debit"
      ? sql`${journalLines.debit} - ${journalLines.credit}`
      : sql`${journalLines.credit} - ${journalLines.debit}`;
  const digits = sql.join(
    firstDigits.map((digit) => sql`${digit}`),
    sql`, `
  );
  return sql<string>`coalesce(sum(case when left(${MAIN}, 1) in (${digits}) then ${signed} else 0 end), 0)`;
}

/** null-гүй, эх дарааллаа хадгалсан давхардалгүй жагсаалт. */
function dedupe(values: (string | null)[] | null): string[] {
  const out: string[] = [];
  for (const value of values ?? []) {
    if (value != null && !out.includes(value)) out.push(value);
  }
  return out;
}

export async function loadVoucherSummaries(
  orgId: string
): Promise<VoucherSummary[]> {
  const rows = await db
    .select({
      id: journalVouchers.id,
      date: journalVouchers.date,
      description: journalVouchers.description,
      status: journalVouchers.status,
      externalRef: journalVouchers.externalRef,
      lineCount: sql<number>`count(${journalLines.id})::int`,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
      asset: clsSum(["1", "2"], "debit"),
      liability: clsSum(["3"], "credit"),
      equity: clsSum(["4"], "credit"),
      revenue: clsSum(["5"], "credit"),
      expense: clsSum(["6", "7", "8"], "debit"),
      mains: sql<
        (string | null)[] | null
      >`array_agg(${MAIN} order by ${journalLines.sortOrder}, ${journalLines.id})`,
      modules: sql<
        (string | null)[] | null
      >`array_agg(${MODULE} order by ${journalLines.sortOrder}, ${journalLines.id})`,
    })
    .from(journalVouchers)
    .leftJoin(journalLines, eq(journalLines.voucherId, journalVouchers.id))
    .where(
      and(
        eq(journalVouchers.organizationId, orgId),
        inArray(journalVouchers.status, ["draft", "posted", "reversed"])
      )
    )
    .groupBy(journalVouchers.id)
    .orderBy(desc(journalVouchers.date), desc(journalVouchers.createdAt));

  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    description: row.description,
    status: row.status,
    externalRef: row.externalRef,
    lineCount: row.lineCount,
    debit: Number(row.debit),
    credit: Number(row.credit),
    cls: {
      asset: Number(row.asset),
      liability: Number(row.liability),
      equity: Number(row.equity),
      revenue: Number(row.revenue),
      expense: Number(row.expense),
    },
    mains: dedupe(row.mains),
    modules: dedupe(row.modules),
  }));
}

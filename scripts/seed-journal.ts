import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../lib/db/schema";
import { eq } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

// Active segments: S1(id=1), S3(id=3), S5(id=5)
// Code format: "{s1}.{s3}.{s5}"
function ac(s1: string, s3: string, s5: string) {
  return `${s1}.${s3}.${s5}`;
}

const C = "101";  // S1 — МН ХХК
const O = "1001"; // S5 — Үйл ажиллагаа
const D = "2001"; // S5 — Хөгжлийн төсөл

const VOUCHERS = [
  {
    date: "2026-05-01",
    description: "Борлуулалт — мөнгөн орлого",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, "11210000", O), debit: "9240000",  credit: "0",       description: "Бэлэн мөнгө авлаа",           sortOrder: 0 },
      { accountNumber: ac(C, "51100000", O), debit: "0",        credit: "8400000",  description: "Борлуулалтын орлого",         sortOrder: 1 },
      { accountNumber: ac(C, "31410000", O), debit: "0",        credit: "840000",   description: "НӨАТ өглөг 10%",             sortOrder: 2 },
    ],
  },
  {
    date: "2026-05-02",
    description: "Нийлүүлэгчид төлбөр хийлгэлт",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, "31000001", O), debit: "5500000",  credit: "0",        description: "AP төлбөр",                  sortOrder: 0 },
      { accountNumber: ac(C, "11000001", O), debit: "0",        credit: "5500000",  description: "Харилцах данс",              sortOrder: 1 },
    ],
  },
  {
    date: "2026-05-02",
    description: "Үндсэн хөрөнгө худалдан авалт",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, "21010000", D), debit: "12000000", credit: "0",        description: "Тоног төхөөрөмж",            sortOrder: 0 },
      { accountNumber: ac(C, "13620000", D), debit: "1200000",  credit: "0",        description: "НӨАТ авсан 10%",             sortOrder: 1 },
      { accountNumber: ac(C, "31000001", D), debit: "0",        credit: "13200000", description: "AP — нийлүүлэгч",           sortOrder: 2 },
    ],
  },
  {
    date: "2026-05-03",
    description: "4-р сарын цалин олголт",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, "72100000", O), debit: "6000000",  credit: "0",        description: "Нийт цалин",                 sortOrder: 0 },
      { accountNumber: ac(C, "72100002", O), debit: "750000",   credit: "0",        description: "НДШ ажил олгогч 12.5%",      sortOrder: 1 },
      { accountNumber: ac(C, "31420000", O), debit: "0",        credit: "1440000",  description: "НДШ өглөг (ажилтан+АО)",    sortOrder: 2 },
      { accountNumber: ac(C, "31430000", O), debit: "0",        credit: "600000",   description: "ХАОАТ өглөг 10%",           sortOrder: 3 },
      { accountNumber: ac(C, "31500001", O), debit: "0",        credit: "4710000",  description: "Гарт олгох цалин",           sortOrder: 4 },
    ],
  },
  {
    date: "2026-05-03",
    description: "Цалин банкаар олгов",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, "31500001", O), debit: "4710000",  credit: "0",        description: "Цалингийн өглөг тооцоолов", sortOrder: 0 },
      { accountNumber: ac(C, "11000001", O), debit: "0",        credit: "4710000",  description: "Харилцах данс",             sortOrder: 1 },
    ],
  },
  {
    date: "2026-05-05",
    description: "Авлагын орлого — харилцагч А",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, "11000001", O), debit: "3300000",  credit: "0",        description: "Банкны орлого",             sortOrder: 0 },
      { accountNumber: ac(C, "13110000", O), debit: "0",        credit: "3300000",  description: "Авлага тооцоолов",          sortOrder: 1 },
    ],
  },
  {
    date: "2026-05-05",
    description: "Үйл ажиллагааны зардал — түрээс",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, "61100000", O), debit: "2400000",  credit: "0",        description: "Сарын түрээс",              sortOrder: 0 },
      { accountNumber: ac(C, "13620000", O), debit: "240000",   credit: "0",        description: "НӨАТ авсан",                sortOrder: 1 },
      { accountNumber: ac(C, "11000001", O), debit: "0",        credit: "2640000",  description: "Харилцах данс",             sortOrder: 2 },
    ],
  },
  {
    date: "2026-05-06",
    description: "Борлуулалт — авлагаар",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, "13110000", O), debit: "16500000", credit: "0",        description: "Авлага үүслээ",             sortOrder: 0 },
      { accountNumber: ac(C, "51100000", O), debit: "0",        credit: "15000000", description: "Борлуулалтын орлого",       sortOrder: 1 },
      { accountNumber: ac(C, "31410000", O), debit: "0",        credit: "1500000",  description: "НӨАТ өглөг 10%",           sortOrder: 2 },
    ],
  },
  {
    date: "2026-05-06",
    description: "НӨАТ тооцоо — 4-р сар",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, "31410000", O), debit: "2340000",  credit: "0",        description: "НӨАТ өглөг тооцоолов",     sortOrder: 0 },
      { accountNumber: ac(C, "13620000", O), debit: "0",        credit: "1440000",  description: "НӨАТ авсан тооцоолов",     sortOrder: 1 },
      { accountNumber: ac(C, "11000001", O), debit: "0",        credit: "900000",   description: "НӨАТ төлбөр банкаар",      sortOrder: 2 },
    ],
  },
  {
    date: "2026-05-07",
    description: "Ноорог — бараа материал худалдан авалт",
    status: "draft" as const,
    lines: [
      { accountNumber: ac(C, "61100000", D), debit: "8000000",  credit: "0",        description: "Бараа материал",           sortOrder: 0 },
      { accountNumber: ac(C, "13620000", D), debit: "800000",   credit: "0",        description: "НӨАТ авсан",               sortOrder: 1 },
      { accountNumber: ac(C, "31000001", D), debit: "0",        credit: "8800000",  description: "AP — нийлүүлэгч",         sortOrder: 2 },
    ],
  },
];

async function seed() {
  const users = await db.query.users.findMany();
  if (users.length === 0) { console.error("Хэрэглэгч олдсонгүй."); process.exit(1); }
  const userId = users[0].id;
  console.log(`Хэрэглэгч: ${users[0].email}`);

  // Remove existing vouchers
  await db.delete(schema.journalVouchers).where(eq(schema.journalVouchers.userId, userId));
  console.log("Өмнөх бичилтүүдийг устгалаа.");

  for (const v of VOUCHERS) {
    const [voucher] = await db
      .insert(schema.journalVouchers)
      .values({ userId, date: v.date, description: v.description, status: v.status })
      .returning();
    await db.insert(schema.journalLines).values(v.lines.map((l) => ({ voucherId: voucher.id, ...l })));
    console.log(`✓ ${v.date} — ${v.description}`);
  }

  console.log(`\nНийт ${VOUCHERS.length} бичилт амжилттай орлоо.`);
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });

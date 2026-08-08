import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../lib/db/schema";
import { eq } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

// Бүх 10 сегментийг оруулна — идэвхтэй/идэвхгүй нь зөвхөн UI-ийн тохиргоо
// Code format: S1.S2.S3.S4.S5.S6.S7.S8.S9.S10
function ac(
  s1: string,  // Компани         (3)
  s2: string,  // Зардлын төв     (6)
  s3: string,  // Үндсэн данс     (8)
  s4: string,  // Бүтээгдэхүүн   (2)
  s5: string,  // Төсөл           (4)
  s6: string,  // Группын дотоод (3)  — 000 = тохиохгүй
  s7: string,  // Холбоотой этгээд (4) — 0000 = тохиохгүй
  s8: string,  // Мөнгөн урсгал  (4)
  s9: string,  // Модуль         (2)  — GL = Ерөнхий журнал
  s10: string, // Нөөц           (1)  — 0
) {
  return `${s1}.${s2}.${s3}.${s4}.${s5}.${s6}.${s7}.${s8}.${s9}.${s10}`;
}

// ── S1 — Компани ──────────────────────────────────────────────
const C = "101"; // МН ХХК

// ── S2 — Зардлын төв ──────────────────────────────────────────
const ADM = "100100"; // Захиргааны хэлтэс
const FIN = "200100"; // Санхүүгийн хэлтэс
const SAL = "300100"; // Борлуулалтын хэлтэс
const OPS = "400100"; // Үйл ажиллагааны хэлтэс

// ── S4 — Бүтээгдэхүүн / Үйлчилгээ ───────────────────────────
const GDS = "11"; // Бараа материал
const SVC = "12"; // Үйлчилгээ
const EQP = "13"; // Дэд бүтэц / Тоног

// ── S5 — Төсөл ────────────────────────────────────────────────
const OP    = "1001"; // Үйл ажиллагаа
const DEV   = "2001"; // Хөгжлийн төсөл
const INFRA = "3001"; // Дэд бүтцийн төсөл

// ── S6 — Группын дотоод (тохиохгүй үед 000) ──────────────────
const IC0 = "000";  // Дотоод гүйлгээ биш
// const IC1 = "201"; // МН ХХК — хоорондын гүйлгээний жишээнд хэрэглэж болно

// ── S7 — Холбоотой этгээд (тохиохгүй үед 0000) ───────────────
const RP0 = "0000"; // Тохиохгүй

// ── S8 — IAS 7 Мөнгөн урсгал ────────────────────────────────
const CF_OP  = "1101"; // Operating
const CF_INV = "2101"; // Investing

// ── S9 — Модуль (журналын бичилт = GL) ────────────────────────
const GL = "GL";

// ── S10 — Нөөц ────────────────────────────────────────────────
const R = "0";

const VOUCHERS = [
  {
    date: "2026-05-01",
    description: "Борлуулалт — мөнгөн орлого",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, SAL, "11210000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "9240000",  credit: "0",        description: "Бэлэн мөнгө авлаа",       sortOrder: 0 },
      { accountNumber: ac(C, SAL, "51100000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "8400000",  description: "Борлуулалтын орлого",     sortOrder: 1 },
      { accountNumber: ac(C, FIN, "31410000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "840000",   description: "НӨАТ өглөг 10%",         sortOrder: 2 },
    ],
  },
  {
    date: "2026-05-02",
    description: "Нийлүүлэгчид төлбөр хийлгэлт",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, FIN, "31000001", GDS, OP,    IC0, RP0, CF_OP,  GL, R), debit: "5500000",  credit: "0",        description: "AP төлбөр",               sortOrder: 0 },
      { accountNumber: ac(C, FIN, "11000001", GDS, OP,    IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "5500000",  description: "Харилцах данс",           sortOrder: 1 },
    ],
  },
  {
    date: "2026-05-02",
    description: "Үндсэн хөрөнгө худалдан авалт",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, ADM, "21010000", EQP, INFRA, IC0, RP0, CF_INV, GL, R), debit: "12000000", credit: "0",        description: "Тоног төхөөрөмж",        sortOrder: 0 },
      { accountNumber: ac(C, ADM, "13620000", EQP, INFRA, IC0, RP0, CF_INV, GL, R), debit: "1200000",  credit: "0",        description: "НӨАТ авсан 10%",         sortOrder: 1 },
      { accountNumber: ac(C, FIN, "31000001", EQP, INFRA, IC0, RP0, CF_INV, GL, R), debit: "0",        credit: "13200000", description: "AP — нийлүүлэгч",       sortOrder: 2 },
    ],
  },
  {
    date: "2026-05-03",
    description: "4-р сарын цалин олголт",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, ADM, "72100000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "3000000",  credit: "0",        description: "Захиргааны цалин",        sortOrder: 0 },
      { accountNumber: ac(C, SAL, "72100000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "2000000",  credit: "0",        description: "Борлуулалтын цалин",      sortOrder: 1 },
      { accountNumber: ac(C, OPS, "72100000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "1000000",  credit: "0",        description: "Үйл ажиллагааны цалин",   sortOrder: 2 },
      { accountNumber: ac(C, FIN, "72100002", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "750000",   credit: "0",        description: "НДШ ажил олгогч 12.5%",   sortOrder: 3 },
      { accountNumber: ac(C, FIN, "31420000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "1440000",  description: "НДШ өглөг (ажилтан+АО)", sortOrder: 4 },
      { accountNumber: ac(C, FIN, "31430000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "600000",   description: "ХАОАТ өглөг 10%",        sortOrder: 5 },
      { accountNumber: ac(C, FIN, "31500001", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "4710000",  description: "Гарт олгох цалин",        sortOrder: 6 },
    ],
  },
  {
    date: "2026-05-03",
    description: "Цалин банкаар олгов",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, FIN, "31500001", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "4710000",  credit: "0",        description: "Цалингийн өглөг",         sortOrder: 0 },
      { accountNumber: ac(C, FIN, "11000001", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "4710000",  description: "Харилцах данс",           sortOrder: 1 },
    ],
  },
  {
    date: "2026-05-05",
    description: "Авлагын орлого — харилцагч А",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, FIN, "11000001", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "3300000",  credit: "0",        description: "Банкны орлого",           sortOrder: 0 },
      { accountNumber: ac(C, SAL, "13110000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "3300000",  description: "Авлага тооцоолов",        sortOrder: 1 },
    ],
  },
  {
    date: "2026-05-05",
    description: "Үйл ажиллагааны зардал — түрээс",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, ADM, "61100000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "2400000",  credit: "0",        description: "Сарын түрээс",            sortOrder: 0 },
      { accountNumber: ac(C, ADM, "13620000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "240000",   credit: "0",        description: "НӨАТ авсан",              sortOrder: 1 },
      { accountNumber: ac(C, FIN, "11000001", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "2640000",  description: "Харилцах данс",           sortOrder: 2 },
    ],
  },
  {
    date: "2026-05-06",
    description: "Борлуулалт — авлагаар",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, SAL, "13110000", SVC, DEV,   IC0, RP0, CF_OP,  GL, R), debit: "16500000", credit: "0",        description: "Авлага үүслээ",          sortOrder: 0 },
      { accountNumber: ac(C, SAL, "51100000", SVC, DEV,   IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "15000000", description: "Борлуулалтын орлого",    sortOrder: 1 },
      { accountNumber: ac(C, FIN, "31410000", SVC, DEV,   IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "1500000",  description: "НӨАТ өглөг 10%",        sortOrder: 2 },
    ],
  },
  {
    date: "2026-05-06",
    description: "НӨАТ тооцоо — 4-р сар",
    status: "posted" as const,
    lines: [
      { accountNumber: ac(C, FIN, "31410000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "2340000",  credit: "0",        description: "НӨАТ өглөг тооцоолов",  sortOrder: 0 },
      { accountNumber: ac(C, FIN, "13620000", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "1440000",  description: "НӨАТ авсан тооцоолов",  sortOrder: 1 },
      { accountNumber: ac(C, FIN, "11000001", SVC, OP,    IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "900000",   description: "НӨАТ төлбөр банкаар",   sortOrder: 2 },
    ],
  },
  {
    date: "2026-05-07",
    description: "Ноорог — бараа материал худалдан авалт",
    status: "draft" as const,
    lines: [
      { accountNumber: ac(C, OPS, "61100000", GDS, DEV,   IC0, RP0, CF_OP,  GL, R), debit: "8000000",  credit: "0",        description: "Бараа материал",         sortOrder: 0 },
      { accountNumber: ac(C, OPS, "13620000", GDS, DEV,   IC0, RP0, CF_OP,  GL, R), debit: "800000",   credit: "0",        description: "НӨАТ авсан",             sortOrder: 1 },
      { accountNumber: ac(C, FIN, "31000001", GDS, DEV,   IC0, RP0, CF_OP,  GL, R), debit: "0",        credit: "8800000",  description: "AP — нийлүүлэгч",       sortOrder: 2 },
    ],
  },
];

async function seed() {
  const users = await db.query.users.findMany();
  if (users.length === 0) { console.error("Хэрэглэгч олдсонгүй."); process.exit(1); }
  const userId = users[0].id;
  console.log(`Хэрэглэгч: ${users[0].email}\n`);

  await db.delete(schema.journalVouchers).where(eq(schema.journalVouchers.userId, userId));
  console.log("── Өмнөх бичилтүүдийг устгалаа.\n");

  for (const v of VOUCHERS) {
    const [voucher] = await db
      .insert(schema.journalVouchers)
      .values({ userId, date: v.date, description: v.description, status: v.status })
      .returning();
    await db.insert(schema.journalLines).values(v.lines.map((l) => ({ voucherId: voucher.id, ...l })));
    const d = v.lines.reduce((s, l) => s + Number(l.debit), 0);
    console.log(`✓ ${v.date}  ${v.description.padEnd(38)} ${(d / 1_000_000).toFixed(2)}M  [${v.status}]`);
  }

  console.log(`\nНийт ${VOUCHERS.length} бичилт — кодны формат: S1.S2.S3.S4.S5.S6.S7.S8.S9.S10`);
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });

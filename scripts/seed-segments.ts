import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../lib/db/schema";
import { eq } from "drizzle-orm";

const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });

// §7.6.2: code[0] != '0' — fixed-width per segment
// S1=3, S2=6, S4=2, S5=4, S6=3, S7=4, S8=4, S9=2, S10=1
const SEGMENT_DATA: {
  segmentId: number;
  label: string;
  modules: string;
  values: { code: string; name: string }[];
}[] = [
  {
    segmentId: 1,
    label: "S1 — Компани (length=3)",
    modules: "gl,ar,ap,fa,cost,cash",
    values: [
      { code: "101", name: "МН ХХК (Үндсэн)" },
      { code: "102", name: "Охин компани А" },
      { code: "103", name: "Охин компани Б" },
    ],
  },
  {
    segmentId: 2,
    label: "S2 — Зардлын төв (length=6)",
    modules: "gl,ap,fa,cost",
    values: [
      { code: "100100", name: "Захиргааны хэлтэс" },
      { code: "200100", name: "Санхүүгийн хэлтэс" },
      { code: "300100", name: "Борлуулалтын хэлтэс" },
      { code: "400100", name: "Үйл ажиллагааны хэлтэс" },
      { code: "500100", name: "IT хэлтэс" },
    ],
  },
  {
    segmentId: 4,
    label: "S4 — Бүтээгдэхүүн / Үйлчилгээ (length=2)",
    modules: "gl,ar,cost",
    values: [
      { code: "11", name: "Бараа материал" },
      { code: "12", name: "Үйлчилгээ" },
      { code: "13", name: "Дэд бүтэц / Тоног" },
      { code: "14", name: "Лиценз / Программ" },
    ],
  },
  {
    segmentId: 5,
    label: "S5 — Төсөл (length=4)",
    modules: "gl,ar,ap,fa,cost",
    values: [
      { code: "1001", name: "Үйл ажиллагаа" },
      { code: "2001", name: "Хөгжлийн төсөл" },
      { code: "3001", name: "Дэд бүтцийн төсөл" },
      { code: "4001", name: "Маркетингийн төсөл" },
    ],
  },
  {
    segmentId: 6,
    label: "S6 — Группын дотоод (length=3)",
    modules: "gl,agis",
    values: [
      { code: "201", name: "МН ХХК" },
      { code: "202", name: "Охин компани А" },
      { code: "203", name: "Охин компани Б" },
    ],
  },
  {
    segmentId: 7,
    label: "S7 — Холбоотой этгээд (length=4)",
    modules: "gl,ar,ap",
    values: [
      { code: "9001", name: "Захирал" },
      { code: "9002", name: "Хувьцаа эзэмшигч" },
      { code: "9003", name: "Удирдах зөвлөлийн гишүүн" },
    ],
  },
  {
    segmentId: 8,
    label: "S8 — Мөнгөн гүйлгээ IAS 7 (length=4)",
    modules: "gl,ar,ap,cash",
    values: [
      { code: "1101", name: "Үйл ажиллагааны мөнгөн урсгал (Operating)" },
      { code: "2101", name: "Хөрөнгө оруулалтын мөнгөн урсгал (Investing)" },
      { code: "3101", name: "Санхүүгийн мөнгөн урсгал (Financing)" },
    ],
  },
  {
    segmentId: 9,
    label: "S9 — Модуль / эх үүсвэр (length=2)",
    modules: "gl,ar,ap,fa,cost,cash",
    values: [
      { code: "GL", name: "Ерөнхий журнал" },
      { code: "AR", name: "Авлагын модуль" },
      { code: "AP", name: "Өглөгийн модуль" },
      { code: "FA", name: "Үндсэн хөрөнгийн модуль" },
      { code: "PY", name: "Цалингийн модуль" },
      { code: "CS", name: "Өртгийн бүртгэл" },
    ],
  },
  {
    segmentId: 10,
    label: "S10 — Нөөц (length=1, always '0')",
    modules: "",
    values: [
      { code: "0", name: "Нөөц (ашиглагдаагүй)" },
    ],
  },
];

async function seed() {
  const users = await db.query.users.findMany();
  if (users.length === 0) { console.error("Хэрэглэгч олдсонгүй."); process.exit(1); }
  const userId = users[0].id;
  console.log(`Хэрэглэгч: ${users[0].email}\n`);
  const membership = await db.query.memberships.findFirst({
    where: eq(schema.memberships.userId, userId),
    columns: { organizationId: true },
  });
  if (!membership) { console.error("Гишүүнчлэл олдсонгүй — эхлээд migration ажиллуул."); process.exit(1); }
  const organizationId = membership.organizationId;

  // Clear all existing segment values for clean seed
  await db.delete(schema.segmentValues).where(eq(schema.segmentValues.organizationId, organizationId));
  console.log("Өмнөх сегментийн утгуудыг устгалаа.\n");

  for (const seg of SEGMENT_DATA) {
    console.log(`── ${seg.label}`);
    for (const v of seg.values) {
      await db.insert(schema.segmentValues).values({
        userId,
        organizationId,
        segmentId: seg.segmentId,
        code: v.code,
        name: v.name,
        modules: seg.modules,
      });
      console.log(`   + ${v.code} — ${v.name}`);
    }
  }

  console.log("\nБүх сегментийн утгууд стандартын дагуу амжилттай орлоо.");
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });

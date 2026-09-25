// Үндсэн хөрөнгийн ТАТВАРЫН ашиглалтын хугацааг нөхөж бичих скрипт.
//
// Хувь хэмжээ нь ЗОХИОГДОХГҮЙ — эх сурвалж:
//   entry-knowledge/01-онол-хууль-стандарт/tax/cit.md §"Татварын элэгдэл vs
//   Нягтлан бодохын элэгдэл" (ААНОАТ-ын хуулийн жилийн хувь).
//
// Зөвхөн tax_useful_life_months = 0 мөрийг нөхнө (хэрэглэгчийн оруулсан
// утгыг ХЭЗЭЭ Ч дарж бичихгүй) — идемпотент, дахин ажиллуулж болно.
// Нэрээр нь ангилж чадаагүй картыг 0 хэвээр ҮЛДЭЭЖ анхааруулна: таамаглаж
// татварын хугацаа тавих нь ААНОАТ-ын тайланг гажуудуулна.
//
// Ажиллуулах: npx tsx scripts/backfill-fa-tax-life.ts [--apply]
//   --apply өгөхгүй бол зөвхөн ЮУ БОЛОХЫГ хэвлэнэ (dry-run).

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL алга (.env.local)");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");
const sql = postgres(url, { max: 1, prepare: false });

/** cit.md-ийн хуулийн жилийн хувь → ашиглалтын хугацаа (сар) = 100 / хувь × 12. */
const TAX_CLASSES = [
  {
    label: "Компьютер (20%/жил)",
    months: 60,
    keywords: [
      "компьютер", "computer", "laptop", "лаптоп", "notebook",
      "macbook", "imac", "desktop", "сервер", "server", "monitor", "монитор",
      "принтер", "printer",
    ],
  },
  {
    label: "Тээврийн хэрэгсэл (10%/жил)",
    months: 120,
    keywords: [
      "авто", "машин", "тээвр", "тээвэр", "vehicle", "car", "truck",
      "toyota", "lexus", "hyundai", "автобус",
    ],
  },
  {
    label: "Барилга (5%/жил)",
    months: 240,
    keywords: ["барилга", "building", "байр", "оффис", "office space", "агуулах"],
  },
  {
    label: "Биет бус хөрөнгө (10%/жил)",
    months: 120,
    keywords: ["програм", "software", "лиценз", "license", "биет бус", "intangible"],
  },
  {
    label: "Тоног төхөөрөмж (10%/жил)",
    months: 120,
    keywords: [
      "тоног", "төхөөрөмж", "equipment", "machine", "машин механизм",
      "суурилуулалт", "багаж",
    ],
  },
] as const;

function classify(name: string) {
  const text = name.toLowerCase();
  for (const cls of TAX_CLASSES)
    if (cls.keywords.some((word) => text.includes(word))) return cls;
  return null;
}

async function main() {
  const rows = await sql<
    { id: string; code: string; name: string; org: string; life: number }[]
  >`
    SELECT f.id, f.code, f.name, o.name AS org, f.useful_life_months AS life
    FROM fixed_assets f
    JOIN organizations o ON o.id = f.organization_id
    WHERE f.tax_useful_life_months = 0
    ORDER BY o.name, f.code`;

  if (rows.length === 0) {
    console.log("✓ Татварын хугацаа нөхөх карт алга (бүгд бөглөгдсөн)");
    await sql.end();
    return;
  }

  const planned: { id: string; months: number; line: string }[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    const cls = classify(row.name);
    if (!cls) {
      skipped.push(`  ? [${row.org}] ${row.code} — ${row.name}`);
      continue;
    }
    planned.push({
      id: row.id,
      months: cls.months,
      line: `  → [${row.org}] ${row.code} — ${row.name}: ${cls.label} = ${cls.months} сар (санхүүгийн ${row.life} сар)`,
    });
  }

  console.log(`${rows.length} карт татварын хугацаагүй байна.\n`);
  if (planned.length > 0) {
    console.log("Ангилагдсан:");
    planned.forEach((p) => console.log(p.line));
  }
  if (skipped.length > 0) {
    console.log("\nАНГИЛАГДААГҮЙ — 0 хэвээр үлдэнэ, гараар оруулна уу:");
    skipped.forEach((line) => console.log(line));
  }

  if (!APPLY) {
    console.log("\n(dry-run — бичихийн тулд --apply нэмнэ)");
    await sql.end();
    return;
  }

  for (const item of planned) {
    await sql`
      UPDATE fixed_assets
      SET tax_useful_life_months = ${item.months},
          tax_depreciation_method = 'straight_line'
      WHERE id = ${item.id} AND tax_useful_life_months = 0`;
  }
  console.log(`\n✓ ${planned.length} карт шинэчлэгдлээ`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

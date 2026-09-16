// report_line_mappings.cf_codes баганыг live DB-д АЮУЛГҮЙ нэмэх скрипт.
// drizzle-kit push-ийн интерактив (truncate санал болгодог) урсгалыг тойрч,
// TRUNCATE/DROP огт хийхгүйгээр идемпотент DDL ажиллуулна.
// Ажиллуулах: npx tsx scripts/apply-cf-codes-ddl.ts

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL алга (.env.local)");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });

async function main() {
  await sql.unsafe(
    `ALTER TABLE report_line_mappings ADD COLUMN IF NOT EXISTS cf_codes text`
  );
  const [row] = await sql`
    SELECT count(*)::text AS n
    FROM information_schema.columns
    WHERE table_name = 'report_line_mappings' AND column_name = 'cf_codes'
  `;
  console.log(
    Number(row?.n) === 1
      ? "✓ report_line_mappings.cf_codes багана бэлэн"
      : "✗ cf_codes багана олдсонгүй"
  );
  await sql.end();
  process.exit(Number(row?.n) === 1 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

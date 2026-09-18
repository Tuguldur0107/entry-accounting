// Урьдчилгаа цалингийн багануудыг live DB-д АЮУЛГҮЙ нэмэх скрипт.
// drizzle-kit push-ийн интерактив (truncate санал болгодог) урсгалыг тойрч,
// TRUNCATE/DROP огт хийхгүйгээр идемпотент DDL ажиллуулна.
// Ажиллуулах: npx tsx scripts/apply-payroll-advance-ddl.ts

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL алга (.env.local)");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });

const STATEMENTS: [string, string][] = [
  [
    "payroll_run_lines.advance_hours",
    `ALTER TABLE payroll_run_lines
       ADD COLUMN IF NOT EXISTS advance_hours numeric(8,2) NOT NULL DEFAULT '0'`,
  ],
  [
    "payroll_run_lines.advance_amount",
    `ALTER TABLE payroll_run_lines
       ADD COLUMN IF NOT EXISTS advance_amount numeric(18,2) NOT NULL DEFAULT '0'`,
  ],
  [
    "payroll_settings.standard_monthly_hours",
    `ALTER TABLE payroll_settings
       ADD COLUMN IF NOT EXISTS standard_monthly_hours numeric(8,2) NOT NULL DEFAULT '168'`,
  ],
];

async function main() {
  for (const [label, statement] of STATEMENTS) {
    await sql.unsafe(statement);
    console.log(`  ✓ ${label}`);
  }
  const rows = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE (table_name = 'payroll_run_lines'
             AND column_name IN ('advance_hours', 'advance_amount'))
       OR (table_name = 'payroll_settings'
             AND column_name = 'standard_monthly_hours')
    ORDER BY table_name, column_name
  `;
  console.log(
    rows.length === 3
      ? "✓ Урьдчилгаа цалингийн 3 багана бэлэн"
      : `✗ Хүлээгдсэн 3 багана, олдсон ${rows.length}`
  );
  await sql.end();
  process.exit(rows.length === 3 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Үндсэн хөрөнгийн элэгдлийн шинэчлэлийг live DB-д АЮУЛГҮЙ хэрэглэх скрипт:
// өдрийн суурь, байршил, татварын зорилгоорх элэгдэл.
// TRUNCATE/DROP огт хийхгүй, идемпотент.
// Ажиллуулах: npx tsx scripts/apply-fa-depreciation-ddl.ts

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL алга (.env.local)");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

const STATEMENTS: [string, string][] = [
  [
    "fixed_assets.location",
    `ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS location text`,
  ],
  [
    "fixed_assets.sub_location",
    `ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS sub_location text`,
  ],
  [
    "fixed_assets.depreciation_start_date",
    `ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS depreciation_start_date text`,
  ],
  [
    "fixed_assets.tax_useful_life_months",
    `ALTER TABLE fixed_assets
       ADD COLUMN IF NOT EXISTS tax_useful_life_months integer NOT NULL DEFAULT 0`,
  ],
  [
    "fixed_assets.tax_depreciation_method",
    `ALTER TABLE fixed_assets
       ADD COLUMN IF NOT EXISTS tax_depreciation_method text
       NOT NULL DEFAULT 'straight_line'`,
  ],
  [
    "fa_depreciation_entries.tax_amount",
    `ALTER TABLE fa_depreciation_entries
       ADD COLUMN IF NOT EXISTS tax_amount numeric(18,2) NOT NULL DEFAULT '0'`,
  ],
  [
    "fa_depreciation_entries.depreciated_days",
    `ALTER TABLE fa_depreciation_entries
       ADD COLUMN IF NOT EXISTS depreciated_days integer NOT NULL DEFAULT 0`,
  ],
  [
    "fa_settings (хүснэгт)",
    `CREATE TABLE IF NOT EXISTS fa_settings (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
       depreciation_basis text NOT NULL DEFAULT 'monthly',
       updated_at timestamp NOT NULL DEFAULT now()
     )`,
  ],
  [
    "fa_settings_organization_id_ux",
    `CREATE UNIQUE INDEX IF NOT EXISTS fa_settings_organization_id_ux
       ON fa_settings (organization_id)`,
  ],
];

async function main() {
  for (const [label, statement] of STATEMENTS) {
    await sql.unsafe(statement);
    console.log(`  ✓ ${label}`);
  }
  const [cols] = await sql`
    SELECT count(*)::text AS n FROM information_schema.columns
    WHERE (table_name = 'fixed_assets'
             AND column_name IN ('location', 'sub_location',
                                 'depreciation_start_date',
                                 'tax_useful_life_months',
                                 'tax_depreciation_method'))
       OR (table_name = 'fa_depreciation_entries'
             AND column_name IN ('tax_amount', 'depreciated_days'))
       OR (table_name = 'fa_settings'
             AND column_name = 'depreciation_basis')`;
  const ok = Number(cols.n) === 8;
  console.log(ok ? "✓ Элэгдлийн 8 багана бэлэн" : `✗ Хүлээгдсэн 8, олдсон ${cols.n}`);
  await sql.end();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

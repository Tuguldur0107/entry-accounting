// Бараа материалын периодын үлдэгдлийн хүснэгтийг live DB-д аюулгүй хэрэглэнэ
// (идемпотент). Ажиллуулах: npx tsx scripts/apply-inventory-period-balances-ddl.ts
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL алга"); process.exit(1); }
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
async function run(label: string, statement: string) {
  try { await sql.unsafe(statement); console.log(`✓ ${label}`); }
  catch (error) { console.log(`✗ ${label}: ${(error as Error).message}`); process.exitCode = 1; }
}
async function main() {
  await run("inventory_period_balances хүснэгт", `create table if not exists inventory_period_balances (
    id uuid primary key default gen_random_uuid(),
    user_id text not null references users(id) on delete cascade,
    organization_id uuid not null references organizations(id) on delete cascade,
    period_code text not null,
    item_id uuid not null references inventory_items(id) on delete cascade,
    warehouse_id uuid not null references warehouses(id) on delete cascade,
    quantity numeric(18,4) not null default '0',
    created_at timestamp not null default now(),
    constraint inventory_period_balances_organization_id_period_code_item_id_warehouse_id_unique
      unique (organization_id, period_code, item_id, warehouse_id)
  )`);
  await run("inventory_period_balances_org_period_ix", `create index if not exists inventory_period_balances_org_period_ix on inventory_period_balances (organization_id, period_code)`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

// Кассын дансны периодын үлдэгдлийн хүснэгтийг live DB-д аюулгүй хэрэглэнэ
// (идемпотент). Ажиллуулах: npx tsx scripts/apply-cash-period-balances-ddl.ts
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
  await run("cash_account_period_balances хүснэгт", `create table if not exists cash_account_period_balances (
    id uuid primary key default gen_random_uuid(),
    user_id text not null references users(id) on delete cascade,
    organization_id uuid not null references organizations(id) on delete cascade,
    period_code text not null,
    cash_account_id uuid not null references cash_accounts(id) on delete cascade,
    currency text not null,
    closing_balance numeric(18,2) not null default '0',
    created_at timestamp not null default now(),
    constraint cash_account_period_balances_organization_id_period_code_cash_account_id_unique
      unique (organization_id, period_code, cash_account_id)
  )`);
  await run("cash_account_period_balances_org_account_ix", `create index if not exists cash_account_period_balances_org_account_ix on cash_account_period_balances (organization_id, cash_account_id, period_code)`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

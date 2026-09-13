// Ханшийн түүхийн хүснэгтийг live DB-д АЮУЛГҮЙ хэрэглэх скрипт
// (идемпотент, TRUNCATE/DROP хийхгүй). apply-audit-ddl.ts-тэй ижил загвар.
// Ажиллуулах: npx tsx scripts/apply-exchange-rates-ddl.ts

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL алга (.env.local)");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let failures = 0;

async function run(label: string, statement: string) {
  try {
    await sql.unsafe(statement);
    console.log(`✓ ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`✗ ${label}: ${(error as Error).message}`);
  }
}

async function main() {
  await run(
    "exchange_rates хүснэгт",
    `create table if not exists exchange_rates (
      id uuid primary key default gen_random_uuid(),
      source text not null,
      date text not null,
      currency text not null,
      official_rate numeric(18,8),
      non_cash_buy_rate numeric(18,8),
      non_cash_sell_rate numeric(18,8),
      cash_buy_rate numeric(18,8),
      cash_sell_rate numeric(18,8),
      source_url text,
      fetched_at timestamp not null default now(),
      fetched_by text references users(id) on delete set null,
      constraint exchange_rates_source_currency_date_unique unique (source, currency, date)
    )`
  );
  await run(
    "exchange_rates_currency_date_ix",
    `create index if not exists exchange_rates_currency_date_ix on exchange_rates (currency, date)`
  );
  await run(
    "exchange_rates_source_date_ix",
    `create index if not exists exchange_rates_source_date_ix on exchange_rates (source, date)`
  );

  console.log(failures === 0 ? "\nДууслаа — бүх DDL хэрэгжлээ." : `\nДууслаа — ${failures} алдаа.`);
  await sql.end();
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

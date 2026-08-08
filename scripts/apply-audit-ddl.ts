// Аудитын schema өөрчлөлтийг live DB-д АЮУЛГҮЙ хэрэглэх скрипт.
// drizzle-kit push-ийн интерактив (truncate санал болгодог) урсгалыг тойрч,
// TRUNCATE/DROP огт хийхгүйгээр идемпотент DDL ажиллуулна.
// Ажиллуулах: npx tsx scripts/apply-audit-ddl.ts

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL алга (.env.local)");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });

async function check(label: string, query: Promise<{ n: string }[]>) {
  const [row] = await query;
  const n = Number(row?.n ?? 0);
  console.log(`${n === 0 ? "✓" : "✗"} ${label}: давхардал ${n}`);
  return n === 0;
}

async function run(label: string, statement: string) {
  try {
    await sql.unsafe(statement);
    console.log(`✓ ${label}`);
  } catch (error) {
    console.log(`✗ ${label}: ${(error as Error).message}`);
  }
}

async function main() {
  console.log("── Давхардлын шалгалт (unique constraint-уудын өмнө) ──");
  const ok1 = await check(
    "cash_documents (user_id, document_no)",
    sql`select count(*)::text as n from (
      select user_id, document_no from cash_documents
      group by user_id, document_no having count(*) > 1) d`
  );
  const ok2 = await check(
    "cost_entries идэвхтэй үндсэн үнэлгээ 1:1",
    sql`select count(*)::text as n from (
      select movement_id from cost_entries
      where movement_id is not null and status <> 'reversed'
        and entry_type <> 'landed_cost'
      group by movement_id having count(*) > 1) d`
  );
  const ok3 = await check(
    "fa_depreciation_entries (asset_id, period_month) идэвхтэй",
    sql`select count(*)::text as n from (
      select asset_id, period_month from fa_depreciation_entries
      where status <> 'reversed'
      group by asset_id, period_month having count(*) > 1) d`
  );

  console.log("\n── DDL хэрэглэлт (идемпотент, truncate ХИЙХГҮЙ) ──");

  if (ok1)
    await run(
      "cash_documents unique (user_id, document_no)",
      `do $$ begin
        alter table cash_documents
          add constraint cash_documents_user_id_document_no_unique
          unique (user_id, document_no);
      exception when duplicate_object then null; when duplicate_table then null; end $$`
    );

  // Hot path индексүүд
  const indexes: [string, string][] = [
    ["journal_vouchers_user_date_ix", "journal_vouchers (user_id, date)"],
    ["journal_vouchers_user_status_ix", "journal_vouchers (user_id, status)"],
    ["journal_lines_voucher_ix", "journal_lines (voucher_id)"],
    ["cash_documents_user_status_ix", "cash_documents (user_id, status)"],
    ["cash_documents_user_date_ix", "cash_documents (user_id, date)"],
    ["ar_ap_documents_user_status_ix", "ar_ap_documents (user_id, status)"],
    ["ar_ap_documents_user_date_ix", "ar_ap_documents (user_id, date)"],
    ["ar_ap_settlements_document_ix", "ar_ap_settlements (document_id)"],
    ["inventory_movements_user_status_ix", "inventory_movements (user_id, status)"],
    ["inventory_movements_user_date_ix", "inventory_movements (user_id, date)"],
    ["cost_entries_user_status_ix", "cost_entries (user_id, status)"],
  ];
  for (const [name, def] of indexes)
    await run(name, `create index if not exists ${name} on ${def}`);

  await run(
    "journal_lines_cost_entry_ix (partial)",
    `create index if not exists journal_lines_cost_entry_ix
     on journal_lines (cost_entry_id) where cost_entry_id is not null`
  );
  await run(
    "journal_lines_inventory_movement_ix (partial)",
    `create index if not exists journal_lines_inventory_movement_ix
     on journal_lines (inventory_movement_id) where inventory_movement_id is not null`
  );
  await run(
    "ar_ap_settlements_cash_document_ix (partial)",
    `create index if not exists ar_ap_settlements_cash_document_ix
     on ar_ap_settlements (cash_document_id) where cash_document_id is not null`
  );

  if (ok2)
    await run(
      "cost_entries_movement_active_uq (partial unique)",
      `create unique index if not exists cost_entries_movement_active_uq
       on cost_entries (movement_id)
       where movement_id is not null and status <> 'reversed'
         and entry_type <> 'landed_cost'`
    );
  if (ok3)
    await run(
      "fa_dep_entries_asset_month_active_uq (partial unique)",
      `create unique index if not exists fa_dep_entries_asset_month_active_uq
       on fa_depreciation_entries (asset_id, period_month)
       where status <> 'reversed'`
    );

  await run(
    "journal_vouchers.status default 'draft'",
    `alter table journal_vouchers alter column status set default 'draft'`
  );
  await run(
    "journal_vouchers.reversal_of_voucher_id багана",
    `alter table journal_vouchers add column if not exists reversal_of_voucher_id uuid`
  );
  await run(
    "reversal_of_voucher_id FK (cascade)",
    `do $$ begin
      alter table journal_vouchers
        add constraint journal_vouchers_reversal_of_voucher_id_journal_vouchers_id_fk
        foreign key (reversal_of_voucher_id) references journal_vouchers(id)
        on delete cascade;
    exception when duplicate_object then null; end $$`
  );
  await run(
    "costing_account_settings.fx_gain_account_number",
    `alter table costing_account_settings
     add column if not exists fx_gain_account_number text not null default '51800001'`
  );
  await run(
    "costing_account_settings.fx_loss_account_number",
    `alter table costing_account_settings
     add column if not exists fx_loss_account_number text not null default '87000003'`
  );
  await run(
    "vat_settings хүснэгт",
    `create table if not exists vat_settings (
      id uuid primary key default gen_random_uuid(),
      user_id text not null unique references users(id) on delete cascade,
      output_vat_account_number text not null default '31410000',
      input_vat_account_number text not null default '13620000',
      vat_rate_percent numeric(5,2) not null default '10',
      updated_at timestamp not null default now()
    )`
  );

  // ── Цалингийн модуль (0017_daily_rachel_grey-тэй ижил) ──
  await run(
    "employees хүснэгт",
    `create table if not exists employees (
      id uuid primary key default gen_random_uuid(),
      user_id text not null references users(id) on delete cascade,
      name text not null,
      position text not null default '',
      base_salary numeric(18,2) not null default '0',
      accident_rate_percent numeric(5,2) not null default '0.8',
      is_active boolean not null default true,
      created_at timestamp not null default now(),
      constraint employees_user_id_name_unique unique (user_id, name)
    )`
  );
  await run(
    "payroll_settings хүснэгт",
    `create table if not exists payroll_settings (
      id uuid primary key default gen_random_uuid(),
      user_id text not null unique references users(id) on delete cascade,
      salary_expense_account_number text not null default '72100000',
      employer_si_expense_account_number text not null default '72100002',
      si_payable_account_number text not null default '31420000',
      pit_payable_account_number text not null default '31430000',
      salary_payable_account_number text not null default '31500001',
      deduction_account_number text not null default '31900001',
      minimum_wage numeric(18,2) not null default '792000',
      si_cap_multiplier integer not null default 10,
      monthly_tax_free numeric(18,2) not null default '0',
      updated_at timestamp not null default now()
    )`
  );
  await run(
    "payroll_runs хүснэгт",
    `create table if not exists payroll_runs (
      id uuid primary key default gen_random_uuid(),
      user_id text not null references users(id) on delete cascade,
      period_month text not null,
      status text not null default 'draft',
      voucher_id uuid references journal_vouchers(id) on delete set null,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      constraint payroll_runs_user_id_period_month_unique unique (user_id, period_month)
    )`
  );
  await run(
    "payroll_run_lines хүснэгт",
    `create table if not exists payroll_run_lines (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references payroll_runs(id) on delete cascade,
      employee_id uuid not null references employees(id) on delete restrict,
      earnings numeric(18,2) not null,
      other_deductions numeric(18,2) not null default '0',
      employee_si numeric(18,2) not null,
      employer_si numeric(18,2) not null,
      pit numeric(18,2) not null,
      net_salary numeric(18,2) not null,
      sort_order integer not null default 0
    )`
  );

  // ── Audit log + expiry (0018_productive_raza-тай ижил) ──
  await run(
    "audit_events хүснэгт",
    `create table if not exists audit_events (
      id uuid primary key default gen_random_uuid(),
      user_id text not null references users(id) on delete cascade,
      action text not null,
      entity_type text not null,
      entity_id text not null,
      summary text not null default '',
      created_at timestamp not null default now()
    )`
  );
  await run(
    "audit_events_user_created_ix",
    `create index if not exists audit_events_user_created_ix
     on audit_events (user_id, created_at)`
  );
  await run(
    "ar_ap_invoice_sends.expires_at",
    `alter table ar_ap_invoice_sends add column if not exists expires_at timestamp`
  );
  await run(
    "api_tokens.expires_at",
    `alter table api_tokens add column if not exists expires_at timestamp`
  );

  console.log("\nДууслаа.");
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

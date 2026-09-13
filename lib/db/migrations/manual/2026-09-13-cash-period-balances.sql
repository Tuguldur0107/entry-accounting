-- Кассын дансны периодын хаалтын үлдэгдэл (snapshot + delta, П28-ын кассын хувилбар).
-- ЖИНХЭНЭ ХЭРЭГЛЭСЭН зам: npx tsx scripts/apply-cash-period-balances-ddl.ts (идемпотент).
-- Хэрэглэсэн: 2026-09-13. Дараа нь scripts/backfill-period-snapshots.ts-ээр хаагдсан үеүдийг нөхнө.
create table if not exists cash_account_period_balances (
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
);
create index if not exists cash_account_period_balances_org_account_ix on cash_account_period_balances (organization_id, cash_account_id, period_code);

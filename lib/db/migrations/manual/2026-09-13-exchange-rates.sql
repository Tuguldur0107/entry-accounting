-- Ханшийн түүх (нийтийн лавлах — organizationId БАЙХГҮЙ).
-- ЖИНХЭНЭ ХЭРЭГЛЭСЭН зам: npx tsx scripts/apply-exchange-rates-ddl.ts
-- (идемпотент, truncate хийхгүй). Энэ файл нь бүртгэл (manual/README дүрэм 4).
-- Хэрэглэсэн: 2026-09-13, Railway production DB.

create table if not exists exchange_rates (
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
);

create index if not exists exchange_rates_currency_date_ix on exchange_rates (currency, date);
create index if not exists exchange_rates_source_date_ix on exchange_rates (source, date);

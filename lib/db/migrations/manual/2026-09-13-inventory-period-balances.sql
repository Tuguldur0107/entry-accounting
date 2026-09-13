-- Бараа × агуулахын периодын хаалтын үлдэгдэл (snapshot + delta, П28-ын бараа материалын хувилбар).
-- ЖИНХЭНЭ ХЭРЭГЛЭСЭН зам: npx tsx scripts/apply-inventory-period-balances-ddl.ts (идемпотент).
-- Хэрэглэсэн: 2026-09-13. Дараа нь scripts/backfill-period-snapshots.ts-ээр хаагдсан үеүдийг нөхнө.
create table if not exists inventory_period_balances (
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
);
create index if not exists inventory_period_balances_org_period_ix on inventory_period_balances (organization_id, period_code);

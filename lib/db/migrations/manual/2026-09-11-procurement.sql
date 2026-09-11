-- Хангамжийн модуль (PO + хүлээн авалт + landed cost + хавсралт)
-- docs/procurement/00-proposal.md §3.2. ЖИНХЭНЭ ХЭРЭГЛЭСЭН зам:
--   npx tsx scripts/apply-procurement-ddl.ts   (идемпотент, truncate хийхгүй)
-- Энэ файл нь тухайн скриптийн DDL-ийн бүртгэл (manual/README.md дүрэм 4).
-- Хэрэглэсэн: 2026-09-11, Railway production DB.

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  document_no text not null,
  counterparty_id uuid not null references counterparties(id) on delete restrict,
  date text not null,
  expected_date text,
  currency text not null default 'MNT',
  warehouse_id uuid references warehouses(id) on delete restrict,
  description text not null default '',
  status text not null default 'draft',
  total_amount numeric(18,2) not null default '0',
  external_ref text,
  approved_at timestamp,
  closed_at timestamp,
  close_voucher_id uuid references journal_vouchers(id) on delete set null,
  close_exchange_rate numeric(18,8),
  created_at timestamp not null default now(),
  constraint purchase_orders_organization_id_document_no_unique unique (organization_id, document_no)
);

create table if not exists purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  item_id uuid not null references inventory_items(id) on delete restrict,
  quantity numeric(18,4) not null,
  unit_price numeric(18,4) not null,
  amount numeric(18,2) not null,
  warehouse_id uuid references warehouses(id) on delete restrict,
  description text not null default '',
  sort_order integer not null default 0
);

create table if not exists goods_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  purchase_order_id uuid not null references purchase_orders(id) on delete restrict,
  document_no text not null,
  date text not null,
  warehouse_id uuid not null references warehouses(id) on delete restrict,
  exchange_rate numeric(18,8) not null default '1',
  rate_source text not null default 'mongolbank',
  rate_date text,
  description text not null default '',
  status text not null default 'draft',
  voucher_id uuid references journal_vouchers(id) on delete set null,
  reversal_voucher_id uuid references journal_vouchers(id) on delete set null,
  confirmed_at timestamp,
  created_at timestamp not null default now(),
  constraint goods_receipts_organization_id_document_no_unique unique (organization_id, document_no)
);

create table if not exists goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references goods_receipts(id) on delete cascade,
  purchase_order_line_id uuid not null references purchase_order_lines(id) on delete restrict,
  quantity numeric(18,4) not null,
  movement_id uuid references inventory_movements(id) on delete set null,
  sort_order integer not null default 0
);

create table if not exists document_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  kind text not null default 'other',
  name text not null,
  media_type text not null,
  size_bytes integer not null,
  data text not null,
  created_at timestamp not null default now()
);

create index if not exists purchase_orders_org_status_ix on purchase_orders (organization_id, status);
create index if not exists purchase_orders_org_date_ix on purchase_orders (organization_id, date);
create index if not exists purchase_orders_org_counterparty_ix on purchase_orders (organization_id, counterparty_id);
create unique index if not exists purchase_orders_org_external_ref_uq on purchase_orders (organization_id, external_ref) where external_ref is not null;
create index if not exists purchase_order_lines_po_ix on purchase_order_lines (purchase_order_id);
create index if not exists goods_receipts_org_status_ix on goods_receipts (organization_id, status);
create index if not exists goods_receipts_po_date_ix on goods_receipts (purchase_order_id, date);
create index if not exists goods_receipts_org_date_ix on goods_receipts (organization_id, date);
create index if not exists goods_receipt_lines_receipt_ix on goods_receipt_lines (receipt_id);
create index if not exists goods_receipt_lines_po_line_ix on goods_receipt_lines (purchase_order_line_id);
create index if not exists document_attachments_org_entity_ix on document_attachments (organization_id, entity_type, entity_id);

alter table costing_account_settings add column if not exists ap_clearing_account_number text not null default '31000099';
alter table counterparties
  add column if not exists contact_person text,
  add column if not exists bank_name text,
  add column if not exists bank_account_no text;
alter table ar_ap_documents add column if not exists purchase_order_id uuid;
alter table ar_ap_document_lines
  add column if not exists purchase_order_line_id uuid,
  add column if not exists unit_price numeric(18,4),
  add column if not exists cost_component_id uuid;
alter table journal_lines
  add column if not exists business_object_type text,
  add column if not exists business_object_id uuid;
alter table cost_entries
  add column if not exists source_line_id uuid,
  add column if not exists business_object_type text,
  add column if not exists business_object_id uuid;
alter table cost_allocations
  add column if not exists source_line_id uuid,
  add column if not exists purchase_order_id uuid;

-- FK / CHECK нь скриптэд `do $$ … exception when duplicate_object` дотор
-- хэрэгжсэн (дахин ажиллуулахад аюулгүй): ar_ap_documents.purchase_order_id,
-- ar_ap_document_lines.(purchase_order_line_id, cost_component_id),
-- cost_entries.source_line_id, cost_allocations.(source_line_id, purchase_order_id),
-- ar_ap_document_lines_item_xor_component CHECK.

create index if not exists ar_ap_documents_po_ix on ar_ap_documents (purchase_order_id) where purchase_order_id is not null;
create index if not exists ar_ap_document_lines_po_line_ix on ar_ap_document_lines (purchase_order_line_id) where purchase_order_line_id is not null;
create index if not exists ar_ap_document_lines_component_ix on ar_ap_document_lines (cost_component_id) where cost_component_id is not null;
create index if not exists journal_lines_business_object_ix on journal_lines (business_object_type, business_object_id) where business_object_id is not null;
create index if not exists cost_entries_source_line_ix on cost_entries (source_line_id) where source_line_id is not null;
create index if not exists cost_entries_business_object_ix on cost_entries (business_object_type, business_object_id) where business_object_id is not null;
create index if not exists cost_allocations_source_line_ix on cost_allocations (source_line_id) where source_line_id is not null;
create index if not exists cost_allocations_po_ix on cost_allocations (purchase_order_id) where purchase_order_id is not null;

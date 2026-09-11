// Хангамжийн модулийн (PO + хүлээн авалт + хавсралт) schema өөрчлөлтийг live
// DB-д АЮУЛГҮЙ хэрэглэх скрипт — drizzle-kit push-ийн интерактив (truncate
// санал болгодог) урсгалыг тойрч, TRUNCATE/DROP огт хийхгүйгээр идемпотент
// DDL ажиллуулна. apply-audit-ddl.ts-тэй ижил загвар.
// Ажиллуулах: npx tsx scripts/apply-procurement-ddl.ts

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL алга (.env.local)");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });

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
  console.log("── Хангамж: шинэ хүснэгтүүд ──");

  await run(
    "purchase_orders хүснэгт",
    `create table if not exists purchase_orders (
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
      constraint purchase_orders_organization_id_document_no_unique
        unique (organization_id, document_no)
    )`
  );
  await run(
    "purchase_order_lines хүснэгт",
    `create table if not exists purchase_order_lines (
      id uuid primary key default gen_random_uuid(),
      purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
      item_id uuid not null references inventory_items(id) on delete restrict,
      quantity numeric(18,4) not null,
      unit_price numeric(18,4) not null,
      amount numeric(18,2) not null,
      warehouse_id uuid references warehouses(id) on delete restrict,
      description text not null default '',
      sort_order integer not null default 0
    )`
  );
  await run(
    "goods_receipts хүснэгт",
    `create table if not exists goods_receipts (
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
      constraint goods_receipts_organization_id_document_no_unique
        unique (organization_id, document_no)
    )`
  );
  await run(
    "goods_receipt_lines хүснэгт",
    `create table if not exists goods_receipt_lines (
      id uuid primary key default gen_random_uuid(),
      receipt_id uuid not null references goods_receipts(id) on delete cascade,
      purchase_order_line_id uuid not null references purchase_order_lines(id) on delete restrict,
      quantity numeric(18,4) not null,
      movement_id uuid references inventory_movements(id) on delete set null,
      sort_order integer not null default 0
    )`
  );
  await run(
    "document_attachments хүснэгт",
    `create table if not exists document_attachments (
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
    )`
  );

  console.log("\n── Хангамж: индексүүд ──");
  const indexes: [string, string][] = [
    ["purchase_orders_org_status_ix", "purchase_orders (organization_id, status)"],
    ["purchase_orders_org_date_ix", "purchase_orders (organization_id, date)"],
    [
      "purchase_orders_org_counterparty_ix",
      "purchase_orders (organization_id, counterparty_id)",
    ],
    ["purchase_order_lines_po_ix", "purchase_order_lines (purchase_order_id)"],
    ["goods_receipts_org_status_ix", "goods_receipts (organization_id, status)"],
    ["goods_receipts_po_date_ix", "goods_receipts (purchase_order_id, date)"],
    ["goods_receipts_org_date_ix", "goods_receipts (organization_id, date)"],
    ["goods_receipt_lines_receipt_ix", "goods_receipt_lines (receipt_id)"],
    [
      "goods_receipt_lines_po_line_ix",
      "goods_receipt_lines (purchase_order_line_id)",
    ],
    [
      "document_attachments_org_entity_ix",
      "document_attachments (organization_id, entity_type, entity_id)",
    ],
  ];
  for (const [name, def] of indexes)
    await run(name, `create index if not exists ${name} on ${def}`);

  await run(
    "purchase_orders_org_external_ref_uq (partial unique)",
    `create unique index if not exists purchase_orders_org_external_ref_uq
     on purchase_orders (organization_id, external_ref)
     where external_ref is not null`
  );

  console.log("\n── Байгаа хүснэгтүүдийн шинэ багана ──");
  await run(
    "costing_account_settings.ap_clearing_account_number",
    `alter table costing_account_settings
     add column if not exists ap_clearing_account_number text not null default '31000099'`
  );
  await run(
    "counterparties.contact_person / bank_name / bank_account_no",
    `alter table counterparties
       add column if not exists contact_person text,
       add column if not exists bank_name text,
       add column if not exists bank_account_no text`
  );
  await run(
    "ar_ap_documents.purchase_order_id",
    `alter table ar_ap_documents add column if not exists purchase_order_id uuid`
  );
  await run(
    "ar_ap_documents.purchase_order_id FK",
    `do $$ begin
      alter table ar_ap_documents
        add constraint ar_ap_documents_purchase_order_id_purchase_orders_id_fk
        foreign key (purchase_order_id) references purchase_orders(id)
        on delete restrict;
    exception when duplicate_object then null; end $$`
  );
  await run(
    "ar_ap_documents_po_ix (partial)",
    `create index if not exists ar_ap_documents_po_ix
     on ar_ap_documents (purchase_order_id) where purchase_order_id is not null`
  );
  await run(
    "ar_ap_document_lines.purchase_order_line_id / unit_price / cost_component_id",
    `alter table ar_ap_document_lines
       add column if not exists purchase_order_line_id uuid,
       add column if not exists unit_price numeric(18,4),
       add column if not exists cost_component_id uuid`
  );
  await run(
    "ar_ap_document_lines FK-ууд",
    `do $$ begin
      alter table ar_ap_document_lines
        add constraint ar_ap_document_lines_purchase_order_line_id_purchase_order_lines_id_fk
        foreign key (purchase_order_line_id) references purchase_order_lines(id)
        on delete restrict;
    exception when duplicate_object then null; end $$;
     do $$ begin
      alter table ar_ap_document_lines
        add constraint ar_ap_document_lines_cost_component_id_cost_components_id_fk
        foreign key (cost_component_id) references cost_components(id)
        on delete restrict;
    exception when duplicate_object then null; end $$`
  );
  await run(
    "ar_ap_document_lines_item_xor_component (CHECK)",
    `do $$ begin
      alter table ar_ap_document_lines
        add constraint ar_ap_document_lines_item_xor_component
        check (not (item_id is not null and cost_component_id is not null));
    exception when duplicate_object then null; end $$`
  );
  await run(
    "ar_ap_document_lines индексүүд (partial)",
    `create index if not exists ar_ap_document_lines_po_line_ix
       on ar_ap_document_lines (purchase_order_line_id)
       where purchase_order_line_id is not null;
     create index if not exists ar_ap_document_lines_component_ix
       on ar_ap_document_lines (cost_component_id)
       where cost_component_id is not null`
  );
  await run(
    "journal_lines.business_object_type / business_object_id",
    `alter table journal_lines
       add column if not exists business_object_type text,
       add column if not exists business_object_id uuid`
  );
  await run(
    "journal_lines_business_object_ix (partial)",
    `create index if not exists journal_lines_business_object_ix
     on journal_lines (business_object_type, business_object_id)
     where business_object_id is not null`
  );
  await run(
    "cost_entries.source_line_id / business_object_type / business_object_id",
    `alter table cost_entries
       add column if not exists source_line_id uuid,
       add column if not exists business_object_type text,
       add column if not exists business_object_id uuid`
  );
  await run(
    "cost_entries.source_line_id FK",
    `do $$ begin
      alter table cost_entries
        add constraint cost_entries_source_line_id_ar_ap_document_lines_id_fk
        foreign key (source_line_id) references ar_ap_document_lines(id)
        on delete set null;
    exception when duplicate_object then null; end $$`
  );
  await run(
    "cost_entries индексүүд (partial)",
    `create index if not exists cost_entries_source_line_ix
       on cost_entries (source_line_id) where source_line_id is not null;
     create index if not exists cost_entries_business_object_ix
       on cost_entries (business_object_type, business_object_id)
       where business_object_id is not null`
  );
  await run(
    "cost_allocations.source_line_id / purchase_order_id",
    `alter table cost_allocations
       add column if not exists source_line_id uuid,
       add column if not exists purchase_order_id uuid`
  );
  await run(
    "cost_allocations FK-ууд",
    `do $$ begin
      alter table cost_allocations
        add constraint cost_allocations_source_line_id_ar_ap_document_lines_id_fk
        foreign key (source_line_id) references ar_ap_document_lines(id)
        on delete restrict;
    exception when duplicate_object then null; end $$;
     do $$ begin
      alter table cost_allocations
        add constraint cost_allocations_purchase_order_id_purchase_orders_id_fk
        foreign key (purchase_order_id) references purchase_orders(id)
        on delete restrict;
    exception when duplicate_object then null; end $$`
  );
  await run(
    "cost_allocations индексүүд (partial)",
    `create index if not exists cost_allocations_source_line_ix
       on cost_allocations (source_line_id) where source_line_id is not null;
     create index if not exists cost_allocations_po_ix
       on cost_allocations (purchase_order_id) where purchase_order_id is not null`
  );

  console.log(failures === 0 ? "\nДууслаа — бүх DDL хэрэгжлээ." : `\nДууслаа — ${failures} алдаа.`);
  await sql.end();
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

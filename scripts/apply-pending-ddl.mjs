// Deploy-ийн ӨМНӨХ идемпотент DDL — `drizzle-kit push`-оос ӨМНӨ ажиллана.
//
// ШАЛТГААН: drizzle-kit 0.31.x-ийн push нь `--force`-той ч БӨГЛӨӨТЭЙ хүснэгтэд
// unique CONSTRAINT нэмэхдээ "truncate хийх үү?" гэж ИНТЕРАКТИВ асуудаг —
// Railway-ийн non-TTY preDeploy дээр
//   "Error: Interactive prompts require a TTY terminal"
// гэж унаж, схемийн БҮХ өөрчлөлт DB-д ОРОХГҮЙ үлддэг (2026-09-18: шинэ багана
// орж чадаагүйгээс /settings/gl 500 өгсөн).
//
// Тиймээс: (а) push-д асуулт үүсгэдэг объектыг урьдчилж CONSTRAINT-ээс unique
// INDEX болгож хувиргана (schema.ts мөн uniqueIndex зарладаг — ижил нэр, ижил
// семантик тул push-д diff үлдэхгүй), (б) шинэ багануудыг `if not exists`-ээр
// өөрсдөө нэмнэ.
//
// ДҮРЭМ: энэ файл ЗӨВХӨН идемпотент, өгөгдөл АЛДАХГҮЙ (truncate/drop table
// хийхгүй) statement агуулна. tsx БИШ, plain node — production install-д
// devDependency (tsx) байхгүй байж болзошгүй; `postgres`, `dotenv` нь runtime
// dependency.
//
// Ажиллуулах: node scripts/apply-pending-ddl.mjs   (preDeploy автоматаар дуудна)

import { config } from "dotenv";
import postgres from "postgres";

import { REMOVED_COLUMNS, REMOVED_TABLES } from "./lib/removed-schema-objects.mjs";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("apply-pending-ddl: DATABASE_URL алга — DDL алгаслаа");
  process.exit(0);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let failures = 0;

async function run(label, statement) {
  try {
    await sql.unsafe(statement);
    console.log(`✓ ${label}`);
  } catch (error) {
    // 42P01 = undefined_table. Хуучин DB дээр шинэ хүснэгт хараахан байхгүй
    // байж болно (энэ скрипт push-ээс ӨМНӨ ажилладаг) — тэгвэл push тэр
    // хүснэгтийг схемээс БҮТНЭЭР нь үүсгэх тул энд хийх зүйл алга. Алдаа гэж
    // тоолбол хуучин DB бүр дээр preDeploy хуурамч улаан лог гаргана.
    if (error.code === "42P01") {
      console.log(`⊘ ${label}: хүснэгт хараахан үүсээгүй — push үүсгэнэ`);
      return;
    }
    failures += 1;
    console.log(`✗ ${label}: ${error.message}`);
  }
}

async function main() {
  // ── 0. Схемээс хасагдсан хүснэгтүүдийг archive схем рүү зөөнө ────────────
  await run("archive схем", `create schema if not exists archive`);
  for (const table of REMOVED_TABLES) {
    await run(
      `${table} → archive схем`,
      `do $$
       declare
         fk record;
       begin
         if to_regclass('public.${table}') is null then
           return;
         end if;
         if to_regclass('archive.${table}') is not null then
           raise notice 'archive.${table} аль хэдийн байна — public.${table} хөндөгдсөнгүй';
           return;
         end if;
         alter table public.${table} set schema archive;
         -- Архивын хуулбар нь ЛАВЛАХ, амьд холбоос биш: public хүснэгтүүд рүү
         -- заасан FK-уудыг тайлна (эс бөгөөс дараагийн push тэдгээр хүснэгтийг
         -- өөрчлөхөд саад болно).
         for fk in
           select conname from pg_constraint
           where conrelid = 'archive.${table}'::regclass and contype = 'f'
         loop
           execute format('alter table archive.${table} drop constraint %I', fk.conname);
         end loop;
       end $$;`
    );
  }

  // ── 0a. Схемээс хасагдсан баганыг хөрвүүлээд хасна ──────────────────────
  for (const { table, column, migrate = [] } of REMOVED_COLUMNS) {
    const steps = migrate
      .map((statement) => `execute $mig$${statement}$mig$;`)
      .join("\n         ");
    await run(
      `${table}.${column} хасах (утгыг нь хөрвүүлээд)`,
      `do $$
       begin
         if not exists (
           select 1 from information_schema.columns
           where table_schema = 'public'
             and table_name = '${table}'
             and column_name = '${column}'
         ) then
           return;
         end if;
         ${steps}
         execute 'alter table public.${table} drop column ${column}';
       end $$;`
    );
  }

  // ── 0b. eBarimt: хадгалсан хариунаас сугалаа / QR-ийг цэвэрлэнэ ──────────
  // PosAPI 3.0-ийн албан заавар §5: lottery, qrData-г хэрэглэгчийн системд
  // хадгалахыг хориглоно. Шинэ код бичихээ больсон (stripReceiptSecrets);
  // өмнө бичигдсэн мөрийг нэг удаа цэвэрлэнэ. Идемпотент; хүснэгт байхгүй
  // (хуучин DB) бол run() 42P01-ийг алгасна.
  await run(
    "pos_ebarimt_submissions.response: lottery/qrData цэвэрлэх",
    `update public.pos_ebarimt_submissions
        set response = (response - 'lottery') - 'qrData'
      where response is not null
        and (response ? 'lottery' or response ? 'qrData')`
  );

  // ── 1. unique CONSTRAINT → unique INDEX (push-ийн интерактив асуултын эх) ──
  // Push нь `unique()` constraint-ыг DB-д БАЙСААР байтал "нэмэх үү, truncate
  // хийх үү?" гэж асууж preDeploy-г унагаадаг (drizzle-orm#5955 — CLAUDE.md
  // §5b; exchange_rates дээр ч ижил шалтгаанаар uniqueIndex хэрэглэсэн).
  // schema.ts эдгээрийг uniqueIndex-ээр зарладаг тул DB-г НЭГ транзакцид
  // тааруулна: шинэ индексийг үүсгээд ДАРАА нь хуучин constraint-ыг тайлна —
  // давхардлын хамгаалалт нэг ч агшинд алдагдахгүй.
  for (const target of [
    {
      table: "bank_statement_lines",
      columns: "statement_id, row_number",
      oldConstraint: "bank_statement_lines_statement_id_row_number_unique",
      index: "bank_statement_lines_statement_row_ux",
    },
    {
      table: "ai_settings",
      columns: "user_id, organization_id",
      oldConstraint: "ai_settings_user_id_organization_id_unique",
      index: "ai_settings_user_org_ux",
    },
  ]) {
    await run(
      `${target.table} (${target.columns}) → ${target.index}`,
      `do $$
       begin
         if to_regclass('${target.table}') is null then
           return;
         end if;
         if not exists (
           select 1 from pg_class
           where relname = '${target.index}' and relkind = 'i'
         ) then
           execute 'create unique index ${target.index}
             on ${target.table} (${target.columns})';
         end if;
         if exists (
           select 1 from pg_constraint
           where conname = '${target.oldConstraint}'
             and conrelid = '${target.table}'::regclass
         ) then
           alter table ${target.table}
             drop constraint ${target.oldConstraint};
         end if;
       end $$;`
    );
  }

  // ── 1a. Хуучин user-scoped unique индексүүдийг хасна ─────────────────────
  // Фаз 01-ээс хойш scope нь БАЙГУУЛЛАГА, userId нь зөвхөн createdBy. Нэг
  // хэрэглэгч хэд хэдэн компани эзэмшиж болдог тул (user_id, <код>) дээрх
  // давхардлын хориг БУРУУ: жишээ нь хоёр компанийн аль алинд 44000099 данс
  // байх нь ЗӨВ (2026-09-18 push яг үүн дээр `could not create unique index`
  // гэж унасан). Байгууллагын хүрээний хос (organization_id, <код>) хэвээр
  // хамгаална. Эдгээр нэр схемээс хасагдсан тул push өөрөө ч устгах ёстой —
  // энд нь урьдчилж, ил тодорхой хийнэ (өмнөх push хагас үүсгэсэн байж болно).
  for (const index of [
    "accounting_periods_user_id_code_ux",
    "ar_ap_documents_user_id_document_no_ux",
    "bank_statements_user_id_file_hash_ux",
    "cash_documents_user_id_document_no_ux",
    "cash_fx_revaluations_user_acct_date_rev_ux",
    "chart_of_accounts_user_id_number_ux",
    "cost_allocations_user_id_document_no_ux",
    "cost_components_user_id_code_ux",
    "cost_period_results_user_period_item_wh_ux",
    "costing_item_settings_user_id_item_id_ux",
    "counterparties_user_id_name_ux",
    "fixed_assets_user_id_code_ux",
    "inventory_issue_types_user_id_code_ux",
    "inventory_items_user_id_code_ux",
    "inventory_movements_user_id_document_no_ux",
    "module_configs_user_id_module_key_ux",
    "payroll_runs_user_id_period_month_ux",
    "report_line_mappings_user_type_line_ux",
    "segment_configs_user_id_segment_id_ux",
    "segment_values_user_id_segment_id_code_ux",
    "warehouses_user_id_code_ux",
  ]) {
    await run(`${index} хасах (user-scoped)`, `drop index if exists ${index}`);
  }

  // ── 1b. Өргөтгөлийн view-г public-оос гаргана ────────────────────────────
  // Push нь схемд зарлагдаагүй public view бүрийг DROP хийх гэж оролддог.
  // Railway-ийн `pg_stat_statements` нь public дотор view (…_info) үүсгэдэг тул
  //   "cannot drop view pg_stat_statements_info because extension … requires it"
  // гэж push БҮХЭЛДЭЭ унаж, схемийн өөрчлөлт дахиад DB-д орохгүй болно
  // (2026-09-18: unique constraint-ын асуултыг зассаны ДАРАА гарч ирсэн
  // дараагийн саад). Өргөтгөлийг `extensions` схем рүү зөөвөл drizzle-ийн
  // харах талбарт (schemaFilter = public) орохгүй тул эх үндсээрээ таслагдана.
  await run(
    "pg_stat_statements → extensions схем",
    `do $$
     begin
       if exists (
         select 1 from pg_extension e
         join pg_namespace n on n.oid = e.extnamespace
         where e.extname = 'pg_stat_statements' and n.nspname = 'public'
       ) then
         create schema if not exists extensions;
         execute 'alter extension pg_stat_statements set schema extensions';
         -- Хаяглаагүй дуудлага (Railway-ийн query insights) ажилласаар байна
         execute format(
           'alter database %I set search_path = "$user", public, extensions',
           current_database()
         );
       end if;
     end $$;`
  );

  // Үлдсэн public view-үүдийг ЛОГ дээр ил гаргана — push дараагийн удаа ямар
  // объект дээр унаж болзошгүйг урьдчилан харуулна (өөрчлөлт хийхгүй).
  try {
    const views = await sql`
      select table_name from information_schema.views
      where table_schema = 'public'
      order by table_name
    `;
    if (views.length > 0) {
      console.log(
        `⚠ public схемд ${views.length} view үлдсэн: ${views
          .map((row) => row.table_name)
          .join(", ")}`
      );
    }
  } catch (error) {
    console.log(`✗ public view жагсаалт: ${error.message}`);
  }

  // ── 1c. Журналын бичилтийн дугаар + дугаарын тоолуур ─────────────────────
  // Код нь эдгээрийг ЗААВАЛ шаарддаг (бичилт бүр дугаартай үүснэ) тул push
  // ямар нэг шалтгаанаар хожимдвол ч апп унахгүй байхаар урьдчилж нэмнэ.
  await run(
    "journal_vouchers.document_no багана",
    `alter table journal_vouchers add column if not exists document_no text`
  );
  await run(
    "journal_vouchers_org_document_no_ux индекс",
    `create unique index if not exists journal_vouchers_org_document_no_ux
       on journal_vouchers (organization_id, document_no)
       where document_no is not null`
  );
  await run(
    "document_counters хүснэгт",
    `create table if not exists document_counters (
       id uuid primary key default gen_random_uuid(),
       organization_id uuid not null references organizations(id) on delete cascade,
       scope text not null,
       value integer not null default 0,
       updated_at timestamp not null default now()
     )`
  );
  await run(
    "document_counters_org_scope_ux индекс",
    `create unique index if not exists document_counters_org_scope_ux
       on document_counters (organization_id, scope)`
  );

  // ── 2. segment_values.linked_organization_id (S1/S6 компанийн холбоос) ─────
  await run(
    "segment_values.linked_organization_id багана",
    `alter table segment_values
       add column if not exists linked_organization_id uuid`
  );
  await run(
    "segment_values.linked_organization_id FK",
    `do $$
     begin
       if not exists (
         select 1 from pg_constraint
         where conname = 'segment_values_linked_organization_id_organizations_id_fk'
       ) then
         alter table segment_values
           add constraint segment_values_linked_organization_id_organizations_id_fk
           foreign key (linked_organization_id) references organizations(id)
           on delete set null;
       end if;
     end $$;`
  );

  // ── 3. Мэдэгдлийн систем (docs/notifications/00-proposal.md фаз 0) ───────
  // Код нь эдгээр хүснэгтийг ЗААВАЛ шаарддаг (logAuditEvent-ийн хажуугийн
  // гүүр бүр бичнэ) тул push хожимдвол ч апп унахгүй байхаар урьдчилж нэмнэ.
  await run(
    "notifications хүснэгт",
    `create table if not exists notifications (
       id uuid primary key default gen_random_uuid(),
       organization_id uuid not null references organizations(id) on delete cascade,
       user_id text not null references users(id) on delete cascade,
       type text not null,
       category text not null,
       severity text not null default 'info',
       title text not null,
       body text not null default '',
       href text,
       entity_type text,
       entity_id text,
       payload text,
       actor_user_id text,
       dedupe_key text not null,
       read_at timestamp,
       emailed_at timestamp,
       created_at timestamp not null default now()
     )`
  );
  await run(
    "notifications_org_user_dedupe_ux индекс",
    `create unique index if not exists notifications_org_user_dedupe_ux
       on notifications (organization_id, user_id, dedupe_key)`
  );
  await run(
    "notifications_user_org_created_ix индекс",
    `create index if not exists notifications_user_org_created_ix
       on notifications (user_id, organization_id, created_at)`
  );
  await run(
    "notification_preferences хүснэгт",
    `create table if not exists notification_preferences (
       id uuid primary key default gen_random_uuid(),
       user_id text not null references users(id) on delete cascade,
       organization_id uuid not null references organizations(id) on delete cascade,
       channels text,
       digest_hour integer not null default 8,
       telegram_chat_id text,
       muted_until timestamp,
       updated_at timestamp not null default now()
     )`
  );
  await run(
    "notification_preferences_user_org_ux индекс",
    `create unique index if not exists notification_preferences_user_org_ux
       on notification_preferences (user_id, organization_id)`
  );
  await run(
    "notification_runs хүснэгт",
    `create table if not exists notification_runs (
       id uuid primary key default gen_random_uuid(),
       organization_id uuid not null references organizations(id) on delete cascade,
       job text not null,
       period_key text not null,
       started_at timestamp not null default now(),
       finished_at timestamp,
       emitted integer not null default 0,
       error text
     )`
  );
  await run(
    "notification_runs_job_period_org_ux индекс",
    `create unique index if not exists notification_runs_job_period_org_ux
       on notification_runs (job, period_key, organization_id)`
  );

  // ── 3a. Мэдэгдэл фаз 2: суваг бүрийн хүргэлт, Telegram, том дүнгийн босго ──
  await run(
    "notification_preferences.telegram_link_code багана",
    `alter table notification_preferences add column if not exists telegram_link_code text`
  );
  await run(
    "notification_deliveries хүснэгт",
    `create table if not exists notification_deliveries (
       id uuid primary key default gen_random_uuid(),
       notification_id uuid not null references notifications(id) on delete cascade,
       channel text not null,
       delivered_at timestamp,
       error text,
       created_at timestamp not null default now()
     )`
  );
  await run(
    "notification_deliveries_notification_channel_ux индекс",
    `create unique index if not exists notification_deliveries_notification_channel_ux
       on notification_deliveries (notification_id, channel)`
  );
  await run(
    "company_settings.large_amount_alert_mnt багана",
    `alter table company_settings add column if not exists large_amount_alert_mnt numeric(18,2)`
  );
  await run(
    "company_settings.ai_post_limit_mnt багана",
    `alter table company_settings add column if not exists ai_post_limit_mnt numeric(18,2)`
  );

  // ── 4. inventory_items.sales_price (барааны борлуулах үнэ — АР нэгж үнэ) ──
  await run(
    "inventory_items.sales_price багана",
    `alter table inventory_items
       add column if not exists sales_price numeric(18, 4)`
  );

  // ── 4. Цалингийн нэмэгдэл/олговрын АВТОМАТ бодолт (CLAUDE.md §7) ─────────
  // Цаг/хоногийн ОРЦ, автоматаар бодогдсон дүн, «гар засвар» тэмдэг ба
  // дундажийн баримт. Бүгд default-той тул байгаа мөрүүд 0-оор бөглөгдөнө.
  for (const [column, type] of [
    ["overtime_hours", "numeric(8, 2) not null default '0'"],
    ["rest_day_hours", "numeric(8, 2) not null default '0'"],
    ["holiday_hours", "numeric(8, 2) not null default '0'"],
    ["night_hours", "numeric(8, 2) not null default '0'"],
    ["vacation_days", "numeric(8, 2) not null default '0'"],
    ["sick_days", "numeric(8, 2) not null default '0'"],
    ["overtime_pay", "numeric(18, 2) not null default '0'"],
    ["sick_benefit", "numeric(18, 2) not null default '0'"],
    ["vacation_pay_manual", "boolean not null default false"],
    ["overtime_pay_manual", "boolean not null default false"],
    ["sick_benefit_manual", "boolean not null default false"],
    ["average_monthly_earnings", "numeric(18, 2) not null default '0'"],
    ["average_months_used", "integer not null default 0"],
  ]) {
    await run(
      `payroll_run_lines.${column} багана`,
      `alter table payroll_run_lines
         add column if not exists ${column} ${type}`
    );
  }

  for (const [column, type] of [
    ["monthly_work_days", "numeric(6, 2) not null default '22'"],
    ["average_earnings_months", "integer not null default 12"],
    ["overtime_multiplier", "numeric(5, 2) not null default '1.5'"],
    ["rest_day_multiplier", "numeric(5, 2) not null default '1.5'"],
    ["holiday_multiplier", "numeric(5, 2) not null default '2'"],
    ["night_bonus_rate", "numeric(5, 2) not null default '0.2'"],
    ["sick_benefit_account_number", "text"],
  ]) {
    await run(
      `payroll_settings.${column} багана`,
      `alter table payroll_settings
         add column if not exists ${column} ${type}`
    );
  }

  await run(
    "employees.sick_benefit_percent багана",
    `alter table employees
       add column if not exists sick_benefit_percent numeric(5, 2)`
  );

  // ── Цалин: урьдчилгаа / сүүл цалин, цаг дээр суурилсан олголт ──────────
  for (const [column, type] of [
    ["standard_hours", "numeric(8, 2) not null default '0'"],
    ["worked_hours", "numeric(8, 2) not null default '0'"],
    ["vacation_pay", "numeric(18, 2) not null default '0'"],
    ["other_additions", "numeric(18, 2) not null default '0'"],
    ["advance_hours", "numeric(8, 2) not null default '0'"],
    ["advance_amount", "numeric(18, 2) not null default '0'"],
  ]) {
    await run(
      `payroll_run_lines.${column} багана`,
      `alter table payroll_run_lines
         add column if not exists ${column} ${type}`
    );
  }

  for (const [column, type] of [
    ["standard_monthly_hours", "numeric(8, 2) not null default '168'"],
    ["employee_payable_account_number", "text not null default '31000001'"],
    [
      "employee_counterparty_id",
      "uuid references counterparties(id) on delete set null",
    ],
  ]) {
    await run(
      `payroll_settings.${column} багана`,
      `alter table payroll_settings
         add column if not exists ${column} ${type}`
    );
  }

  for (const [column, type] of [
    ["advance_date", "text"],
    [
      "advance_document_id",
      "uuid references ar_ap_documents(id) on delete set null",
    ],
    [
      "final_document_id",
      "uuid references ar_ap_documents(id) on delete set null",
    ],
  ]) {
    await run(
      `payroll_runs.${column} багана`,
      `alter table payroll_runs
         add column if not exists ${column} ${type}`
    );
  }

  // ── Мөнгөн гүйлгээний тайлангийн S8 mapping ────────────────────────────
  await run(
    "report_line_mappings.cf_codes багана",
    `alter table report_line_mappings
       add column if not exists cf_codes text`
  );

  // ── Үндсэн хөрөнгө: байршил, өдрийн суурь, татварын элэгдэл ────────────
  for (const [column, type] of [
    ["location", "text"],
    ["sub_location", "text"],
    ["depreciation_start_date", "text"],
    ["tax_useful_life_months", "integer not null default 0"],
    ["tax_depreciation_method", "text not null default 'straight_line'"],
  ]) {
    await run(
      `fixed_assets.${column} багана`,
      `alter table fixed_assets
         add column if not exists ${column} ${type}`
    );
  }

  for (const [column, type] of [
    ["tax_amount", "numeric(18, 2) not null default '0'"],
    ["depreciated_days", "integer not null default 0"],
  ]) {
    await run(
      `fa_depreciation_entries.${column} багана`,
      `alter table fa_depreciation_entries
         add column if not exists ${column} ${type}`
    );
  }

  await run(
    "fa_settings хүснэгт",
    `create table if not exists fa_settings (
       id uuid primary key default gen_random_uuid(),
       user_id text not null references users(id) on delete cascade,
       organization_id uuid not null references organizations(id) on delete cascade,
       depreciation_basis text not null default 'monthly',
       updated_at timestamp not null default now()
     )`
  );
  await run(
    "fa_settings_organization_id_ux индекс",
    `create unique index if not exists fa_settings_organization_id_ux
       on fa_settings (organization_id)`
  );

  // ── 5. Журналын ВАЛЮТ (CLAUDE.md §2b) — баримтад нэг валют, нэг ханш ─────
  for (const [column, type] of [
    ["currency", "text not null default 'MNT'"],
    ["exchange_rate", "numeric(18, 8) not null default '1'"],
    ["rate_source", "text"],
    ["rate_date", "text"],
  ]) {
    await run(
      `journal_vouchers.${column} багана`,
      `alter table journal_vouchers
         add column if not exists ${column} ${type}`
    );
  }
  for (const column of ["debit_fc", "credit_fc"]) {
    await run(
      `journal_lines.${column} багана`,
      `alter table journal_lines
         add column if not exists ${column} numeric(18, 2) not null default '0'`
    );
  }

  // ── 6. eBarimt 3.0 (docs/pos/03-ebarimt-integration-plan.md §4.1) ──────────
  // Бүгд default-той / null зөвшөөрдөг тул байгаа мөрүүд аюулгүй.
  for (const [table, column, type] of [
    ["inventory_items", "ebarimt_classification_code", "text"],
    ["inventory_items", "ebarimt_tax_product_code", "text"],
    ["inventory_categories", "ebarimt_classification_code", "text"],
    ["pos_payment_methods", "ebarimt_code", "text"],
    ["pos_settings", "ebarimt_enabled", "boolean not null default false"],
    ["pos_settings", "ebarimt_merchant_tin", "text not null default ''"],
    ["pos_settings", "ebarimt_branch_no", "text not null default ''"],
    ["pos_settings", "ebarimt_district_code", "text not null default ''"],
    ["pos_settings", "ebarimt_pos_no", "text not null default ''"],
    ["pos_settings", "ebarimt_pos_api_url", "text not null default 'http://localhost:7080'"],
    ["pos_settings", "ebarimt_mode", "text not null default 'server'"],
    ["pos_sales", "ebarimt_qr_data", "text"],
    ["pos_sales", "ebarimt_date", "text"],
    ["pos_sales", "ebarimt_type", "text"],
    ["pos_sales", "ebarimt_consumer_no", "text"],
    ["pos_sales", "ebarimt_customer_tin", "text"],
  ]) {
    await run(
      `${table}.${column} багана`,
      `alter table ${table}
         add column if not exists ${column} ${type}`
    );
  }
  await run(
    "pos_ebarimt_submissions хүснэгт",
    `create table if not exists pos_ebarimt_submissions (
       id uuid primary key default gen_random_uuid(),
       organization_id uuid not null references organizations(id) on delete cascade,
       sale_id uuid not null references pos_sales(id) on delete cascade,
       kind text not null default 'send',
       status text not null default 'pending',
       payload jsonb,
       response jsonb,
       attempts integer not null default 0,
       last_error text,
       next_attempt_at timestamp not null default now(),
       sent_at timestamp,
       created_at timestamp not null default now(),
       updated_at timestamp not null default now()
     )`
  );
  await run(
    "pos_ebarimt_submissions_active_ux индекс",
    `create unique index if not exists pos_ebarimt_submissions_active_ux
       on pos_ebarimt_submissions (sale_id, kind)
       where status in ('pending', 'claimed')`
  );
  await run(
    "pos_ebarimt_submissions_org_status_ix индекс",
    `create index if not exists pos_ebarimt_submissions_org_status_ix
       on pos_ebarimt_submissions (organization_id, status, next_attempt_at)`
  );

  console.log(
    failures === 0
      ? "apply-pending-ddl: бүх DDL хэрэгжлээ"
      : `apply-pending-ddl: ${failures} алдаа (дээрх мөрүүдийг шалга)`
  );
  await sql.end();
  // Deploy-г зогсоохгүй — push болон апп цаашаа явна; алдаа нь лог дээр ил.
  process.exit(0);
}

main().catch((error) => {
  console.error("apply-pending-ddl:", error);
  process.exit(0);
});

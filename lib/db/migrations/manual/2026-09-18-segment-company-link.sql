-- S1/S6 сегментийн компанийн холбоос + push-ийг унагадаг unique constraint-уудын засвар.
-- ЖИНХЭНЭ ХЭРЭГЛЭСЭН зам: node scripts/apply-pending-ddl.mjs (идемпотент; deploy-ийн
-- preDeploy автоматаар дууддаг — railway.toml `npm run db:predeploy`).
-- Хэрэглэсэн: 2026-09-18.
--
-- Шалтгаан: drizzle-kit 0.31.x push нь `--force`-той ч бөглөөтэй хүснэгтэд unique
-- CONSTRAINT нэмэх гэж "truncate хийх үү?" гэж интерактив асуудаг (drizzle-orm#5955).
-- Railway-ийн non-TTY preDeploy дээр "Interactive prompts require a TTY terminal"
-- гэж унаж, схемийн БҮХ өөрчлөлт DB-д ОРОХГҮЙ үлдсэн → /settings/gl 500 ("column
-- linked_organization_id does not exist"). bank_statement_lines-ыг индекс болгосны
-- ДАРАА push дараагийн constraint (ai_settings) дээр ЯГ ижил газар унасан — тиймээс
-- шинэ багана нь push-аас ХАМААРАЛГҮЙ, энэ скриптээр шууд бичигдэнэ.

-- 1. unique CONSTRAINT → unique INDEX (schema.ts мөн uniqueIndex зарладаг).
--    Шинэ индексийг эхлээд үүсгэж, ДАРАА нь хуучин constraint-ыг тайлна —
--    давхардлын хамгаалалт нэг ч агшинд алдагдахгүй.
do $$
begin
  if not exists (
    select 1 from pg_class
    where relname = 'bank_statement_lines_statement_row_ux' and relkind = 'i'
  ) then
    create unique index bank_statement_lines_statement_row_ux
      on bank_statement_lines (statement_id, row_number);
  end if;
  if exists (
    select 1 from pg_constraint
    where conname = 'bank_statement_lines_statement_id_row_number_unique'
      and conrelid = 'bank_statement_lines'::regclass
  ) then
    alter table bank_statement_lines
      drop constraint bank_statement_lines_statement_id_row_number_unique;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_class
    where relname = 'ai_settings_user_org_ux' and relkind = 'i'
  ) then
    create unique index ai_settings_user_org_ux
      on ai_settings (user_id, organization_id);
  end if;
  if exists (
    select 1 from pg_constraint
    where conname = 'ai_settings_user_id_organization_id_unique'
      and conrelid = 'ai_settings'::regclass
  ) then
    alter table ai_settings
      drop constraint ai_settings_user_id_organization_id_unique;
  end if;
end $$;

-- 2. segment_values.linked_organization_id — S1/S6-ийн утга аль байгууллагаас
--    автоматаар бүрдсэнийг заана (null = гараар оруулсан)
alter table segment_values
  add column if not exists linked_organization_id uuid;

do $$
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
end $$;

-- S1/S6 сегментийн компанийн холбоос + push-ийг унагадаг unique constraint-ын засвар.
-- ЖИНХЭНЭ ХЭРЭГЛЭСЭН зам: node scripts/apply-pending-ddl.mjs (идемпотент; deploy-ийн
-- preDeploy автоматаар дууддаг — railway.toml `npm run db:predeploy`).
-- Хэрэглэсэн: 2026-09-18.
--
-- Шалтгаан: drizzle-kit 0.31.x push нь `--force`-той ч бөглөөтэй хүснэгтэд unique
-- CONSTRAINT нэмэхдээ "truncate хийх үү?" гэж интерактив асуудаг. Railway-ийн
-- non-TTY preDeploy дээр "Interactive prompts require a TTY terminal" гэж унаж,
-- схемийн БҮХ өөрчлөлт DB-д ОРОХГҮЙ үлдсэн → /settings/gl 500 ("column
-- linked_organization_id does not exist").

-- 1. bank_statement_lines: unique CONSTRAINT → ижил нэртэй unique INDEX
--    (push дахин асуухаа болино; schema.ts мөн uniqueIndex зарлана)
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'bank_statement_lines_statement_id_row_number_unique'
      and conrelid = 'bank_statement_lines'::regclass
  ) then
    alter table bank_statement_lines
      drop constraint bank_statement_lines_statement_id_row_number_unique;
  end if;
  if not exists (
    select 1 from pg_class
    where relname = 'bank_statement_lines_statement_id_row_number_unique'
      and relkind = 'i'
  ) then
    create unique index bank_statement_lines_statement_id_row_number_unique
      on bank_statement_lines (statement_id, row_number);
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

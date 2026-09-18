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
    failures += 1;
    console.log(`✗ ${label}: ${error.message}`);
  }
}

async function main() {
  // ── 1. bank_statement_lines: unique CONSTRAINT → unique INDEX ──────────────
  // Push энэ constraint-ыг DB-д БАЙСААР байтал "нэмэх үү, truncate хийх үү?"
  // гэж асууж preDeploy-г унагадаг (exchange_rates дээр ч ижил шалтгаанаар
  // uniqueIndex хэрэглэсэн — CLAUDE.md §5b, drizzle-kit #5955).
  // Constraint ба түүний индекс нэг нэртэй тул НЭГ транзакцид: constraint-ыг
  // тайлж (индекс хамт устана), дараа нь ижил нэрээр unique index үүсгэнэ —
  // давхардлын хамгаалалт нэг ч агшинд алдагдахгүй.
  await run(
    "bank_statement_lines (statement_id,row_number) → unique index",
    `do $$
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
     end $$;`
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

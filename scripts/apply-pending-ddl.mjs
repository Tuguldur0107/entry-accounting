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
      index: "ai_settings_user_id_organization_id_ux",
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

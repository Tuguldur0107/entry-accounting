// Фаз 01 — Multi-tenancy backfill migration (docs/opensource/01-multi-tenancy.md, Шат 2).
//
// Ажиллуулах:
//   npx tsx scripts/migrate-multitenancy.ts --dry-run   ← эхлээд ЗААВАЛ энэ
//   npx tsx scripts/migrate-multitenancy.ts --execute
//
// Юу хийдэг (бүхэлдээ НЭГ транзакц — дундаас унавал юу ч өөрчлөгдөхгүй):
//   0. DDL: 0019 миграцийн statement-үүд (organizations/memberships хүснэгт,
//      organization_id nullable багана, org индексүүд) — идемпотент
//   1. Гишүүнчлэлгүй хэрэглэгч бүрд personal org + owner membership
//   2. organization_id багана бүхий БҮХ хүснэгтийн мөрийг user→org
//      mapping-аар бөглөнө
//   3. Шалгалт: user_id-тэй атлаа organization_id NULL мөр = 0 (зөрвөл ROLLBACK)
//   4. organization_id NOT NULL болгоно
//   5. Хуучин (user_id, ...) unique constraint-уудыг унагана — нэг хэрэглэгч
//      олон org-т ижил дугаар хэрэглэж чадах ёстой
//
// Урьдач нөхцөл: pg_dump backup авсан байх (README дүрэм).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const MODE = process.argv.includes("--execute")
  ? "execute"
  : process.argv.includes("--dry-run")
    ? "dry-run"
    : null;
if (!MODE) {
  console.error("Хэрэглээ: --dry-run (эхлээд) эсвэл --execute");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL алга (.env.local)");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false });

/** 0019 migration файлын statement-үүд (drizzle generate-ийн гаралт). */
function ddlStatements(): string[] {
  const dir = "lib/db/migrations";
  const file = readdirSync(dir).find((name) => name.startsWith("0019_"));
  if (!file) throw new Error("0019_* migration файл олдсонгүй — эхлээд drizzle-kit generate");
  return readFileSync(join(dir, file), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  console.log(`Горим: ${MODE === "execute" ? "⚡ EXECUTE" : "👁 DRY-RUN (өөрчлөлт хийхгүй)"}\n`);

  await sql.begin(async (tx) => {
    // ── 0. DDL (идемпотент болгож гүйцэтгэнэ) ──
    const statements = ddlStatements();
    console.log(`── DDL: ${statements.length} statement (0019) ──`);
    let skipped = 0;
    for (const statement of statements) {
      // Postgres-д транзакц доторх алдаа бүх транзакцыг aborted болгодог тул
      // statement бүрийг SAVEPOINT дотор ажиллуулна — алдаа гарвал зөвхөн
      // тухайн statement буцаж, транзакц үргэлжилнэ.
      try {
        await tx.savepoint((sp) => sp.unsafe(statement));
      } catch (error) {
        const message = (error as Error).message;
        // Дахин ажиллуулахад аюулгүй: аль хэдийн байгаа объект, эсвэл
        // drizzle-ийн DROP нэрс live DB-ийн түүхэн нэрстэй зөрөх (push/гар
        // SQL-ээр үүссэн) тохиолдлыг алгасна — бодит хуучин unique-уудыг
        // 5-р алхам нэрээр нь олж унагана.
        if (/already exists|duplicate/i.test(message)) {
          skipped += 1;
          continue;
        }
        if (
          /does not exist/i.test(message) &&
          /^(alter table [\s\S]*drop constraint|drop index)/i.test(statement.trim())
        ) {
          skipped += 1;
          continue;
        }
        console.error(`   ✗ DDL унав: ${statement.slice(0, 120)}...`);
        throw error;
      }
    }
    if (skipped > 0) console.log(`   (${skipped} statement алгасав — байгаа/байхгүй)`);
    console.log("   DDL OK\n");

    // ── 1. Personal org үүсгэх ──
    const orphans = await tx`
      select u.id, u.name, u.email from users u
      where not exists (select 1 from memberships m where m.user_id = u.id)`;
    console.log(`── Гишүүнчлэлгүй хэрэглэгч: ${orphans.length} ──`);
    for (const user of orphans) {
      const name =
        (user.name as string)?.trim() ||
        (user.email as string)?.split("@")[0] ||
        "Миний байгууллага";
      console.log(`   + org "${name}" (${user.email})`);
      const [org] = await tx`
        insert into organizations (name) values (${name}) returning id`;
      await tx`
        insert into memberships (organization_id, user_id, role)
        values (${org.id}, ${user.id}, 'owner')`;
    }

    // user → org mapping (хамгийн эртний гишүүнчлэл = personal org)
    const mapping = await tx`
      select distinct on (user_id) user_id, organization_id
      from memberships order by user_id, created_at asc`;
    console.log(`   Mapping: ${mapping.length} хэрэглэгч → org\n`);

    // ── 2. Backfill ──
    const tables = await tx`
      select c.table_name
      from information_schema.columns c
      where c.table_schema = 'public' and c.column_name = 'organization_id'
        and c.table_name not in ('memberships')
        and exists (select 1 from information_schema.columns c2
          where c2.table_schema = 'public' and c2.table_name = c.table_name
            and c2.column_name = 'user_id')
      order by c.table_name`;
    console.log(`── Backfill: ${tables.length} хүснэгт ──`);
    let totalUpdated = 0;
    for (const { table_name } of tables) {
      const [result] = await tx.unsafe(`
        with map as (
          select distinct on (user_id) user_id, organization_id
          from memberships order by user_id, created_at asc)
        update "${table_name}" t set organization_id = map.organization_id
        from map where t.user_id = map.user_id and t.organization_id is null
        returning 1`).then(
        (rows) => [{ n: rows.length }]
      );
      const [{ total }] = await tx.unsafe(
        `select count(*)::int as total from "${table_name}"`
      );
      console.log(`   ${table_name}: ${result.n} мөр бөглөв (нийт ${total})`);
      totalUpdated += result.n;
    }
    console.log(`   Нийт: ${totalUpdated} мөр\n`);

    // ── 3. Шалгалт ──
    console.log("── Шалгалт: NULL organization_id үлдсэн эсэх ──");
    let bad = 0;
    for (const { table_name } of tables) {
      const [{ n }] = await tx.unsafe(`
        select count(*)::int as n from "${table_name}"
        where organization_id is null and user_id is not null`);
      if (n > 0) {
        console.error(`   ✗ ${table_name}: ${n} мөр NULL!`);
        bad += n;
      }
    }
    if (bad > 0) throw new Error(`Backfill дутуу: ${bad} мөр — ROLLBACK`);
    console.log("   ✓ Бүх мөр бөглөгдсөн\n");

    // ── 4. NOT NULL ──
    console.log("── NOT NULL болгох ──");
    for (const { table_name } of tables) {
      await tx.unsafe(
        `alter table "${table_name}" alter column organization_id set not null`
      );
    }
    console.log(`   ✓ ${tables.length} хүснэгт\n`);

    // ── 5. Хуучин (user_id, ...) unique-уудыг унагах ──
    // Нэг хэрэглэгч 2 org-т ижил дансны дугаар/баримтын дугаар хэрэглэж
    // чадах ёстой тул user түвшний uniqueness буруу болно.
    const oldUniques = await tx`
      select conrelid::regclass::text as table_name, conname
      from pg_constraint
      where contype = 'u' and connamespace = 'public'::regnamespace
        and conname like '%user_id%'
        and conname not like '%organization_id%'
        and conrelid::regclass::text <> 'memberships'`;
    const oldUniqueIndexes = await tx`
      select schemaname, indexname from pg_indexes
      where schemaname = 'public' and indexname like '%user_external_ref_uq'`;
    console.log(
      `── Хуучин user unique: ${oldUniques.length} constraint, ${oldUniqueIndexes.length} index ──`
    );
    for (const { table_name, conname } of oldUniques) {
      console.log(`   drop constraint ${table_name}.${conname}`);
      await tx.unsafe(`alter table ${table_name} drop constraint "${conname}"`);
    }
    for (const { indexname } of oldUniqueIndexes) {
      console.log(`   drop index ${indexname}`);
      await tx.unsafe(`drop index "${indexname}"`);
    }

    if (MODE === "dry-run") {
      console.log("\n👁 DRY-RUN — бүх өөрчлөлт БУЦААГДАЖ байна (rollback)");
      throw new DryRunRollback();
    }
    console.log("\n⚡ COMMIT хийж байна...");
  }).catch((error) => {
    if (error instanceof DryRunRollback) return;
    throw error;
  });

  if (MODE === "execute") console.log("✅ Migration амжилттай COMMIT хийгдлээ");
  else console.log("✅ Dry-run дууслаа — DB өөрчлөгдөөгүй");
  await sql.end();
}

class DryRunRollback extends Error {
  constructor() {
    super("dry-run rollback");
  }
}

main().catch(async (error) => {
  console.error("\n💥 Migration унав (транзакц бүхэлдээ буцсан):", error.message);
  await sql.end();
  process.exit(1);
});

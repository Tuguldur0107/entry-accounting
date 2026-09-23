// Мэдлэгийн санг DB-д ачаалах (docs/knowledge/00-proposal.md D7) — preDeploy-ийн
// СҮҮЛИЙН алхам (push-ийн дараа, хүснэгт үүссэн байх үед).
//
//   KNOWLEDGE_DIR=knowledge node scripts/seed-knowledge.mjs
//
// Идемпотент: файлын sha256 өөрчлөгдөөгүй бол алгасна; устсан/нэр солигдсон
// файлын хэсгүүд DB-ээс хасагдана. Хавтас БАЙХГҮЙ бол чимээгүй алгасна — энэ
// нь fork харилцагчийн хамгаалалт: knowledge/ хувийн repo руу зөөгдсөний
// дараа тэдний preDeploy юу ч ачаалахгүй, Console-оос зөвшөөрсөн ч сан
// хоосон байна. Deploy-г ХЭЗЭЭ Ч зогсоохгүй (exit 0).
//
// Plain JS: preDeploy-д tsx байхгүй байж болзошгүй (apply-pending-ddl.mjs-тэй
// ижил); parser нь scripts/lib/knowledge-parse.mjs.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { config } from "dotenv";
import postgres from "postgres";

import { buildArticleRows, isIncludedPath } from "./lib/knowledge-parse.mjs";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("seed-knowledge: DATABASE_URL алга — алгаслаа");
  process.exit(0);
}

const root = resolve(process.env.KNOWLEDGE_DIR || "knowledge");
if (!existsSync(root)) {
  console.log(`seed-knowledge: ${root} байхгүй — мэдлэгийн сан ачаалагдсангүй (fork-д хэвийн)`);
  process.exit(0);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(root, full).replace(/\\/g, "/"));
  }
  return out;
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

async function main() {
  const files = walk(root).filter(isIncludedPath).sort();
  const rows = files.flatMap((rel) => buildArticleRows(rel, readFileSync(join(root, rel), "utf8")));

  let existing;
  try {
    existing = await sql`select id, slug, section, checksum from knowledge_articles`;
  } catch (error) {
    // 42P01 = хүснэгт хараахан үүсээгүй (DDL/push унасан) — deploy-г зогсоохгүй.
    console.log(`seed-knowledge: хүснэгт уншигдсангүй (${error.code ?? error.message}) — алгаслаа`);
    await sql.end();
    process.exit(0);
  }
  const current = new Map(existing.map((r) => [`${r.slug}\u0000${r.section}`, r]));
  const wanted = new Set(rows.map((r) => `${r.slug}\u0000${r.section}`));

  const changed = rows.filter((r) => current.get(`${r.slug}\u0000${r.section}`)?.checksum !== r.checksum);
  const stale = existing.filter((r) => !wanted.has(`${r.slug}\u0000${r.section}`)).map((r) => r.id);

  await sql.begin(async (tx) => {
    for (const r of changed) {
      await tx`
        insert into knowledge_articles
          (slug, section, category, title, heading, body, citation, modules, source_path, checksum, sort_order, updated_at)
        values
          (${r.slug}, ${r.section}, ${r.category}, ${r.title}, ${r.heading}, ${r.body}, ${r.citation},
           ${JSON.stringify(r.modules)}::jsonb, ${r.sourcePath}, ${r.checksum}, ${r.sortOrder}, now())
        on conflict (slug, section) do update set
          category = excluded.category, title = excluded.title, heading = excluded.heading,
          body = excluded.body, citation = excluded.citation, modules = excluded.modules,
          source_path = excluded.source_path, checksum = excluded.checksum,
          sort_order = excluded.sort_order, updated_at = now()`;
    }
    if (stale.length > 0) await tx`delete from knowledge_articles where id = any(${stale})`;
  });

  const topics = new Set(rows.map((r) => r.slug)).size;
  console.log(
    `seed-knowledge: ${files.length} файл → ${topics} сэдэв, ${rows.length} хэсэг · ` +
      `шинэчилсэн ${changed.length}, хассан ${stale.length}, өөрчлөлтгүй ${rows.length - changed.length}`
  );
  await sql.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("seed-knowledge:", error);
  try {
    await sql.end();
  } catch {
    /* холболт аль хэдийн хаагдсан */
  }
  process.exit(0);
});

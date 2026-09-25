// Мэдлэгийн санг DB-д ачаалах (docs/knowledge/00-proposal.md D7, §6) — preDeploy-ийн
// СҮҮЛИЙН алхам (push-ийн дараа, хүснэгт үүссэн байх үед).
//
// ЭХ СУРВАЛЖ (фаз 2 — 01/02/04-skills core repo-д БАЙХГҮЙ, хувийн `entry-knowledge`-д):
//   1. KNOWLEDGE_REPO=owner/repo + KNOWLEDGE_REPO_TOKEN (read-only PAT) — SaaS
//      production. GitHub API tarball (KNOWLEDGE_REPO_REF, default main) татна
//   2. KNOWLEDGE_DIR эсвэл ./knowledge хавтас — хөгжүүлэгчийн локал clone
//      (`KNOWLEDGE_DIR=../entry-knowledge node scripts/seed-knowledge.mjs`)
//   3. Аль нь ч байхгүй → чимээгүй алгасна (fork харилцагч — token байхгүй)
//
// Идемпотент: файлын sha256 өөрчлөгдөөгүй бол алгасна. Устсан файлын хэсгийг
// DB-ээс хасах нь ЗӨВХӨН эх сурвалж БҮРЭН үед (`isCompleteKnowledgeSource`) —
// token-гүй deploy, хагас архив production-ийн санг ХЭЗЭЭ Ч хоослохгүй.
// Deploy-г ХЭЗЭЭ Ч зогсоохгүй (exit 0).
//
// Plain JS: preDeploy-д tsx байхгүй байж болзошгүй (apply-pending-ddl.mjs-тэй
// ижил); parser нь scripts/lib/knowledge-parse.mjs, архив knowledge-source.mjs.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { config } from "dotenv";
import postgres from "postgres";

import { buildArticleRows, isIncludedPath } from "./lib/knowledge-parse.mjs";
import {
  extractTarFiles,
  isCompleteKnowledgeSource,
  normalizeKnowledgeRepo,
} from "./lib/knowledge-source.mjs";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("seed-knowledge: DATABASE_URL алга — алгаслаа");
  process.exit(0);
}

function walk(root, dir = root, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(root, full, out);
    else out.push(relative(root, full).replace(/\\/g, "/"));
  }
  return out;
}

/** Хувийн repo-гийн tarball (GitHub API) → { label, files } эсвэл null (алгасна). */
async function loadFromRepo() {
  const raw = process.env.KNOWLEDGE_REPO;
  if (!raw?.trim()) return null;
  const repo = normalizeKnowledgeRepo(raw);
  const token = process.env.KNOWLEDGE_REPO_TOKEN?.trim();
  if (!repo) {
    console.log(`seed-knowledge: KNOWLEDGE_REPO "${raw}" буруу (owner/repo) — алгаслаа`);
    return { skip: true };
  }
  if (!token) {
    console.log("seed-knowledge: KNOWLEDGE_REPO_TOKEN алга — хувийн repo татагдсангүй, DB хэвээр");
    return { skip: true };
  }
  const ref = encodeURIComponent(process.env.KNOWLEDGE_REPO_REF?.trim() || "main");
  const res = await fetch(`https://api.github.com/repos/${repo}/tarball/${ref}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "entry-seed-knowledge",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    // Token-ий утгыг ХЭЗЭЭ Ч логлохгүй — зөвхөн статус.
    console.log(`seed-knowledge: ${repo} татагдсангүй (HTTP ${res.status}) — DB хэвээр`);
    return { skip: true };
  }
  const files = extractTarFiles(gunzipSync(Buffer.from(await res.arrayBuffer())));
  return { label: `${repo}@${decodeURIComponent(ref)}`, files };
}

/** Локал хавтас → { label, files } эсвэл null. */
function loadFromDir() {
  const root = resolve(process.env.KNOWLEDGE_DIR || "knowledge");
  if (!existsSync(root)) return null;
  const files = walk(root)
    .filter(isIncludedPath)
    .map((rel) => ({ path: rel, content: readFileSync(join(root, rel), "utf8") }));
  return { label: root, files };
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

async function main() {
  const source = (await loadFromRepo()) ?? loadFromDir();
  if (!source || source.skip) {
    if (!source) console.log("seed-knowledge: эх сурвалж алга — мэдлэгийн сан ачаалагдсангүй (fork-д хэвийн)");
    await sql.end();
    process.exit(0);
  }
  const files = source.files
    .filter((f) => isIncludedPath(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const complete = isCompleteKnowledgeSource(files.map((f) => f.path));
  if (files.length === 0) {
    console.log(`seed-knowledge: ${source.label} — хамрагдах файл алга (01/02/04-skills хувийн repo-д), DB хэвээр`);
    await sql.end();
    process.exit(0);
  }
  const rows = files.flatMap((f) => buildArticleRows(f.path, f.content));

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
  // Бүрэн биш эх сурвалжаас УСТГАХГҮЙ — хагас архив / хасагдсан хавтас санг хоослохгүй.
  const stale = complete
    ? existing.filter((r) => !wanted.has(`${r.slug}\u0000${r.section}`)).map((r) => r.id)
    : [];
  if (!complete) console.log("seed-knowledge: эх сурвалж бүрэн биш — зөвхөн нэмж/шинэчилнэ, устгахгүй");

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
    `seed-knowledge: ${source.label} · ${files.length} файл → ${topics} сэдэв, ${rows.length} хэсэг · ` +
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

// Мэдлэгийн сангийн markdown → хүснэгтийн мөр — ЦЭВЭР (DB-гүй, тесттэй).
//
// Plain JS: seed скрипт (scripts/seed-knowledge.mjs) preDeploy дээр ажилладаг
// бөгөөд тэнд tsx байхгүй байж болзошгүй (voucher-number-plan.mjs-тэй ижил
// зарчим). Төрлийн зарлал нь knowledge-parse.d.mts.
//
// Хэлбэр: файл бүр = НЭГ сэдэв (topic), доторх `## ` толгой бүр = НЭГ хэсэг
// (section). H1-ээс өмнөх/дараах эхний текст = "overview" хэсэг. AI tool нь
// хэсгээр л уншдаг тул сэдэв бүтнээрээ хэзээ ч нэг хариунд гардаггүй
// (docs/knowledge/00-proposal.md D3).

import { createHash } from "node:crypto";

/** Сервер талд хүргэгдэх хавтаснууд — 03-стандарт (UI/сегмент) ОРОХГҮЙ. */
export const INCLUDED_ROOTS = [
  "01-онол-хууль-стандарт",
  "02-нягтлан-бодох-мэргэжлийн",
  "04-ai-agent/skills",
];

export const OVERVIEW_SECTION = "overview";

const SKIP_BASENAMES = new Set(["_index.md", "README.md", "CLAUDE.md"]);

export function isIncludedPath(relPath) {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!normalized.endsWith(".md")) return false;
  const base = normalized.split("/").pop() ?? "";
  if (SKIP_BASENAMES.has(base)) return false;
  return INCLUDED_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`)
  );
}

/** Кирилл/латин үсэг, тоо үлдээж, бусдыг зураас болгоно. */
export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * YAML frontmatter-ийн ЭНГИЙН хэсгийг уншина: `key: value`, `key: [a, b]`.
 * Гүн бүтэц хэрэггүй — мэдлэгийн файлууд зөвхөн scalar/жагсаалт хэрэглэдэг.
 */
export function parseFrontmatter(text) {
  const source = String(text ?? "");
  if (!source.startsWith("---")) return { meta: {}, body: source };
  const end = source.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: source };
  const block = source.slice(3, end);
  const body = source.slice(end + 4).replace(/^(\r?\n)+/, "");
  const meta = {};
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      meta[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { meta, body };
}

/** Замын хавтаснаас ангилал — Console/AI-д харагдах бүлэглэл. */
export function categoryOf(relPath) {
  const parts = relPath.replace(/\\/g, "/").split("/");
  const root = parts[0] ?? "";
  const sub = parts.length > 2 ? parts[1] : "";
  if (root === "01-онол-хууль-стандарт") {
    if (sub === "ifrs") return "ifrs";
    if (sub === "tax") return "tax";
    return "mapping";
  }
  if (root === "02-нягтлан-бодох-мэргэжлийн") {
    if (sub === "payroll") return "payroll";
    if (sub === "workflows") return "workflow";
    if (sub === "guardrails") return "guardrail";
    return "practice";
  }
  if (root === "04-ai-agent") return "skill";
  return "other";
}

/** Эхний `# ` толгой — frontmatter-гүй файлын гарчиг. */
export function firstHeading(body) {
  const match = /^#\s+(.+)$/m.exec(String(body ?? ""));
  return match ? match[1].trim() : null;
}

/**
 * Сэдвийн slug: frontmatter `id` байвал (`ifrs:ias-16` → `ifrs/ias-16`),
 * SKILL.md бол хавтасны нэр, бусад нь ангилал + файлын нэр.
 */
export function topicSlugOf(relPath, meta) {
  const id = typeof meta?.id === "string" ? meta.id.trim() : "";
  if (id) return id.split(":").map(slugify).filter(Boolean).join("/");
  const parts = relPath.replace(/\\/g, "/").split("/");
  const base = (parts.pop() ?? "").replace(/\.md$/, "");
  const category = categoryOf(relPath);
  if (base.toUpperCase() === "SKILL") return `${category}/${slugify(parts.pop() ?? "")}`;
  return `${category}/${slugify(base)}`;
}

/**
 * Body-г `## ` толгойгоор хэсэглэнэ. H1 мөрийг хаяна; H1-ээс хойш эхний `## `
 * хүртэлх текст = overview. Хоосон хэсэг орохгүй; ижил нэртэй толгойд -2, -3.
 */
export function splitSections(body, overviewHeading) {
  const lines = String(body ?? "").split(/\r?\n/);
  const sections = [];
  let heading = overviewHeading ?? "Тойм";
  let slug = OVERVIEW_SECTION;
  let buffer = [];
  const used = new Map();

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) sections.push({ section: slug, heading, body: text });
    buffer = [];
  };
  const uniqueSlug = (base) => {
    const seed = base || "хэсэг";
    const count = (used.get(seed) ?? 0) + 1;
    used.set(seed, count);
    return count === 1 ? seed : `${seed}-${count}`;
  };

  for (const line of lines) {
    if (/^#\s+/.test(line) && sections.length === 0 && buffer.join("").trim() === "") {
      // Толгойн H1 — overview-ийн гарчиг болно, агуулгад орохгүй.
      if (!overviewHeading) heading = line.replace(/^#\s+/, "").trim();
      continue;
    }
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      flush();
      heading = h2[1].trim();
      slug = uniqueSlug(slugify(heading));
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

export function checksumOf(text) {
  return createHash("sha256").update(String(text ?? "")).digest("hex");
}

function citationOf(meta) {
  const standard = typeof meta.standard === "string" ? meta.standard : "";
  const standardMn = typeof meta.standard_mn === "string" ? meta.standard_mn : "";
  if (standard) return standardMn ? `${standard} / ${standardMn}` : standard;
  return typeof meta.law === "string" && meta.law ? meta.law : null;
}

/**
 * Нэг файл → мөрүүд (хэсэг бүрд нэг). Мөр бүр сэдвийн түвшний мэдээллийг
 * давтан агуулна (slug, title, category, citation) — уншигч JOIN хийхгүй.
 */
export function buildArticleRows(relPath, text) {
  const { meta, body } = parseFrontmatter(text);
  const category = categoryOf(relPath);
  const slug = topicSlugOf(relPath, meta);
  const title =
    (typeof meta.title === "string" && meta.title) ||
    firstHeading(body) ||
    relPath.split("/").pop()?.replace(/\.md$/, "") ||
    slug;
  const citation = citationOf(meta);
  const checksum = checksumOf(text);
  const modules = Array.isArray(meta.modules)
    ? meta.modules
    : Array.isArray(meta.applies_to)
      ? meta.applies_to
      : [];
  return splitSections(body, typeof meta.title === "string" ? meta.title : undefined).map(
    (section, index) => ({
      slug,
      section: section.section,
      category,
      title,
      heading: section.heading,
      body: section.body,
      citation,
      modules,
      sourcePath: relPath.replace(/\\/g, "/"),
      checksum,
      sortOrder: index,
    })
  );
}

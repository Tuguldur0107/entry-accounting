// Мэдлэгийн сангийн ЦЭВЭР давхарга — таслалт, индекс, оролтын цэвэрлэлт.
import assert from "node:assert/strict";
import test from "node:test";

import {
  KNOWLEDGE_MAX_SECTION_CHARS,
  clampSection,
  formatSection,
  formatTopicIndex,
  isKnowledgeCategory,
  normalizeSectionSlug,
  normalizeTopicSlug,
  type KnowledgeTopicSummary,
} from "../lib/knowledge/catalog";

const TOPICS: KnowledgeTopicSummary[] = [
  {
    slug: "ifrs/ias-16",
    title: "IAS 16 — Үндсэн хөрөнгө",
    category: "ifrs",
    citation: "IAS 16 / НББОУС 16",
    sections: [
      { section: "overview", heading: "Тойм" },
      { section: "элэгдэл-depreciation", heading: "Элэгдэл" },
    ],
  },
  {
    slug: "tax/vat",
    title: "НӨАТ",
    category: "tax",
    citation: "НӨАТ-ын тухай хууль",
    sections: [{ section: "overview", heading: "Тойм" }],
  },
];

test("clampSection: богино хэсэг бүтнээрээ, урт нь мөрийн хил дээр таслагдаж ИЛ тэмдэглэгдэнэ", () => {
  assert.deepEqual(clampSection("богино"), { text: "богино", truncated: false });
  const long = Array.from({ length: 200 }, (_, i) => `мөр ${i} ${"х".repeat(40)}`).join("\n");
  const { text, truncated } = clampSection(long);
  assert.equal(truncated, true);
  assert.ok(text.length <= KNOWLEDGE_MAX_SECTION_CHARS);
  assert.ok(!text.endsWith("\n"));
  // мөрийн хил дээр таслагдсан — сүүлийн мөр бүтэн
  assert.match(text.split("\n").at(-1) ?? "", /^мөр \d+ х+$/);
});

test("clampSection: мөрийн хил хэт эрт бол шууд max дээр таслана", () => {
  const noNewlines = "а".repeat(5000);
  const { text, truncated } = clampSection(noNewlines, 100);
  assert.equal(truncated, true);
  assert.equal(text.length, 100);
});

test("formatTopicIndex: ангиллаар бүлэглэж, slug + хэсгүүд + унших заавар", () => {
  const out = formatTopicIndex(TOPICS);
  assert.match(out, /## IFRS \/ НББОУС стандарт \(1\)/);
  assert.match(out, /## Монголын татварын хууль \(1\)/);
  assert.match(out, /- ifrs\/ias-16 — IAS 16 — Үндсэн хөрөнгө \[IAS 16 \/ НББОУС 16\]/);
  assert.match(out, /хэсгүүд: overview, элэгдэл-depreciation/);
  assert.match(out, /read_knowledge_section/);
});

test("formatTopicIndex: ангиллаар шүүх, хоосон үед ойлгомжтой мессеж", () => {
  assert.doesNotMatch(formatTopicIndex(TOPICS, "tax"), /ifrs\/ias-16/);
  assert.match(formatTopicIndex(TOPICS, "payroll"), /ангилалд сэдэв алга/);
  assert.match(formatTopicIndex([]), /хоосон байна/);
});

test("formatSection: гарчиг, ишлэл, агуулга, бусад хэсгүүд", () => {
  const out = formatSection({
    slug: "ifrs/ias-16",
    section: "элэгдэл-depreciation",
    category: "ifrs",
    title: "IAS 16 — Үндсэн хөрөнгө",
    heading: "Элэгдэл",
    body: "Шулуун шугам.",
    citation: "IAS 16 / НББОУС 16",
    siblings: TOPICS[0].sections,
  });
  assert.match(out, /^# IAS 16 — Үндсэн хөрөнгө\n## Элэгдэл\nЭх сурвалж: IAS 16 \/ НББОУС 16/);
  assert.match(out, /Шулуун шугам\./);
  assert.match(out, /бусад хэсэг: overview \(Тойм\)/);
  assert.doesNotMatch(out, /таслагдав/);
});

test("formatSection: урт хэсэг таслагдсаныг ИЛ хэлнэ", () => {
  const out = formatSection({
    slug: "tax/vat",
    section: "overview",
    category: "tax",
    title: "НӨАТ",
    heading: "Тойм",
    body: "мөр\n".repeat(2000),
    citation: null,
    siblings: [],
  });
  assert.match(out, /таслагдав/);
  assert.doesNotMatch(out, /Эх сурвалж/);
});

test("normalizeTopicSlug: зөв хэлбэр, path traversal ба гажиг оролт татгалзана", () => {
  assert.equal(normalizeTopicSlug("ifrs/ias-16"), "ifrs/ias-16");
  assert.equal(normalizeTopicSlug(" /Tax/VAT/ "), "tax/vat");
  assert.equal(normalizeTopicSlug("workflow/нөат-тайлан"), "workflow/нөат-тайлан");
  assert.equal(normalizeTopicSlug("../etc/passwd"), null);
  assert.equal(normalizeTopicSlug("a/b/c"), null);
  assert.equal(normalizeTopicSlug(""), null);
  assert.equal(normalizeTopicSlug(42), null);
});

test("normalizeSectionSlug: хоосон → null (overview), зөв slug, гажиг татгалзана", () => {
  assert.equal(normalizeSectionSlug(undefined), null);
  assert.equal(normalizeSectionSlug(""), null);
  assert.equal(normalizeSectionSlug("Элэгдэл-Depreciation"), "элэгдэл-depreciation");
  assert.equal(normalizeSectionSlug("a b"), null);
  assert.equal(normalizeSectionSlug("../x"), null);
});

test("isKnowledgeCategory", () => {
  assert.equal(isKnowledgeCategory("ifrs"), true);
  assert.equal(isKnowledgeCategory("other"), false);
  assert.equal(isKnowledgeCategory(null), false);
});

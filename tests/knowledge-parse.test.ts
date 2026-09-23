// Мэдлэгийн сангийн parser — frontmatter, хэсэглэлт, slug, ангилал, хамрах хүрээ.
import assert from "node:assert/strict";
import test from "node:test";

import {
  OVERVIEW_SECTION,
  buildArticleRows,
  categoryOf,
  checksumOf,
  isIncludedPath,
  parseFrontmatter,
  slugify,
  splitSections,
  topicSlugOf,
} from "../scripts/lib/knowledge-parse.mjs";

const IAS16 = `---
id: ifrs:ias-16
title: IAS 16 — Үндсэн хөрөнгө
standard: IAS 16
standard_mn: НББОУС 16
modules: [fa]
related: [ias-36, ias-23]
---

# IAS 16 — Үндсэн хөрөнгө, тоног төхөөрөмж

Тойм текст.

## Анхны хүлээн зөвшөөрөх

Өртгөөр бүртгэнэ (IAS 16.15).

### Дэд хэсэг

Дэд хэсгийн текст overview биш, өмнөх ## хэсэгт багтана.

## Элэгдэл (Depreciation)

Шулуун шугамын арга.

## Элэгдэл (Depreciation)

Давхар толгой — -2 залгагдана.
`;

test("frontmatter: scalar ба жагсаалт уншигдана, body цэвэрлэгдэнэ", () => {
  const { meta, body } = parseFrontmatter(IAS16);
  assert.equal(meta.id, "ifrs:ias-16");
  assert.equal(meta.standard, "IAS 16");
  assert.deepEqual(meta.modules, ["fa"]);
  assert.deepEqual(meta.related, ["ias-36", "ias-23"]);
  assert.ok(body.startsWith("# IAS 16"));
});

test("frontmatter-гүй файл: meta хоосон, body бүтнээрээ", () => {
  const { meta, body } = parseFrontmatter("# Гарчиг\n\nТекст");
  assert.deepEqual(meta, {});
  assert.equal(body, "# Гарчиг\n\nТекст");
});

test("slugify: кирилл/латин үлдэнэ, бусад нь зураас", () => {
  assert.equal(slugify("Элэгдэл (Depreciation)"), "элэгдэл-depreciation");
  assert.equal(slugify("  IAS 16.31 / НББОУС  "), "ias-16-31-нббоус");
  assert.equal(slugify(""), "");
});

test("хэсэглэлт: H1 хаягдаж overview + ## бүр хэсэг, ### дотор нь үлдэнэ", () => {
  const { body } = parseFrontmatter(IAS16);
  const sections = splitSections(body);
  assert.deepEqual(
    sections.map((s) => s.section),
    [OVERVIEW_SECTION, "анхны-хүлээн-зөвшөөрөх", "элэгдэл-depreciation", "элэгдэл-depreciation-2"]
  );
  assert.equal(sections[0].heading, "IAS 16 — Үндсэн хөрөнгө, тоног төхөөрөмж");
  assert.equal(sections[0].body, "Тойм текст.");
  assert.match(sections[1].body, /### Дэд хэсэг/);
  assert.doesNotMatch(sections[1].body, /^# /m);
});

test("хоосон хэсэг орохгүй", () => {
  const sections = splitSections("# T\n\n## Хоосон\n\n## Бүтэн\n\nТекст");
  assert.deepEqual(sections.map((s) => s.section), ["бүтэн"]);
});

test("ангилал замаас: ifrs/tax/mapping/payroll/workflow/guardrail/practice/skill", () => {
  assert.equal(categoryOf("01-онол-хууль-стандарт/ifrs/ias-16-ppe.md"), "ifrs");
  assert.equal(categoryOf("01-онол-хууль-стандарт/tax/vat.md"), "tax");
  assert.equal(categoryOf("01-онол-хууль-стандарт/ifrs-cross-module-mapping.md"), "mapping");
  assert.equal(categoryOf("02-нягтлан-бодох-мэргэжлийн/payroll/pit.md"), "payroll");
  assert.equal(categoryOf("02-нягтлан-бодох-мэргэжлийн/workflows/vat-return.md"), "workflow");
  assert.equal(categoryOf("02-нягтлан-бодох-мэргэжлийн/guardrails/effective-date.md"), "guardrail");
  assert.equal(categoryOf("02-нягтлан-бодох-мэргэжлийн/01-gl-posting-matrix.md"), "practice");
  assert.equal(categoryOf("04-ai-agent/skills/ifrs/SKILL.md"), "skill");
  assert.equal(categoryOf("03-стандарт/chart-of-accounts.md"), "other");
});

test("сэдвийн slug: id → ifrs/ias-16; SKILL.md → хавтасны нэр; бусад нь ангилал/файл", () => {
  assert.equal(topicSlugOf("01-онол-хууль-стандарт/ifrs/ias-16-ppe.md", { id: "ifrs:ias-16" }), "ifrs/ias-16");
  assert.equal(topicSlugOf("04-ai-agent/skills/mongolian-tax/SKILL.md", {}), "skill/mongolian-tax");
  assert.equal(topicSlugOf("02-нягтлан-бодох-мэргэжлийн/01-gl-posting-matrix.md", {}), "practice/01-gl-posting-matrix");
});

test("хамрах хүрээ: 01/02/04-skills орно, 03-стандарт, _index, README орохгүй", () => {
  assert.equal(isIncludedPath("01-онол-хууль-стандарт/ifrs/ias-2-inventory.md"), true);
  assert.equal(isIncludedPath("02-нягтлан-бодох-мэргэжлийн/workflows/journal-entry.md"), true);
  assert.equal(isIncludedPath("04-ai-agent/skills/coa/SKILL.md"), true);
  assert.equal(isIncludedPath("04-ai-agent/agents/chief-accountant.md"), false);
  assert.equal(isIncludedPath("03-стандарт/ui-standards/tables.md"), false);
  assert.equal(isIncludedPath("01-онол-хууль-стандарт/ifrs/_index.md"), false);
  assert.equal(isIncludedPath("README.md"), false);
  assert.equal(isIncludedPath("01-онол-хууль-стандарт/ifrs/notes.txt"), false);
});

test("buildArticleRows: сэдвийн мэдээлэл мөр бүрд давтагдана, ишлэл стандартаас", () => {
  const rows = buildArticleRows("01-онол-хууль-стандарт/ifrs/ias-16-ppe.md", IAS16);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.slug, "ifrs/ias-16");
    assert.equal(row.category, "ifrs");
    assert.equal(row.title, "IAS 16 — Үндсэн хөрөнгө");
    assert.equal(row.citation, "IAS 16 / НББОУС 16");
    assert.deepEqual(row.modules, ["fa"]);
    assert.equal(row.checksum, checksumOf(IAS16));
  }
  assert.deepEqual(rows.map((r) => r.sortOrder), [0, 1, 2, 3]);
  // meta.title байвал overview-ийн heading нь тэр (H1 биш)
  assert.equal(rows[0].heading, "IAS 16 — Үндсэн хөрөнгө");
});

test("frontmatter-гүй файл: гарчиг H1-ээс, ишлэл null, хуулийн файлд law ишлэл", () => {
  const rows = buildArticleRows("02-нягтлан-бодох-мэргэжлийн/02-period-close.md", "# Сар хаалт\n\nТекст\n\n## Алхам\n\nА");
  assert.equal(rows[0].title, "Сар хаалт");
  assert.equal(rows[0].citation, null);
  assert.equal(rows[0].slug, "practice/02-period-close");

  const tax = buildArticleRows("01-онол-хууль-стандарт/tax/vat.md", "---\nid: tax:vat\ntitle: НӨАТ\nlaw: НӨАТ-ын тухай хууль\n---\n\n# НӨАТ\n\nТекст");
  assert.equal(tax[0].citation, "НӨАТ-ын тухай хууль");
  assert.equal(tax[0].slug, "tax/vat");
});

test("checksum тогтвортой, өөр текстэд өөр", () => {
  assert.equal(checksumOf("a"), checksumOf("a"));
  assert.notEqual(checksumOf("a"), checksumOf("b"));
});

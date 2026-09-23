// Мэдлэгийн сангийн DB давхарга ("use server" БИШ — tools.ts шууд дуудна).
// ЦЭВЭР дүрэм, хэлбэр нь catalog.ts; агуулгыг scripts/seed-knowledge.mjs бөглөнө.
//
// Энд эрхийн шалгалт БАЙХГҮЙ — нийтийн лавлах (exchange_rates-тэй ижил);
// дуудагч (lib/ai/tools.ts) requireFeature + квотоо өөрөө шалгана.

import { and, asc, eq, gt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { knowledgeArticles, knowledgeReads } from "@/lib/db/schema";
import {
  isKnowledgeCategory,
  type KnowledgeCategory,
  type KnowledgeSectionView,
  type KnowledgeTopicSummary,
} from "@/lib/knowledge/catalog";

export async function listKnowledgeTopics(
  category?: KnowledgeCategory
): Promise<KnowledgeTopicSummary[]> {
  const rows = await db
    .select({
      slug: knowledgeArticles.slug,
      section: knowledgeArticles.section,
      category: knowledgeArticles.category,
      title: knowledgeArticles.title,
      heading: knowledgeArticles.heading,
      citation: knowledgeArticles.citation,
      sortOrder: knowledgeArticles.sortOrder,
    })
    .from(knowledgeArticles)
    .where(category ? eq(knowledgeArticles.category, category) : undefined)
    .orderBy(asc(knowledgeArticles.slug), asc(knowledgeArticles.sortOrder));

  const topics = new Map<string, KnowledgeTopicSummary>();
  for (const row of rows) {
    if (!isKnowledgeCategory(row.category)) continue;
    let topic = topics.get(row.slug);
    if (!topic) {
      topic = {
        slug: row.slug,
        title: row.title,
        category: row.category,
        citation: row.citation,
        sections: [],
      };
      topics.set(row.slug, topic);
    }
    topic.sections.push({ section: row.section, heading: row.heading });
  }
  return [...topics.values()];
}

/** Нэг хэсэг; section өгөөгүй бол overview, тэр ч байхгүй бол эхний хэсэг. */
export async function readKnowledgeSection(
  slug: string,
  section: string | null
): Promise<KnowledgeSectionView | null> {
  const rows = await db
    .select()
    .from(knowledgeArticles)
    .where(eq(knowledgeArticles.slug, slug))
    .orderBy(asc(knowledgeArticles.sortOrder));
  if (rows.length === 0) return null;
  const picked =
    (section ? rows.find((r) => r.section === section) : undefined) ??
    (section ? undefined : (rows.find((r) => r.section === "overview") ?? rows[0]));
  if (!picked || !isKnowledgeCategory(picked.category)) return null;
  return {
    slug: picked.slug,
    section: picked.section,
    category: picked.category,
    title: picked.title,
    heading: picked.heading,
    body: picked.body,
    citation: picked.citation,
    siblings: rows.map((r) => ({ section: r.section, heading: r.heading })),
  };
}

/** Сүүлийн 24 цагийн уншилт — квотын суурь (D5). */
export async function countKnowledgeReadsToday(organizationId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(knowledgeReads)
    .where(and(eq(knowledgeReads.organizationId, organizationId), gt(knowledgeReads.createdAt, since)));
  return row?.n ?? 0;
}

export async function recordKnowledgeRead(input: {
  organizationId: string;
  userId: string | null;
  slug: string;
  section: string;
}): Promise<void> {
  try {
    await db.insert(knowledgeReads).values(input);
  } catch (error) {
    // Мөрдлөгийн бичилт хариултыг унагахгүй.
    console.error("[knowledge] уншилт бүртгэгдсэнгүй:", error);
  }
}

/** /api/health, Console — зөвхөн тоолуур. */
export async function knowledgeStats(): Promise<{ topics: number; sections: number }> {
  const [row] = await db
    .select({
      topics: sql<number>`count(distinct ${knowledgeArticles.slug})::int`,
      sections: sql<number>`count(*)::int`,
    })
    .from(knowledgeArticles);
  return { topics: row?.topics ?? 0, sections: row?.sections ?? 0 };
}

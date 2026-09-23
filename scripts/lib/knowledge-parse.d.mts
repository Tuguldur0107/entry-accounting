// `knowledge-parse.mjs` нь plain JS (preDeploy-д tsx байхгүй байж болзошгүй) —
// тест ба TS дуудагчид зориулсан төрлийн зарлал.

export const INCLUDED_ROOTS: string[];
export const OVERVIEW_SECTION: "overview";

export type KnowledgeCategory =
  | "ifrs"
  | "tax"
  | "mapping"
  | "payroll"
  | "workflow"
  | "guardrail"
  | "practice"
  | "skill"
  | "other";

export type FrontmatterMeta = Record<string, string | string[]>;

export interface KnowledgeSectionChunk {
  section: string;
  heading: string;
  body: string;
}

export interface KnowledgeArticleRow {
  slug: string;
  section: string;
  category: KnowledgeCategory;
  title: string;
  heading: string;
  body: string;
  citation: string | null;
  modules: string[];
  sourcePath: string;
  checksum: string;
  sortOrder: number;
}

export function isIncludedPath(relPath: string): boolean;
export function slugify(value: unknown): string;
export function parseFrontmatter(text: string): { meta: FrontmatterMeta; body: string };
export function categoryOf(relPath: string): KnowledgeCategory;
export function firstHeading(body: string): string | null;
export function topicSlugOf(relPath: string, meta: FrontmatterMeta): string;
export function splitSections(body: string, overviewHeading?: string): KnowledgeSectionChunk[];
export function checksumOf(text: string): string;
export function buildArticleRows(relPath: string, text: string): KnowledgeArticleRow[];

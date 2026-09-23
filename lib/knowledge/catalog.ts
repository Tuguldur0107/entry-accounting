// Мэдлэгийн сангийн ЦЭВЭР давхарга — DB-гүй (тесттэй, client-safe).
// Тогтмолууд, харуулах хэлбэр, хэсгийн таслалт. DB давхарга нь store.ts.
//
// Зарчим (docs/knowledge/00-proposal.md): хэрэглэгч файл авахгүй, AI хэсгээр л
// уншина; «бүгдийг буцаах» зам БАЙХГҮЙ; хэсэг таслагдсан бол ИЛ хэлнэ.

import type { FeatureKey } from "@/lib/billing/plans";

/** Багцын боломжийн түлхүүр — requireFeature(orgId, KNOWLEDGE_FEATURE). */
export const KNOWLEDGE_FEATURE: FeatureKey = "knowledge";

/** Байгууллага бүрийн 24 цагийн хэсэг уншилтын дээд тоо (D5). */
export const KNOWLEDGE_DAILY_READ_LIMIT = 200;

/** Нэг хариунд буцах хэсгийн дээд урт — урт хэсэг таслагдаж ИЛ тэмдэглэгдэнэ (D3). */
export const KNOWLEDGE_MAX_SECTION_CHARS = 3000;

export type KnowledgeCategory =
  | "ifrs"
  | "tax"
  | "mapping"
  | "payroll"
  | "workflow"
  | "guardrail"
  | "practice"
  | "skill";

export const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [
  "ifrs",
  "tax",
  "mapping",
  "payroll",
  "workflow",
  "guardrail",
  "practice",
  "skill",
];

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  ifrs: "IFRS / НББОУС стандарт",
  tax: "Монголын татварын хууль",
  mapping: "Стандарт ↔ модулийн уялдаа",
  payroll: "Цалин, НДШ, ХАОАТ",
  workflow: "Ажлын урсгал",
  guardrail: "Хамгаалалтын дүрэм",
  practice: "Мэргэжлийн практик",
  skill: "AI зөвлөгчийн заавар",
};

export function isKnowledgeCategory(value: unknown): value is KnowledgeCategory {
  return typeof value === "string" && (KNOWLEDGE_CATEGORIES as string[]).includes(value);
}

/** AI-д өгөх сэдвийн жагсаалтын нэг мөр (хэсгүүд нь гарчгаар л). */
export type KnowledgeTopicSummary = {
  slug: string;
  title: string;
  category: KnowledgeCategory;
  citation: string | null;
  sections: { section: string; heading: string }[];
};

export type KnowledgeSectionView = {
  slug: string;
  section: string;
  category: KnowledgeCategory;
  title: string;
  heading: string;
  body: string;
  citation: string | null;
  /** Сэдвийн бусад хэсгүүд — «дараа нь юу унших вэ» */
  siblings: { section: string; heading: string }[];
};

/** Хэсгийн текстийг дээд уртаар таслана; таслагдсан бол ИЛ тэмдэглэнэ. */
export function clampSection(body: string, max = KNOWLEDGE_MAX_SECTION_CHARS): {
  text: string;
  truncated: boolean;
} {
  if (body.length <= max) return { text: body, truncated: false };
  // Мөрийн хил дээр таслана — хүснэгт/жагсаалтыг дундуур нь хэрчихгүй.
  const cut = body.lastIndexOf("\n", max);
  const text = body.slice(0, cut > max * 0.6 ? cut : max).trimEnd();
  return { text, truncated: true };
}

/** Сэдвийн жагсаалт → AI-д уншигдахуйц индекс (ангиллаар бүлэглэсэн). */
export function formatTopicIndex(
  topics: KnowledgeTopicSummary[],
  category?: KnowledgeCategory
): string {
  const rows = category ? topics.filter((t) => t.category === category) : topics;
  if (rows.length === 0) {
    return category
      ? `«${KNOWLEDGE_CATEGORY_LABELS[category]}» ангилалд сэдэв алга.`
      : "Мэдлэгийн сан хоосон байна — тохиргоог Entry Console-оос шалгана уу.";
  }
  const lines: string[] = [];
  for (const cat of KNOWLEDGE_CATEGORIES) {
    const group = rows.filter((t) => t.category === cat);
    if (group.length === 0) continue;
    lines.push(`## ${KNOWLEDGE_CATEGORY_LABELS[cat]} (${group.length})`);
    for (const topic of group) {
      const cite = topic.citation ? ` [${topic.citation}]` : "";
      lines.push(`- ${topic.slug} — ${topic.title}${cite}`);
      lines.push(`  хэсгүүд: ${topic.sections.map((s) => s.section).join(", ")}`);
    }
  }
  lines.push("");
  lines.push(
    "Унших: read_knowledge_section({ topic: \"<slug>\", section: \"<хэсэг>\" }) — section өгөөгүй бол overview."
  );
  return lines.join("\n");
}

/** Нэг хэсэг → AI-д өгөх хариу (ишлэл, таслалт, дараагийн хэсгүүд). */
export function formatSection(view: KnowledgeSectionView): string {
  const { text, truncated } = clampSection(view.body);
  const lines: string[] = [];
  lines.push(`# ${view.title}`);
  lines.push(`## ${view.heading}`);
  if (view.citation) lines.push(`Эх сурвалж: ${view.citation}`);
  lines.push("");
  lines.push(text);
  if (truncated)
    lines.push(
      `\n(Хэсэг ${KNOWLEDGE_MAX_SECTION_CHARS} тэмдэгтээр таслагдав — нарийвчлал хэрэгтэй бол тодорхой асуултаар дахин асуу.)`
    );
  const others = view.siblings.filter((s) => s.section !== view.section);
  if (others.length > 0) {
    lines.push("");
    lines.push(
      `Энэ сэдвийн бусад хэсэг: ${others.map((s) => `${s.section} (${s.heading})`).join(" · ")}`
    );
  }
  return lines.join("\n");
}

/** Tool-ын оролтын slug-ийг цэвэрлэнэ — path traversal, хоосон утга. */
export function normalizeTopicSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const slug = value.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  if (!slug || slug.includes("..") || !/^[\p{L}\p{N}\-]+(\/[\p{L}\p{N}\-]+)?$/u.test(slug)) return null;
  return slug;
}

export function normalizeSectionSlug(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const section = value.trim().toLowerCase();
  return /^[\p{L}\p{N}\-]+$/u.test(section) ? section : null;
}

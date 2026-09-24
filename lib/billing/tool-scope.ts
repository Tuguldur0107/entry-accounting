// Багц → AI/MCP tool-ийн хамрах хүрээ — ЦЭВЭР (tests/billing-skills.test.ts).
//
// «AI нягтлан» (skills) багц нь нягтлан бодох СИСТЕМгүй: мэдлэгийн сан + MCP л.
// Хаахгүй бол энэ хямд багцаар Entry-ийн бүх системийг (журнал, касс, POS…)
// MCP-ээр үнэгүй ашиглах зам нээгдэнэ. Хаалт ХОЁР цэгт: tools/list (клиент
// хэрэггүй 140 tool харахгүй) ба executeAiTool (жагсаалтыг тойрч шууд дуудсан ч).

import { hasFeature, type Entitlements } from "@/lib/billing/entitlements";

/** Нягтлан бодох системгүй багцад ч нээлттэй tool-ууд. */
export const ACCOUNTING_FREE_TOOLS: ReadonlySet<string> = new Set([
  "list_knowledge_topics",
  "read_knowledge_section",
  // Багцын төлөв, trial-ийн үлдсэн хугацааг хэрэглэгч AI-аасаа асууж болно.
  "get_billing_overview",
]);

/** Энэ байгууллагын багцад tool нээлттэй эсэх. */
export function toolInPlan(ent: Pick<Entitlements, "features">, toolName: string): boolean {
  return hasFeature(ent as Entitlements, "accounting") || ACCOUNTING_FREE_TOOLS.has(toolName);
}

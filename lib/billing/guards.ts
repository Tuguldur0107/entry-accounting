// Entitlement-ийн ШАЛГАХ ЦЭГҮҮД (docs/billing/00-proposal.md §4) — код даяар
// `if plan === …` тараахгүй, зөвхөн эдгээрийг дуудна. Алдаа `[CODE] текст`
// (AI/MCP/REST-ийн алдааны хэв маягтай ижил); dedicated горимд бүгд чимээгүй давна.

import {
  featureUsable,
  hasFeature,
  KNOWLEDGE_READ_ONLY_MESSAGES,
  limitReached,
  READ_ONLY_MESSAGES,
  type Entitlements,
} from "@/lib/billing/entitlements";
import { countOwnedCompanies, countSeatsUsed, getEntitlements } from "@/lib/billing/load";
import { FEATURE_LABELS, type FeatureKey } from "@/lib/billing/plans";

export class EntitlementError extends Error {
  constructor(
    public readonly code:
      | "SUBSCRIPTION_READ_ONLY"
      | "FEATURE_NOT_IN_PLAN"
      | "SEAT_LIMIT"
      | "COMPANY_LIMIT",
    message: string
  ) {
    super(`[${code}] ${message}`);
    this.name = "EntitlementError";
  }
}

/** Бичих/батлах зам — read-only багцад ШИДНЭ (унших хамаарахгүй). */
export async function assertWritesAllowed(orgId: string): Promise<Entitlements> {
  const ent = await getEntitlements(orgId);
  if (!ent.writable && ent.readOnlyReason)
    throw new EntitlementError("SUBSCRIPTION_READ_ONLY", READ_ONLY_MESSAGES[ent.readOnlyReason]);
  return ent;
}

export async function requireFeature(orgId: string, feature: FeatureKey): Promise<Entitlements> {
  const ent = await getEntitlements(orgId);
  if (hasFeature(ent, feature) && !featureUsable(ent, feature) && ent.readOnlyReason)
    throw new EntitlementError(
      "SUBSCRIPTION_READ_ONLY",
      (feature === "knowledge" ? KNOWLEDGE_READ_ONLY_MESSAGES : READ_ONLY_MESSAGES)[ent.readOnlyReason]
    );
  if (!hasFeature(ent, feature))
    throw new EntitlementError(
      "FEATURE_NOT_IN_PLAN",
      `«${FEATURE_LABELS[feature]}» таны багцад (${ent.planId}) ороогүй — Тохиргоо → Багц, төлбөр хэсгээс дээшлүүлнэ үү`
    );
  return ent;
}

/**
 * Нягтлан бодох систем багцад байгаа эсэх — «AI нягтлан» (skills) багцад
 * ШИДНЭ. requireModuleAction (бүх модулийн action) ба executeAiTool дуудна.
 */
export function assertAccountingIncluded(ent: Entitlements): void {
  if (!hasFeature(ent, "accounting"))
    throw new EntitlementError(
      "FEATURE_NOT_IN_PLAN",
      "«AI нягтлан» багцад нягтлан бодох систем ороогүй — мэдлэгийн сангаа ChatGPT / Claude-оосоо ашиглана. Системийг ашиглах бол Тохиргоо → Багц, төлбөр хэсгээс Standard багц руу шилжинэ"
    );
}

/**
 * Модулийн action-ийн багцын шалгалт — entitlement-ийг НЭГ удаа уншина:
 * нягтлан бодох систем багцад байх (унших ч мөн), бичих/батлах бол read-only биш.
 */
export async function assertModuleEntitlements(orgId: string, writing: boolean): Promise<Entitlements> {
  const ent = await getEntitlements(orgId);
  assertAccountingIncluded(ent);
  if (writing && !ent.writable && ent.readOnlyReason)
    throw new EntitlementError("SUBSCRIPTION_READ_ONLY", READ_ONLY_MESSAGES[ent.readOnlyReason]);
  return ent;
}

/** Урилга/гишүүн нэмэхийн өмнө — суудал дүүрсэн бол ШИДНЭ. */
export async function assertSeatAvailable(orgId: string): Promise<void> {
  const ent = await getEntitlements(orgId);
  if (ent.limits.seats === null) return;
  const used = await countSeatsUsed(orgId);
  if (limitReached(ent, "seats", used))
    throw new EntitlementError(
      "SEAT_LIMIT",
      `Суудлын хязгаар дүүрсэн (${used}/${ent.limits.seats}) — Тохиргоо → Багц, төлбөр хэсгээс суудал нэмнэ үү`
    );
}

/** Шинэ компани үүсгэхийн өмнө — multi_company боломж + компанийн тоо. */
export async function assertCompanyCreatable(activeOrgId: string, ownerUserId: string): Promise<void> {
  const ent = await getEntitlements(activeOrgId);
  if (ent.mode === "dedicated") return;
  const owned = await countOwnedCompanies(ownerUserId);
  if (owned >= 1 && !hasFeature(ent, "multi_company"))
    throw new EntitlementError(
      "FEATURE_NOT_IN_PLAN",
      `«${FEATURE_LABELS.multi_company}» таны багцад (${ent.planId}) ороогүй — Platform багц руу дээшлүүлнэ үү`
    );
  if (limitReached(ent, "companies", owned))
    throw new EntitlementError(
      "COMPANY_LIMIT",
      `Компанийн хязгаар дүүрсэн (${owned}/${ent.limits.companies})`
    );
}

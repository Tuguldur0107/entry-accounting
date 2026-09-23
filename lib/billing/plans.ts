// Багцын тодорхойлолт — ЦЭВЭР (client-safe, DB-гүй). docs/billing/00-proposal.md §2.
// Тоо/боломж энд л; байгууллага бүрийн ялгаа `organization_subscriptions.overrides`.

export type PlanId = "trial" | "standard" | "platform" | "enterprise" | "dedicated";

export type FeatureKey =
  | "ebarimt"
  | "ai"
  | "mcp"
  | "api.rest"
  | "multi_company"
  | "custom_extensions"
  | "knowledge";

export type LimitKey = "seats" | "companies";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";

export const FEATURE_KEYS: FeatureKey[] = [
  "ebarimt",
  "ai",
  "mcp",
  "api.rest",
  "multi_company",
  "custom_extensions",
  "knowledge",
];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  ebarimt: "eBarimt автомат баримт",
  // ENT-063: чат нь байгууллагын ӨӨРИЙН API түлхүүрээр ажилладаг (BYO key).
  ai: "AI туслах (өөрийн API түлхүүрээр)",
  mcp: "MCP холболт (Claude)",
  "api.rest": "REST API (гадаад интеграци)",
  multi_company: "Олон компани (групп / нягтлангийн фирм)",
  custom_extensions: "custom/ өргөтгөл",
  knowledge: "Мэдлэгийн сан (IFRS, татвар, цалин — AI/MCP)",
};

export const PLAN_LABELS: Record<PlanId, string> = {
  trial: "Туршилт",
  standard: "Standard",
  platform: "Platform",
  enterprise: "Enterprise",
  dedicated: "Тусдаа сервис (лицензээр)",
};

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Туршилт",
  active: "Идэвхтэй",
  past_due: "Төлбөр хоцорсон",
  suspended: "Түр зогсоосон",
  cancelled: "Цуцлагдсан",
};

/** null = хязгааргүй. */
export type PlanDef = {
  features: Record<FeatureKey, boolean>;
  limits: Record<LimitKey, number | null>;
  /** MNT / хэрэглэгч / сар — мэдээллийн чанартай (нэхэмжлэх фаз 2). */
  pricePerSeatMnt: number | null;
};

const ALL_ON: Record<FeatureKey, boolean> = {
  ebarimt: true,
  ai: true,
  mcp: true,
  "api.rest": true,
  multi_company: true,
  custom_extensions: true,
  // Мэдлэгийн сан нь АЛЬ Ч багцад default-оор ОРОХГҮЙ — Entry Console
  // байгууллага бүрд `overrides.features.knowledge` асаана
  // (docs/knowledge/00-proposal.md D2). dedicated-д ч ижил: агуулга нь
  // Entry-ээс л ирдэг тул fork өөрөө нээж чадахгүй.
  knowledge: false,
};

export const PLANS: Record<PlanId, PlanDef> = {
  trial: {
    features: ALL_ON,
    limits: { seats: 3, companies: 1 },
    pricePerSeatMnt: 0,
  },
  standard: {
    features: { ...ALL_ON, "api.rest": false, multi_company: false, custom_extensions: false },
    limits: { seats: 1, companies: 1 },
    pricePerSeatMnt: 100_000,
  },
  platform: {
    features: ALL_ON,
    limits: { seats: 1, companies: 10 },
    pricePerSeatMnt: 100_000,
  },
  enterprise: {
    features: ALL_ON,
    limits: { seats: null, companies: null },
    pricePerSeatMnt: null,
  },
  dedicated: {
    features: ALL_ON,
    limits: { seats: null, companies: null },
    pricePerSeatMnt: 20_000,
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** Trial-ийн хугацаа (хоног) — байгууллага үүссэнээс. */
export const TRIAL_DAYS = 14;
/** Төлбөр хоцорсны дараа бичих эрх хадгалагдах хоног (зөөлөн хязгаар). */
export const GRACE_DAYS = 14;
/** Trial дуусахын өмнө сануулах хоногууд. */
export const TRIAL_ALERT_DAYS = [7, 3, 1, 0] as const;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as string[]).includes(value);
}

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return (
    typeof value === "string" &&
    ["trialing", "active", "past_due", "suspended", "cancelled"].includes(value)
  );
}

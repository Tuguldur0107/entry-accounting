// Entitlement-ийн ЦЭВЭР шийдвэр (тесттэй, DB-гүй) — docs/billing/00-proposal.md §2–4.
// Оролт: deployment горим + байгууллагын subscription мөр (байхгүй байж болно)
// + өнөөдөр. Гаралт: боломж, хязгаар, бичих эрх, сануулга.

import type { DeploymentMode } from "@/lib/deployment-mode";
import {
  GRACE_DAYS,
  PLANS,
  TRIAL_DAYS,
  isPlanId,
  type FeatureKey,
  type LimitKey,
  type PlanId,
  type SubscriptionStatus,
} from "@/lib/billing/plans";

export type SubscriptionOverrides = {
  features?: Partial<Record<FeatureKey, boolean>>;
  limits?: Partial<Record<LimitKey, number | null>>;
};

/** organization_subscriptions мөрийн цэвэр хэлбэр (Date-ууд задарсан). */
export type SubscriptionRecord = {
  planId: string;
  status: string;
  seats: number | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  overrides: SubscriptionOverrides | null;
};

export type ReadOnlyReason = "trial_expired" | "past_due" | "suspended" | "cancelled";

export type Entitlements = {
  mode: DeploymentMode;
  planId: PlanId;
  status: SubscriptionStatus;
  features: Record<FeatureKey, boolean>;
  limits: Record<LimitKey, number | null>;
  /** Бичих/батлах зөвшөөрөгдөх үү (унших үргэлж). */
  writable: boolean;
  readOnlyReason: ReadOnlyReason | null;
  /** Trial-ийн дуусах өдөр (trialing үед), бусад үед null. */
  trialEndsAt: Date | null;
  /** Trial / grace-ийн үлдсэн хоног (0 = өнөөдөр дуусна); хамааралгүй бол null. */
  daysLeft: number | null;
  /** Төлбөр хоцорсон grace-ийн дуусах өдөр. */
  graceEndsAt: Date | null;
};

const DAY_MS = 24 * 60 * 60_000;

export function daysUntil(target: Date, now: Date): number {
  return Math.ceil((target.getTime() - now.getTime()) / DAY_MS);
}

export function trialEndFor(orgCreatedAt: Date): Date {
  return new Date(orgCreatedAt.getTime() + TRIAL_DAYS * DAY_MS);
}

/** overrides JSON-ийг fail-safe задална — танигдахгүй түлхүүр хаягдана. */
export function parseOverrides(raw: unknown): SubscriptionOverrides | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const out: SubscriptionOverrides = {};
  if (input.features && typeof input.features === "object" && !Array.isArray(input.features)) {
    const features: Partial<Record<FeatureKey, boolean>> = {};
    for (const [key, value] of Object.entries(input.features as Record<string, unknown>))
      if (key in PLANS.enterprise.features && typeof value === "boolean")
        features[key as FeatureKey] = value;
    out.features = features;
  }
  if (input.limits && typeof input.limits === "object" && !Array.isArray(input.limits)) {
    const limits: Partial<Record<LimitKey, number | null>> = {};
    for (const [key, value] of Object.entries(input.limits as Record<string, unknown>))
      if ((key === "seats" || key === "companies") && (value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0)))
        limits[key] = value;
    out.limits = limits;
  }
  return out;
}

export function resolveEntitlements(input: {
  mode: DeploymentMode;
  subscription: SubscriptionRecord | null;
  orgCreatedAt: Date;
  now?: Date;
}): Entitlements {
  const now = input.now ?? new Date();

  // Тусдаа сервис — лиценз л удирдана, энэ давхарга хязгаарлахгүй.
  if (input.mode === "dedicated") {
    return {
      mode: "dedicated",
      planId: "dedicated",
      status: "active",
      features: { ...PLANS.dedicated.features },
      limits: { ...PLANS.dedicated.limits },
      writable: true,
      readOnlyReason: null,
      trialEndsAt: null,
      daysLeft: null,
      graceEndsAt: null,
    };
  }

  const sub = input.subscription;

  // Мөргүй SaaS байгууллага = trial (үүссэнээс 14 хоног).
  if (!sub) {
    const trialEndsAt = trialEndFor(input.orgCreatedAt);
    const daysLeft = daysUntil(trialEndsAt, now);
    const expired = daysLeft < 0;
    return {
      mode: "saas",
      planId: "trial",
      status: "trialing",
      features: { ...PLANS.trial.features },
      limits: { ...PLANS.trial.limits },
      writable: !expired,
      readOnlyReason: expired ? "trial_expired" : null,
      trialEndsAt,
      daysLeft: expired ? null : daysLeft,
      graceEndsAt: null,
    };
  }

  const planId: PlanId = isPlanId(sub.planId) ? sub.planId : "standard";
  const plan = PLANS[planId];
  const features = { ...plan.features, ...(sub.overrides?.features ?? {}) };
  const limits: Record<LimitKey, number | null> = { ...plan.limits };
  if (sub.seats !== null && sub.seats !== undefined) limits.seats = sub.seats;
  for (const [key, value] of Object.entries(sub.overrides?.limits ?? {}))
    limits[key as LimitKey] = value as number | null;

  const status = (
    ["trialing", "active", "past_due", "suspended", "cancelled"].includes(sub.status)
      ? sub.status
      : "active"
  ) as SubscriptionStatus;

  let writable = true;
  let readOnlyReason: ReadOnlyReason | null = null;
  let trialEndsAt: Date | null = null;
  let daysLeft: number | null = null;
  let graceEndsAt: Date | null = null;

  if (status === "trialing") {
    trialEndsAt = sub.trialEndsAt ?? trialEndFor(input.orgCreatedAt);
    const left = daysUntil(trialEndsAt, now);
    if (left < 0) {
      writable = false;
      readOnlyReason = "trial_expired";
    } else daysLeft = left;
  } else if (status === "past_due") {
    // Grace — хугацааны эцэс (currentPeriodEnd) эсвэл тэмдэглэсэн өдрөөс 14 хоног.
    const anchor = sub.currentPeriodEnd ?? now;
    graceEndsAt = new Date(anchor.getTime() + GRACE_DAYS * DAY_MS);
    const left = daysUntil(graceEndsAt, now);
    if (left < 0) {
      writable = false;
      readOnlyReason = "past_due";
    } else daysLeft = left;
  } else if (status === "suspended" || status === "cancelled") {
    writable = false;
    readOnlyReason = status;
  }

  return {
    mode: "saas",
    planId,
    status,
    features,
    limits,
    writable,
    readOnlyReason,
    trialEndsAt,
    daysLeft,
    graceEndsAt,
  };
}

export function hasFeature(ent: Entitlements, feature: FeatureKey): boolean {
  return ent.features[feature] === true;
}

/** Хязгаар хүрсэн үү (null = хязгааргүй). */
export function limitReached(ent: Entitlements, key: LimitKey, used: number): boolean {
  const limit = ent.limits[key];
  return limit !== null && used >= limit;
}

export const READ_ONLY_MESSAGES: Record<ReadOnlyReason, string> = {
  trial_expired:
    "Туршилтын хугацаа дууссан — бичилт хийхийн тулд багцаа идэвхжүүлнэ үү (Тохиргоо → Багц, төлбөр). Унших, тайлан, экспорт нээлттэй.",
  past_due:
    "Төлбөрийн хоцрогдлын хугацаа дууссан тул бичилт түр хаагдлаа — төлбөрөө төлсний дараа шууд сэргэнэ. Унших, тайлан, экспорт нээлттэй.",
  suspended:
    "Багц түр зогсоосон байна — бичилт хаалттай. Тохиргоо → Багц, төлбөр хэсгээс холбогдоно уу.",
  cancelled:
    "Багц цуцлагдсан байна — бичилт хаалттай, өгөгдөл хэвээр. Дахин идэвхжүүлэхийн тулд холбогдоно уу.",
};

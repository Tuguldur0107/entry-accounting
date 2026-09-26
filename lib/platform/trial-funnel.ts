// Туршилтын funnel (Entry Console) — ЦЭВЭР тооцоо (tests/trial-funnel.test.ts).
// DB давхарга нь trial-funnel-store.ts, route нь /api/platform/trial-funnel.
//
// Когорт = [from, to] мужид ҮҮССЭН байгууллагууд. Алхам бүрийн огноо нь
// өгөгдлөөс (зохиохгүй): AI холболт = анхны OAuth/token, мастер дата = анхны
// харилцагч/бараа/ажилтан (системийн seed харилцагч хасагдсан), журнал = анхны
// журнал, төлбөр = анхны төлөгдсөн QPay төлбөр (эсвэл Console-оос идэвхжүүлсэн).
//
// Funnel нь ДАРААЛСАН: алхам k-д хүрсэн = өмнөх бүх алхамд хүрсэн. Дараалал
// алгасч хүрсэн (жнь журналгүй төлсөн) нь `reachedAnyOrder`-д тусдаа харагдана.

export type FunnelStageKey = "signed_up" | "connected" | "master_data" | "first_journal" | "paid";

/** «AI нягтлан» (skills) нь нягтлан бодох системгүй тул өөрийн богино funnel-тэй. */
export type FunnelProduct = "accounting" | "skills";

export const FUNNEL_STAGE_LABELS: Record<FunnelStageKey, string> = {
  signed_up: "Бүртгүүлсэн",
  connected: "AI холбосон",
  master_data: "Мастер дата оруулсан",
  first_journal: "Анхны журнал",
  paid: "Төлсөн",
};

const STAGES: Record<FunnelProduct, readonly FunnelStageKey[]> = {
  accounting: ["signed_up", "connected", "master_data", "first_journal", "paid"],
  skills: ["signed_up", "connected", "paid"],
};

export function funnelStages(product: FunnelProduct): readonly FunnelStageKey[] {
  return STAGES[product];
}

export function productOfPlan(planId: string | null): FunnelProduct {
  return planId === "skills" ? "skills" : "accounting";
}

export function isFunnelProduct(value: unknown): value is FunnelProduct {
  return value === "accounting" || value === "skills";
}

export type TrialFunnelOrg = {
  organizationId: string;
  orgName: string;
  createdAt: Date;
  /** null = subscription мөргүй (SaaS-д туршилт). */
  planId: string | null;
  isDemo: boolean;
  /** Эзний АНХНЫ байгууллага эсэх — false бол «дахин нэг компани» (шинэ бүртгэл биш). */
  firstOrgOfOwner: boolean;
  connectedAt: Date | null;
  masterDataAt: Date | null;
  firstJournalAt: Date | null;
  paidAt: Date | null;
  /** Төлбөргүйгээр Console-оос идэвхтэй төлбөртэй багцад шилжүүлсэн (банкны шилжүүлэг г.м.). */
  manuallyConverted: boolean;
  welcomeDismissed: boolean;
};

export type FunnelStageStat = {
  key: FunnelStageKey;
  label: string;
  /** Өмнөх бүх алхмыг давж энэ алхамд хүрсэн байгууллага. */
  count: number;
  /** Дараалал харгалзахгүй энэ алхамд хүрсэн. */
  reachedAnyOrder: number;
  /** count / когорт, 0–1 (когорт хоосон бол null). */
  rateFromSignup: number | null;
  /** count / өмнөх алхмын count, 0–1. */
  rateFromPrevious: number | null;
  /** Бүртгэлээс энэ алхам хүртэлх хугацааны МЕДИАН (цаг) — огноо мэдэгдэх байгууллагаар. */
  medianHoursFromSignup: number | null;
};

export type TrialFunnelOrgRow = {
  organizationId: string;
  orgName: string;
  createdAt: string;
  planId: string | null;
  /** Дараалсан funnel-ийн хамгийн сүүлд хүрсэн алхам. */
  lastStage: FunnelStageKey;
  connectedAt: string | null;
  masterDataAt: string | null;
  firstJournalAt: string | null;
  paidAt: string | null;
  manuallyConverted: boolean;
  welcomeDismissed: boolean;
};

export type TrialFunnel = {
  product: FunnelProduct;
  from: string;
  to: string;
  cohortSize: number;
  stages: FunnelStageStat[];
  /** Когортоос хасагдсан: демо компани, эзний нэмэлт компани, өөр бүтээгдэхүүн. */
  excluded: { demo: number; additionalCompany: number; otherProduct: number };
  /** «Анхны туршилт» картыг «Дараа үзнэ» дарж хаасан байгууллага. */
  welcomeDismissed: number;
  orgs: TrialFunnelOrgRow[];
};

function stageAt(org: TrialFunnelOrg, key: FunnelStageKey): Date | null {
  switch (key) {
    case "signed_up":
      return org.createdAt;
    case "connected":
      return org.connectedAt;
    case "master_data":
      return org.masterDataAt;
    case "first_journal":
      return org.firstJournalAt;
    case "paid":
      return org.paidAt;
  }
}

function reached(org: TrialFunnelOrg, key: FunnelStageKey): boolean {
  return key === "paid" ? org.paidAt != null || org.manuallyConverted : stageAt(org, key) != null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const HOUR_MS = 3_600_000;

function ratio(count: number, base: number): number | null {
  return base > 0 ? count / base : null;
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function buildTrialFunnel(
  orgs: readonly TrialFunnelOrg[],
  options: { product: FunnelProduct; from: string; to: string }
): TrialFunnel {
  const excluded = { demo: 0, additionalCompany: 0, otherProduct: 0 };
  const cohort: TrialFunnelOrg[] = [];
  for (const org of orgs) {
    if (org.isDemo) excluded.demo += 1;
    else if (!org.firstOrgOfOwner) excluded.additionalCompany += 1;
    else if (productOfPlan(org.planId) !== options.product) excluded.otherProduct += 1;
    else cohort.push(org);
  }

  const keys = funnelStages(options.product);
  const stages: FunnelStageStat[] = [];
  let previousCount = cohort.length;
  for (const [index, key] of keys.entries()) {
    const prior = keys.slice(0, index + 1);
    const count = cohort.filter((org) => prior.every((k) => reached(org, k))).length;
    const durations = cohort.flatMap((org) => {
      const at = stageAt(org, key);
      return at ? [Math.max(0, (at.getTime() - org.createdAt.getTime()) / HOUR_MS)] : [];
    });
    stages.push({
      key,
      label: FUNNEL_STAGE_LABELS[key],
      count,
      reachedAnyOrder: cohort.filter((org) => reached(org, key)).length,
      rateFromSignup: ratio(count, cohort.length),
      rateFromPrevious: index === 0 ? ratio(count, cohort.length) : ratio(count, previousCount),
      medianHoursFromSignup: key === "signed_up" ? 0 : median(durations),
    });
    previousCount = count;
  }

  const rows: TrialFunnelOrgRow[] = cohort
    .map((org) => {
      let lastStage: FunnelStageKey = "signed_up";
      for (const key of keys) {
        if (!reached(org, key)) break;
        lastStage = key;
      }
      return {
        organizationId: org.organizationId,
        orgName: org.orgName,
        createdAt: org.createdAt.toISOString(),
        planId: org.planId,
        lastStage,
        connectedAt: isoOrNull(org.connectedAt),
        masterDataAt: isoOrNull(org.masterDataAt),
        firstJournalAt: isoOrNull(org.firstJournalAt),
        paidAt: isoOrNull(org.paidAt),
        manuallyConverted: org.manuallyConverted,
        welcomeDismissed: org.welcomeDismissed,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    product: options.product,
    from: options.from,
    to: options.to,
    cohortSize: cohort.length,
    stages,
    excluded,
    welcomeDismissed: cohort.filter((org) => org.welcomeDismissed).length,
    orgs: rows,
  };
}

export const FUNNEL_DEFAULT_DAYS = 90;
export const FUNNEL_MAX_DAYS = 366;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * URL-ийн from/to (YYYY-MM-DD, хамруулсан) → муж. Өгөөгүй бол `today`-гоос
 * сүүлийн 90 хоног. Гажиг огноо, урвуу муж, 366 хоногоос урт муж → ШИДНЭ.
 */
export function parseFunnelRange(
  params: { from?: string | null; to?: string | null },
  today: string
): { from: string; to: string } {
  const to = params.to?.trim() || today;
  const from = params.from?.trim() || addDays(to, -(FUNNEL_DEFAULT_DAYS - 1));
  if (!isCalendarDate(from) || !isCalendarDate(to)) throw new Error("Огноо YYYY-MM-DD хэлбэртэй байна");
  if (from > to) throw new Error("Эхлэх огноо дуусахаас хойш байна");
  if (addDays(from, FUNNEL_MAX_DAYS) <= to) throw new Error(`Муж ${FUNNEL_MAX_DAYS} хоногоос урт байж болохгүй`);
  return { from, to };
}

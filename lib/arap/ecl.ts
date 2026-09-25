// Авлагын хүлээгдэж буй зээлийн алдагдал (IFRS 9 ECL) ба найдваргүй авлага
// хасах — ЦЭВЭР, client-safe (tests/arap-ecl.test.ts). ENT-065.
//
// Шийдвэр (product owner 2026-09-25, docs/cost README 1.2):
//   D-ECL-1 — нөөц 12000099 «Авлагын ECL нөөц» (contra), зардал 87000002;
//             хоёулаа `arap_ecl_settings`-ийн РОЛЬ (кодод дугаар хатуу биш —
//             доорх default нь анхны утга л).
//   D-ECL-2 — хялбаршуулсан арга (IFRS 9.5.5.15), provision matrix: жишиг хувь
//             default, байгууллага өөрийн түүхэн алдагдлаар засна.
//   D-ECL-3 — хойшлогдсон татвар (IAS 12): нөөц нь татварын хасагдах зардал
//             биш гэж үзэж DTA = нөөц × байгууллагын ОРУУЛСАН ААНОАТ-ын хувь.
//             Хувь ЗОХИОХГҮЙ — тохируулаагүй бол DTA бодогдохгүй (ил хэлнэ).
//   D-ECL-4 — хассан авлагын сэргэлт: Dr авлага / Cr ECL зардал (зардлыг
//             бууруулна), дараа нь ердийн кассын орлогоор хаагдана.

export type EclBucket = {
  /** Хугацаа хэтэрсэн хоногийн дээд хил (хамруулсан); null = дээд хилгүй. */
  maxDays: number | null;
  /** Нөөцийн хувь, 0–100. */
  ratePct: number;
};

/** Жишиг provision matrix (knowledge IFRS 9 §ECL) — хугацаа болоогүй нь эхний бүлэгт. */
export const DEFAULT_ECL_MATRIX: EclBucket[] = [
  { maxDays: 30, ratePct: 1 },
  { maxDays: 60, ratePct: 5 },
  { maxDays: 90, ratePct: 10 },
  { maxDays: 180, ratePct: 25 },
  { maxDays: 365, ratePct: 50 },
  { maxDays: null, ratePct: 100 },
];

export const DEFAULT_ECL_ACCOUNTS = {
  allowance: "12000099",
  expense: "87000002",
  deferredTaxAsset: "26000001",
  deferredTaxExpense: "70000004",
} as const;

/** ECL журналын externalRef угтвар — ноорог нь дахин ажиллуулахад солигдоно. */
export const ECL_PROVISION_REF_PREFIX = "ecl-provision:";
/** Хойшлогдсон татварын мөрийн бизнес объектын төрөл (DTA данс бусад зөрүүтэй хуваалцана). */
export const ECL_DEFERRED_TAX_OBJECT = "ecl_deferred_tax";
/** Хасалтын шалтгааны доод урт (аудит). */
export const WRITE_OFF_REASON_MIN = 5;

const round2 = (value: number) => Math.round(value * 100) / 100 + 0; // +0: -0 → 0

export function bucketLabel(matrix: EclBucket[], index: number): string {
  const lower = index === 0 ? 0 : (matrix[index - 1].maxDays ?? 0) + 1;
  const upper = matrix[index].maxDays;
  if (index === 0) return `Хугацаа болоогүй – ${upper} хоног`;
  return upper == null ? `${lower}+ хоног` : `${lower}–${upper} хоног`;
}

/** Matrix-ийн шалгалт — алдааны монгол текстүүд (хоосон = зөв). */
export function eclMatrixProblems(matrix: EclBucket[]): string[] {
  const problems: string[] = [];
  if (!Array.isArray(matrix) || matrix.length < 2) return ["Хамгийн багадаа 2 бүлэг байна"];
  if (matrix.length > 12) problems.push("12-оос ихгүй бүлэг");
  matrix.forEach((bucket, index) => {
    const last = index === matrix.length - 1;
    if (!Number.isFinite(bucket.ratePct) || bucket.ratePct < 0 || bucket.ratePct > 100)
      problems.push(`${index + 1}-р бүлэг: хувь 0–100 байна`);
    if (last) {
      if (bucket.maxDays != null) problems.push("Сүүлийн бүлэг дээд хилгүй («… +») байна");
      return;
    }
    if (bucket.maxDays == null || !Number.isInteger(bucket.maxDays) || bucket.maxDays < 0)
      problems.push(`${index + 1}-р бүлэг: хоногийн хил 0-ээс их бүхэл тоо`);
    const previous = index > 0 ? matrix[index - 1].maxDays : -1;
    if (bucket.maxDays != null && previous != null && bucket.maxDays <= previous)
      problems.push(`${index + 1}-р бүлэг: хил өмнөхөөсөө их байна`);
    if (index > 0 && bucket.ratePct < matrix[index - 1].ratePct)
      problems.push(`${index + 1}-р бүлэг: хугацаа уртсах тусам хувь буурахгүй`);
  });
  return problems;
}

export function daysPastDue(asOf: string, dueDate: string): number {
  const diff = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`);
  return Number.isFinite(diff) ? Math.floor(diff / 86_400_000) : 0;
}

export function bucketIndexOf(matrix: EclBucket[], days: number): number {
  const index = matrix.findIndex((bucket) => bucket.maxDays != null && days <= bucket.maxDays);
  return index === -1 ? matrix.length - 1 : index;
}

export type EclOpenItem = {
  dueDate: string;
  /** asOf-ийн байдлаарх нээлттэй үлдэгдэл, MNT (эерэг). */
  baseBalance: number;
};

export type EclBucketResult = {
  label: string;
  ratePct: number;
  balance: number;
  count: number;
  required: number;
};

export type EclProvisionPlan = {
  buckets: EclBucketResult[];
  grossBalance: number;
  requiredAllowance: number;
  /** GL-ийн одоогийн нөөц (эерэг = Кт үлдэгдэл). */
  currentAllowance: number;
  /** >0 → Dr зардал / Cr нөөц; <0 → Dr нөөц / Cr зардал (эргэлт). */
  allowanceDelta: number;
  deferredTax: {
    ratePct: number;
    requiredAsset: number;
    currentAsset: number;
    /** >0 → Dr DTA / Cr хойшлогдсон татварын зардал. */
    delta: number;
  } | null;
};

/**
 * Хялбаршуулсан арга: нөөц = Σ(бүлгийн үлдэгдэл × хувь) — бүлэг бүр 0.01-ээр.
 * Сарын бичилт = шаардлагатай − одоогийн (delta). DTA = шаардлагатай нөөц ×
 * ААНОАТ-ын хувь (хувь null бол тооцохгүй — зохиохгүй).
 */
export function planEclProvision(input: {
  asOf: string;
  items: EclOpenItem[];
  matrix: EclBucket[];
  currentAllowance: number;
  taxRatePct: number | null;
  currentDeferredTaxAsset: number;
}): EclProvisionPlan {
  const buckets: EclBucketResult[] = input.matrix.map((bucket, index) => ({
    label: bucketLabel(input.matrix, index),
    ratePct: bucket.ratePct,
    balance: 0,
    count: 0,
    required: 0,
  }));
  for (const item of input.items) {
    if (!(item.baseBalance > 0.005)) continue;
    const bucket = buckets[bucketIndexOf(input.matrix, daysPastDue(input.asOf, item.dueDate))];
    bucket.balance += item.baseBalance;
    bucket.count += 1;
  }
  for (const bucket of buckets) {
    bucket.balance = round2(bucket.balance);
    bucket.required = round2((bucket.balance * bucket.ratePct) / 100);
  }
  const requiredAllowance = round2(buckets.reduce((sum, bucket) => sum + bucket.required, 0));
  const currentAllowance = round2(input.currentAllowance);
  let deferredTax: EclProvisionPlan["deferredTax"] = null;
  if (input.taxRatePct != null && Number.isFinite(input.taxRatePct)) {
    const requiredAsset = round2((requiredAllowance * input.taxRatePct) / 100);
    const currentAsset = round2(input.currentDeferredTaxAsset);
    deferredTax = {
      ratePct: input.taxRatePct,
      requiredAsset,
      currentAsset,
      delta: round2(requiredAsset - currentAsset),
    };
  }
  return {
    buckets,
    grossBalance: round2(buckets.reduce((sum, bucket) => sum + bucket.balance, 0)),
    requiredAllowance,
    currentAllowance,
    allowanceDelta: round2(requiredAllowance - currentAllowance),
    deferredTax,
  };
}

export type EclJournalLine = {
  role: "allowance" | "expense" | "deferredTaxAsset" | "deferredTaxExpense";
  debit: number;
  credit: number;
  description: string;
};

/** ECL-ийн сарын журналын мөрүүд — хоосон бол бичих зүйлгүй. */
export function eclJournalLines(plan: EclProvisionPlan, asOf: string): EclJournalLine[] {
  const lines: EclJournalLine[] = [];
  const delta = plan.allowanceDelta;
  if (Math.abs(delta) >= 0.01) {
    const text = delta > 0 ? `ECL нөөц нэмэгдүүлэлт ${asOf}` : `ECL нөөцийн эргэлт ${asOf}`;
    lines.push(
      delta > 0
        ? { role: "expense", debit: delta, credit: 0, description: text }
        : { role: "allowance", debit: -delta, credit: 0, description: text },
      delta > 0
        ? { role: "allowance", debit: 0, credit: delta, description: text }
        : { role: "expense", debit: 0, credit: -delta, description: text }
    );
  }
  const tax = plan.deferredTax;
  if (tax && Math.abs(tax.delta) >= 0.01) {
    const text = `ECL-ийн хойшлогдсон татвар (IAS 12, ${tax.ratePct}%) ${asOf}`;
    lines.push(
      tax.delta > 0
        ? { role: "deferredTaxAsset", debit: tax.delta, credit: 0, description: text }
        : { role: "deferredTaxExpense", debit: -tax.delta, credit: 0, description: text },
      tax.delta > 0
        ? { role: "deferredTaxExpense", debit: 0, credit: tax.delta, description: text }
        : { role: "deferredTaxAsset", debit: 0, credit: -tax.delta, description: text }
    );
  }
  return lines;
}

/**
 * Хасалтын задаргаа (IFRS 9.5.4.4): эхлээд бий болсон нөөцөөс (Кт үлдэгдэл),
 * хүрэхгүй хэсэг нь шууд ECL зардал. Нөөц хэзээ ч Дт үлдэгдэлтэй болохгүй.
 */
export function splitWriteOff(amount: number, allowanceBalance: number) {
  const total = round2(amount);
  const fromAllowance = round2(Math.min(total, Math.max(0, allowanceBalance)));
  return { fromAllowance, toExpense: round2(total - fromAllowance) };
}

/** Сэргэлт/буцаалтын өмнөх үлдэгдлийн шалгалт — алдааны текст эсвэл null. */
export function recoveryProblem(amount: number, writtenOff: number, recovered: number): string | null {
  if (!(amount > 0)) return "Сэргэлтийн дүн 0-ээс их байна";
  const remaining = round2(writtenOff - recovered);
  if (amount > remaining + 0.005)
    return `[RECOVERY_EXCEEDS] Сэргэлт хассан дүнгийн үлдэгдлээс (${remaining.toLocaleString("en-US")}) их байна`;
  return null;
}

// ── Харагдацын төрлүүд (client-safe) ─────────────────────────────────────────

export type EclSettingsView = {
  allowanceAccountNumber: string;
  expenseAccountNumber: string;
  deferredTaxAssetAccountNumber: string;
  deferredTaxExpenseAccountNumber: string;
  matrix: EclBucket[];
  /** null = тохируулаагүй → DTA бодогдохгүй. */
  taxRatePct: number | null;
};

export type EclOverviewResult = {
  asOf: string;
  settings: EclSettingsView;
  plan: EclProvisionPlan;
  /** Ноорог ECL журнал (нэг л байна — дахин ажиллуулахад солигдоно). */
  drafts: { id: string; documentNo: string | null; date: string }[];
};

export type ArapWriteOffView = {
  id: string;
  date: string;
  amount: number;
  baseAmount: number;
  allowanceAmount: number;
  expenseAmount: number;
  recoveredAmount: number;
  reason: string;
  status: string;
  voucherId: string;
};

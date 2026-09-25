// AI санал → үр дүнгийн бүртгэлийн ЦОРЫН ГАНЦ бичих/унших зам.
//
// ХАТУУ ДҮРЭМ (RLS-гүй сонголтын хамгаалалт, docs/ai-logging.md §3):
//   `ai_suggestion_log` / `ai_suggestion_outcome` хүснэгтэд хандах query
//   ЗӨВХӨН энэ файлд байна. Функц бүр эхний параметрээрээ `AiLogScope`
//   (getActiveOrg()-оос гарсан orgId) хүлээн авч WHERE-т ЗААВАЛ тавина.
//   Энэ дүрмийг `tests/ai-logging-direct-db.test.ts` СТАТИКААР сахиулна —
//   өөр файлаас эдгээр хүснэгтийг дурдвал CI УНАНА.
//
// ХОЁР ДАХЬ ДҮРЭМ: энэ давхарга бизнесийн урсгалыг ХЭЗЭЭ Ч унагахгүй
// (lib/audit.ts-тэй ижил зарчим) — алдааг console-д логлоод залгина.
// Бүртгэл бичигдэхгүй байх нь бичилт бүтэлгүйтэхээс ДЭЭР.

import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiSuggestionLog, aiSuggestionOutcome } from "@/lib/db/schema";

import {
  DEFAULT_TRAINING_SCOPE,
  isAiLinkedDocumentType,
  isAiResolution,
  isAiSuggestionSource,
  isInvalidatingAuditAction,
  isPostingAuditAction,
  isUnpostingAuditAction,
  type AiLinkedDocumentType,
  type AiResolution,
  type AiTrainingScope,
} from "./constants";
import { currentAiLogContext } from "./context";
import { planTrainingScope, redactForScope } from "./redact";
import { canTransition, isTrainingEligible } from "./resolution";

/** Drizzle транзакц эсвэл үндсэн холболт — аль аль нь дамжина. */
type DbLike = Pick<typeof db, "insert" | "select" | "update">;

/**
 * Tenant scope — ЗААВАЛ `getActiveOrg()`-оос гарсан байна. Client-ээс
 * ирсэн orgId-г ЭНД дамжуулахыг ХОРИГЛОНО (IDOR).
 */
export type AiLogScope = {
  orgId: string;
  /** Үйлдэл хийж буй хэрэглэгч (createdBy / resolvedBy). */
  userId?: string | null;
};

function warn(what: string, error: unknown): void {
  console.error(`[ai-logging] ${what} бичиж чадсангүй:`, error);
}

// ── 1. Санал бүртгэх ────────────────────────────────────────────────────────

export type LogAiSuggestionInput = {
  /** MCP/REST-ээр ирсэн бол tool-ийн нэр. */
  toolName?: string | null;
  /** Асуултын контекст — ТҮҮХИЙ хадгалагдана. */
  inputPayload?: unknown;
  /** AI юу санал болгосон — ТҮҮХИЙ хадгалагдана. */
  suggestedValue?: unknown;
  /** 0…1 (өгөгдөөгүй бол null — таамаглахгүй). */
  confidence?: number | null;
  latencyMs?: number | null;
  /** Контекстийн утгыг дарж бичих (ихэвчлэн хэрэггүй). */
  source?: string;
  sessionId?: string | null;
  requestId?: string | null;
  modelName?: string | null;
  modelVersion?: string | null;
  trainingScope?: AiTrainingScope;
};

/**
 * AI-ийн саналыг бүртгэнэ. ХЭЗЭЭ Ч шидэхгүй — амжилтгүй бол `null`.
 *
 * Эх сурвалж (source), session/request/model нь ALS контекстоос автоматаар
 * ирнэ (lib/ai-logging/context.ts) — дуудагч бүр давтаж өгөх шаардлагагүй.
 */
export async function logAiSuggestion(
  scope: AiLogScope,
  input: LogAiSuggestionInput = {},
  executor: DbLike = db
): Promise<string | null> {
  try {
    const ctx = currentAiLogContext();
    const source = input.source ?? ctx.source;

    // training_scope нь ХЭЗЭЭ Ч автоматаар өргөгдөхгүй — planTrainingScope
    // цэвэрлэлтийн дараа PII үлдсэн эсэхийг шалгаж шаардвал бууруулна.
    const plan = planTrainingScope(input.trainingScope ?? ctx.trainingScope, [
      input.inputPayload ?? null,
      input.suggestedValue ?? null,
    ]);

    const [row] = await executor
      .insert(aiSuggestionLog)
      .values({
        organizationId: scope.orgId,
        source: isAiSuggestionSource(source) ? source : "internal_agent",
        actorUserId: scope.userId ?? null,
        modelName: input.modelName ?? ctx.modelName ?? null,
        modelVersion: input.modelVersion ?? ctx.modelVersion ?? null,
        sessionId: input.sessionId ?? ctx.sessionId ?? null,
        requestId: input.requestId ?? ctx.requestId ?? null,
        toolName: input.toolName ?? null,
        inputPayload: (input.inputPayload ?? null) as never,
        suggestedValue: (input.suggestedValue ?? null) as never,
        confidence:
          typeof input.confidence === "number" && Number.isFinite(input.confidence)
            ? String(input.confidence)
            : null,
        latencyMs:
          typeof input.latencyMs === "number" && Number.isFinite(input.latencyMs)
            ? Math.max(0, Math.round(input.latencyMs))
            : null,
        trainingScope: plan.scope,
        scopeDowngradeReason: plan.downgradeReason,
      })
      .returning({ id: aiSuggestionLog.id });
    return row?.id ?? null;
  } catch (error) {
    warn("санал", error);
    return null;
  }
}

// ── 2. Үр дүн бүртгэх / шинэчлэх ────────────────────────────────────────────

export type ResolveAiSuggestionInput = {
  resolution: AiResolution;
  /** Эцэст нь юу бичигдсэн. */
  finalValue?: unknown;
  /** Polymorphic холбоос — AiAction.kind / аудитын entityType. */
  linkedDocumentType?: string | null;
  linkedDocumentId?: string | null;
  /** Баримтын ӨӨРИЙН огноо (YYYY-MM-DD) — периодын хаалтын шүүлтүүрт. */
  linkedDocumentDate?: string | null;
  /** Үүсэх мөчид батлагдсан эсэх (post горим). Дараа нь аудитын гүүр дарна. */
  isPosted?: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Саналын үр дүнг бичнэ (1:1 — suggestion бүрд НЭГ мөр, байрандаа update).
 * ХЭЗЭЭ Ч шидэхгүй — амжилтгүй бол `false`.
 *
 * Шилжилтийг `canTransition` хамгаална: зөвшөөрөгдөөгүй шилжилт (ж: rejected
 * → accepted) ЧИМЭЭГҮЙ алгасагдана, байгаа мөр хэвээр үлдэнэ.
 */
export async function resolveAiSuggestion(
  scope: AiLogScope,
  suggestionId: string,
  input: ResolveAiSuggestionInput,
  executor: DbLike = db
): Promise<boolean> {
  try {
    if (!isAiResolution(input.resolution)) return false;

    // Санал нь ЭНЭ байгууллагынх мөн эсэхийг ЗААВАЛ шалгана — өөр tenant-ийн
    // саналд үр дүн бичих замыг бүрэн хаана.
    const [owner] = await executor
      .select({ id: aiSuggestionLog.id })
      .from(aiSuggestionLog)
      .where(
        and(
          eq(aiSuggestionLog.id, suggestionId),
          eq(aiSuggestionLog.organizationId, scope.orgId)
        )
      )
      .limit(1);
    if (!owner) return false;

    const [existing] = await executor
      .select({ resolution: aiSuggestionOutcome.resolution })
      .from(aiSuggestionOutcome)
      .where(
        and(
          eq(aiSuggestionOutcome.suggestionId, suggestionId),
          eq(aiSuggestionOutcome.organizationId, scope.orgId)
        )
      )
      .limit(1);

    if (existing) {
      const from = isAiResolution(existing.resolution)
        ? existing.resolution
        : "no_action";
      if (!canTransition(from, input.resolution)) return false;
    }

    const linkedType =
      input.linkedDocumentType && isAiLinkedDocumentType(input.linkedDocumentType)
        ? input.linkedDocumentType
        : null;
    const docDate =
      input.linkedDocumentDate && ISO_DATE.test(input.linkedDocumentDate)
        ? input.linkedDocumentDate
        : null;

    const values = {
      organizationId: scope.orgId,
      suggestionId,
      resolution: input.resolution,
      finalValue: (input.finalValue ?? null) as never,
      resolvedAt: new Date(),
      resolvedByUserId: scope.userId ?? null,
      linkedDocumentType: linkedType,
      linkedDocumentId: input.linkedDocumentId ?? null,
      linkedDocumentDate: docDate,
      isPosted: input.isPosted ?? false,
      updatedAt: new Date(),
    };

    await executor
      .insert(aiSuggestionOutcome)
      .values(values)
      .onConflictDoUpdate({
        target: aiSuggestionOutcome.suggestionId,
        set: {
          resolution: values.resolution,
          finalValue: values.finalValue,
          resolvedAt: values.resolvedAt,
          resolvedByUserId: values.resolvedByUserId,
          // Холбоос / огноог зөвхөн ШИНЭ утга ирсэн үед дарна — дараагийн
          // шинэчлэл (ж. зөвхөн resolution солих) холбоосыг УСТГАХГҮЙ.
          linkedDocumentType: sql`coalesce(${values.linkedDocumentType}, ${aiSuggestionOutcome.linkedDocumentType})`,
          linkedDocumentId: sql`coalesce(${values.linkedDocumentId}::uuid, ${aiSuggestionOutcome.linkedDocumentId})`,
          linkedDocumentDate: sql`coalesce(${values.linkedDocumentDate}, ${aiSuggestionOutcome.linkedDocumentDate})`,
          // is_posted нь зөвхөн ӨСӨХ чиглэлд (аудитын гүүр л буцаана).
          isPosted: sql`${aiSuggestionOutcome.isPosted} or ${values.isPosted}`,
          updatedAt: values.updatedAt,
        },
      });
    return true;
  } catch (error) {
    warn("үр дүн", error);
    return false;
  }
}

// ── 3. Аудитын гүүр — is_posted / has_reversal ──────────────────────────────

/**
 * Аудитын үйл явдлыг үр дүнгийн мөрүүдэд тусгана (lib/audit.ts дуудна).
 *
 * ЯАГААД ЭНЭ ЗАМ: буцаалт нь энэ codebase-д нэг хүснэгтэд биш, эх баримтын
 * `status` талбарт илэрхийлэгддэг (journal/cash/arap/inventory → "reversed",
 * pos_sale → "returned", purchase_order → "cancelled") бөгөөд зам бүр
 * `logAuditEvent` дуудна. Тиймээс 8 хүснэгтийн LEFT JOIN бичихийн оронд
 * аудитын НЭГ гүүрээр бүх өнөөгийн ба ИРЭЭДҮЙН замыг хамарна.
 *
 * ХЭЗЭЭ Ч шидэхгүй.
 */
export async function applyAuditToOutcomes(
  event: {
    organizationId: string;
    action: string;
    entityType: string;
    entityId: string;
  },
  executor: DbLike = db
): Promise<void> {
  try {
    if (!isAiLinkedDocumentType(event.entityType)) return;
    // entityId нь uuid биш (ж. period code) байж болно — uuid багана руу
    // харьцуулбал Postgres шидэх тул урьдчилж шалгана.
    if (!UUID_RE.test(event.entityId)) return;

    const where = and(
      eq(aiSuggestionOutcome.organizationId, event.organizationId),
      eq(aiSuggestionOutcome.linkedDocumentType, event.entityType),
      eq(aiSuggestionOutcome.linkedDocumentId, event.entityId)
    );

    if (isInvalidatingAuditAction(event.action)) {
      await executor
        .update(aiSuggestionOutcome)
        .set({
          hasReversal: true,
          invalidatedReason: event.action,
          invalidatedAt: new Date(),
          // Устгал нь «хүн татгалзав» гэсэн үг — буцаалт/цуцлалт нь баримт
          // үүссэн ч хожим хүчингүй болсон гэсэн ӨӨР утга тул resolution
          // хэвээр. canTransition-ийн дүрмийг SQL-д давтав: rejected нь
          // ЭЦСИЙН тул давхар бичилт нөлөөгүй (идемпотент).
          ...(event.action === "delete" ? { resolution: "rejected" } : {}),
          updatedAt: new Date(),
        })
        .where(where);
      return;
    }
    // Баримт ЗАСАГДСАН — санал нь хэвээрээ биш, засварлагдаж бичигдсэн.
    // ЗӨВХӨН `accepted`-оос шилжинэ (canTransition: accepted → modified);
    // `rejected` эцсийн, `no_action`-д баримт байхгүй.
    if (event.action === "update") {
      await executor
        .update(aiSuggestionOutcome)
        .set({ resolution: "modified", updatedAt: new Date() })
        .where(and(where, eq(aiSuggestionOutcome.resolution, "accepted")));
      return;
    }
    if (isPostingAuditAction(event.action)) {
      await executor
        .update(aiSuggestionOutcome)
        .set({ isPosted: true, updatedAt: new Date() })
        .where(where);
      return;
    }
    if (isUnpostingAuditAction(event.action)) {
      await executor
        .update(aiSuggestionOutcome)
        .set({ isPosted: false, updatedAt: new Date() })
        .where(where);
    }
  } catch (error) {
    warn("аудитын гүүр", error);
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── 4. Периодын хаалт — is_period_closed ────────────────────────────────────

/**
 * Тайлант үе хаагдах / дахин нээгдэхэд тухайн мужид багтах баримтуудын
 * `is_period_closed`-ыг шинэчилнэ (lib/actions/periods.ts транзакц дотроос).
 *
 * Баримтын огноогүй (linkedDocumentDate = null) мөр ХЭЗЭЭ Ч тэмдэглэгдэхгүй —
 * улмаар сургалтад ч орохгүй (болгоомжтой тал руу).
 *
 * ХЭЗЭЭ Ч шидэхгүй.
 */
export async function markPeriodTrainingFlags(
  scope: Pick<AiLogScope, "orgId">,
  range: { startDate: string; endDate: string; closed: boolean },
  executor: DbLike = db
): Promise<void> {
  try {
    await executor
      .update(aiSuggestionOutcome)
      .set({ isPeriodClosed: range.closed, updatedAt: new Date() })
      .where(
        and(
          eq(aiSuggestionOutcome.organizationId, scope.orgId),
          gte(aiSuggestionOutcome.linkedDocumentDate, range.startDate),
          lte(aiSuggestionOutcome.linkedDocumentDate, range.endDate)
        )
      );
  } catch (error) {
    warn("периодын тэмдэглэгээ", error);
  }
}

// ── 5. Унших — scope ЗААВАЛ ─────────────────────────────────────────────────

export type AiSuggestionRow = {
  suggestionId: string;
  createdAt: Date;
  source: string;
  toolName: string | null;
  modelName: string | null;
  sessionId: string | null;
  requestId: string | null;
  trainingScope: string;
  inputPayload: unknown;
  suggestedValue: unknown;
  resolution: AiResolution | null;
  finalValue: unknown;
  linkedDocumentType: AiLinkedDocumentType | null;
  linkedDocumentId: string | null;
  linkedDocumentDate: string | null;
  isPosted: boolean;
  isPeriodClosed: boolean;
  hasReversal: boolean;
  invalidatedReason: string | null;
};

const ROW_COLUMNS = {
  suggestionId: aiSuggestionLog.id,
  createdAt: aiSuggestionLog.createdAt,
  source: aiSuggestionLog.source,
  toolName: aiSuggestionLog.toolName,
  modelName: aiSuggestionLog.modelName,
  sessionId: aiSuggestionLog.sessionId,
  requestId: aiSuggestionLog.requestId,
  trainingScope: aiSuggestionLog.trainingScope,
  inputPayload: aiSuggestionLog.inputPayload,
  suggestedValue: aiSuggestionLog.suggestedValue,
  resolution: aiSuggestionOutcome.resolution,
  finalValue: aiSuggestionOutcome.finalValue,
  linkedDocumentType: aiSuggestionOutcome.linkedDocumentType,
  linkedDocumentId: aiSuggestionOutcome.linkedDocumentId,
  linkedDocumentDate: aiSuggestionOutcome.linkedDocumentDate,
  isPosted: aiSuggestionOutcome.isPosted,
  isPeriodClosed: aiSuggestionOutcome.isPeriodClosed,
  hasReversal: aiSuggestionOutcome.hasReversal,
  invalidatedReason: aiSuggestionOutcome.invalidatedReason,
};

function baseQuery(executor: DbLike, orgId: string) {
  return executor
    .select(ROW_COLUMNS)
    .from(aiSuggestionLog)
    .leftJoin(
      aiSuggestionOutcome,
      eq(aiSuggestionOutcome.suggestionId, aiSuggestionLog.id)
    )
    .where(eq(aiSuggestionLog.organizationId, orgId));
}

/** Саналын бүртгэлийн жагсаалт — ЗӨВХӨН өөрийн байгууллагынх. */
export async function listAiSuggestions(
  scope: Pick<AiLogScope, "orgId">,
  options: { limit?: number } = {},
  executor: DbLike = db
): Promise<AiSuggestionRow[]> {
  try {
    const rows = await baseQuery(executor, scope.orgId)
      .orderBy(desc(aiSuggestionLog.createdAt))
      .limit(Math.min(Math.max(options.limit ?? 100, 1), 1000));
    return rows as AiSuggestionRow[];
  } catch (error) {
    warn("жагсаалт", error);
    return [];
  }
}

/** Нэг баримтад холбогдсон үр дүнгүүд (polymorphic хайлт). */
export async function findOutcomesForDocument(
  scope: Pick<AiLogScope, "orgId">,
  documentType: AiLinkedDocumentType,
  documentId: string,
  executor: DbLike = db
): Promise<AiSuggestionRow[]> {
  try {
    if (!UUID_RE.test(documentId)) return [];
    const rows = await executor
      .select(ROW_COLUMNS)
      .from(aiSuggestionOutcome)
      .innerJoin(
        aiSuggestionLog,
        eq(aiSuggestionLog.id, aiSuggestionOutcome.suggestionId)
      )
      .where(
        and(
          eq(aiSuggestionOutcome.organizationId, scope.orgId),
          eq(aiSuggestionOutcome.linkedDocumentType, documentType),
          eq(aiSuggestionOutcome.linkedDocumentId, documentId)
        )
      );
    return rows as AiSuggestionRow[];
  } catch (error) {
    warn("баримтын хайлт", error);
    return [];
  }
}

export type TrainingRow = AiSuggestionRow & {
  /** Scope-ийн дагуу ЦЭВЭРЛЭГДСЭН payload-ууд. */
  redacted: {
    inputPayload: unknown;
    suggestedValue: unknown;
    finalValue: unknown;
  };
};

/**
 * СУРГАЛТЫН түүвэр — `is_posted && is_period_closed && !has_reversal`.
 *
 * `tenant_only`-оос ӨӨР scope хүсвэл payload-ууд ЗААВАЛ redact хийгдэнэ
 * (lib/ai-logging/redact.ts). Одоо ML хийхгүй — энэ нь зөвхөн уншигч.
 */
export async function listTrainingRows(
  scope: Pick<AiLogScope, "orgId">,
  options: {
    trainingScope?: AiTrainingScope;
    limit?: number;
  } = {},
  executor: DbLike = db
): Promise<TrainingRow[]> {
  try {
    const wanted = options.trainingScope ?? DEFAULT_TRAINING_SCOPE;
    const rows = (await baseQuery(executor, scope.orgId)
      .orderBy(desc(aiSuggestionLog.createdAt))
      .limit(Math.min(Math.max(options.limit ?? 500, 1), 5000))) as AiSuggestionRow[];

    return rows
      .filter(
        (row) =>
          row.trainingScope === wanted &&
          isTrainingEligible({
            isPosted: row.isPosted,
            isPeriodClosed: row.isPeriodClosed,
            hasReversal: row.hasReversal,
          })
      )
      .map((row) => ({
        ...row,
        redacted: {
          inputPayload: redactForScope(row.inputPayload, wanted),
          suggestedValue: redactForScope(row.suggestedValue, wanted),
          finalValue: redactForScope(row.finalValue, wanted),
        },
      }));
  } catch (error) {
    warn("сургалтын түүвэр", error);
    return [];
  }
}

/** Байгууллагын бүртгэлийн товч тоо (дебаг / ирээдүйн самбар). */
export async function aiSuggestionStats(
  scope: Pick<AiLogScope, "orgId">,
  executor: DbLike = db
): Promise<Record<AiResolution | "total" | "trainable", number>> {
  const empty = {
    total: 0,
    trainable: 0,
    accepted: 0,
    modified: 0,
    rejected: 0,
    no_action: 0,
  };
  try {
    const rows = await baseQuery(executor, scope.orgId).limit(5000);
    const out = { ...empty };
    for (const row of rows as AiSuggestionRow[]) {
      out.total += 1;
      const res = row.resolution ?? "no_action";
      if (isAiResolution(res)) out[res] += 1;
      if (
        isTrainingEligible({
          isPosted: row.isPosted,
          isPeriodClosed: row.isPeriodClosed,
          hasReversal: row.hasReversal,
        })
      )
        out.trainable += 1;
    }
    return out;
  } catch (error) {
    warn("статистик", error);
    return empty;
  }
}

/** `/api/health`-ийн `aiLog` блок — ПЛАТФОРМЫН нэгтгэл тоо. */
export type AiLoggingHealth = {
  total: number;
  last30Days: number;
  organizations: number;
  accepted: number;
  modified: number;
  rejected: number;
  posted: number;
  /** Сургалтад тэнцэх: батлагдсан + үе хаагдсан + буцаагдаагүй. */
  trainable: number;
  invalidated: number;
  lastAt: string | null;
};

/**
 * Deploy-ийн дараах хяналтад бүртгэл ХУРИМТЛАГДАЖ байгаа эсэхийг харуулна.
 * Scope-гүй цорын ганц функц — зөвхөн COUNT/MAX буцаана: байгууллагын ID,
 * payload, санал, баримтын холбоос ХЭЗЭЭ Ч гарахгүй (нэвтрэлтгүй health-д
 * ил тул). Тоолох шүүлтүүр `isTrainingEligible`-тэй ижил гурван нөхцөл.
 * Алдаа гарвал (хүснэгт хараахан үүсээгүй) null — health-ийг унагахгүй.
 */
export async function aiLoggingHealthStats(
  executor: Pick<typeof db, "select"> = db
): Promise<AiLoggingHealth | null> {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    const [row] = await executor
      .select({
        total: sql<number>`count(*)`,
        last30Days: sql<number>`count(*) filter (where ${aiSuggestionLog.createdAt} >= ${since}::timestamptz)`,
        organizations: sql<number>`count(distinct ${aiSuggestionLog.organizationId})`,
        accepted: sql<number>`count(*) filter (where ${aiSuggestionOutcome.resolution} = 'accepted')`,
        modified: sql<number>`count(*) filter (where ${aiSuggestionOutcome.resolution} = 'modified')`,
        rejected: sql<number>`count(*) filter (where ${aiSuggestionOutcome.resolution} = 'rejected')`,
        posted: sql<number>`count(*) filter (where ${aiSuggestionOutcome.isPosted})`,
        trainable: sql<number>`count(*) filter (where ${aiSuggestionOutcome.isPosted} and ${aiSuggestionOutcome.isPeriodClosed} and not ${aiSuggestionOutcome.hasReversal})`,
        invalidated: sql<number>`count(*) filter (where ${aiSuggestionOutcome.hasReversal})`,
        lastAt: sql<string | null>`max(${aiSuggestionLog.createdAt})`,
      })
      .from(aiSuggestionLog)
      .leftJoin(
        aiSuggestionOutcome,
        eq(aiSuggestionOutcome.suggestionId, aiSuggestionLog.id)
      );
    if (!row) return null;
    return {
      total: Number(row.total ?? 0),
      last30Days: Number(row.last30Days ?? 0),
      organizations: Number(row.organizations ?? 0),
      accepted: Number(row.accepted ?? 0),
      modified: Number(row.modified ?? 0),
      rejected: Number(row.rejected ?? 0),
      posted: Number(row.posted ?? 0),
      trainable: Number(row.trainable ?? 0),
      invalidated: Number(row.invalidated ?? 0),
      lastAt: row.lastAt ? new Date(row.lastAt).toISOString() : null,
    };
  } catch (error) {
    warn("health тоолуур", error);
    return null;
  }
}

/** Тестийн цэвэрлэгээнд — ЗӨВХӨН өөрийн байгууллагын мөрүүдийг устгана. */
export async function deleteAiSuggestions(
  scope: Pick<AiLogScope, "orgId">,
  suggestionIds: string[],
  executor: DbLike = db
): Promise<void> {
  if (suggestionIds.length === 0) return;
  try {
    await (executor as typeof db)
      .delete(aiSuggestionLog)
      .where(
        and(
          eq(aiSuggestionLog.organizationId, scope.orgId),
          inArray(aiSuggestionLog.id, suggestionIds)
        )
      );
  } catch (error) {
    warn("устгалт", error);
  }
}

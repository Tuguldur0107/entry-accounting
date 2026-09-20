// AI санал → үр дүнгийн бүртгэлийн ЛИТЕРАЛУУД — ЦОРЫН ГАНЦ эх сурвалж.
//
// ЦЭВЭР модуль: `@/lib/db` импорт ХИЙХГҮЙ (CLAUDE.md client/server хил) —
// төрөл, шошгыг client component ч уншиж болно.
//
// pgEnum ХЭРЭГЛЭХГҮЙ (энэ repo-д 0 удаа): enum бүр `text()` багана + энд
// байх TS union. Шинэ утга нэмэх нь migration ШААРДАХГҮЙ.

/** Санал хаанаас орж ирсэн бэ. */
export const AI_SUGGESTION_SOURCES = [
  /** Гадны MCP клиент (Claude Code / Cowork) — lib/mcp/server.ts */
  "mcp",
  /** Апп доторх agent / автомат урсгал — lib/actions/*, демо */
  "internal_agent",
  /** Хэрэглэгчийн чат дэлгэц — app/api/ai/chat/route.ts */
  "ui_assist",
  /** Гадаад интеграцийн REST API v1 — lib/api/v1.ts */
  "rest_api",
] as const;
export type AiSuggestionSource = (typeof AI_SUGGESTION_SOURCES)[number];

export const AI_SUGGESTION_SOURCE_LABELS: Record<AiSuggestionSource, string> = {
  mcp: "MCP клиент",
  internal_agent: "Дотоод agent",
  ui_assist: "Чат туслах",
  rest_api: "REST API",
};

export function isAiSuggestionSource(v: unknown): v is AiSuggestionSource {
  return AI_SUGGESTION_SOURCES.includes(v as AiSuggestionSource);
}

/** Хүн юу хийсэн бэ. */
export const AI_RESOLUTIONS = [
  /** Саналыг хэвээр нь хүлээн авсан. */
  "accepted",
  /** Хүлээн авсан ч засварласан. */
  "modified",
  /** Татгалзсан — баримт үүсээгүй эсвэл устгасан. */
  "rejected",
  /** Хараахан шийдээгүй (анхны төлөв). */
  "no_action",
] as const;
export type AiResolution = (typeof AI_RESOLUTIONS)[number];

export const AI_RESOLUTION_LABELS: Record<AiResolution, string> = {
  accepted: "Хүлээн авсан",
  modified: "Засварласан",
  rejected: "Татгалзсан",
  no_action: "Шийдээгүй",
};

export function isAiResolution(v: unknown): v is AiResolution {
  return AI_RESOLUTIONS.includes(v as AiResolution);
}

/** Өгөгдөл хаана хүртэл сургалтад ашиглагдаж болох вэ. */
export const AI_TRAINING_SCOPES = [
  /** Зөвхөн ӨӨРИЙН байгууллагын загварт (DEFAULT). */
  "tenant_only",
  /** Салбарын нэгдсэн загварт — ЗААВАЛ redact хийгдсэн байна. */
  "industry",
  /** Платформ даяарх загварт — ЗААВАЛ redact хийгдсэн байна. */
  "global",
] as const;
export type AiTrainingScope = (typeof AI_TRAINING_SCOPES)[number];

export const DEFAULT_TRAINING_SCOPE: AiTrainingScope = "tenant_only";

export const AI_TRAINING_SCOPE_LABELS: Record<AiTrainingScope, string> = {
  tenant_only: "Зөвхөн энэ байгууллага",
  industry: "Салбарын загвар",
  global: "Платформын загвар",
};

export function isAiTrainingScope(v: unknown): v is AiTrainingScope {
  return AI_TRAINING_SCOPES.includes(v as AiTrainingScope);
}

/**
 * Polymorphic linked_document-ийн үгсийн сан — AiAction.kind ба аудитын
 * entityType-тай ЯГ ИЖИЛ (шинэ үгсийн сан үүсгэхгүй). FK байхгүй тул
 * энэ жагсаалт нь цорын ганц гэрээ.
 */
export const AI_LINKED_DOCUMENT_TYPES = [
  "journal",
  "arap",
  "cash",
  "inventory",
  "fa",
  "purchase_order",
  "goods_receipt",
  "pos_sale",
] as const;
export type AiLinkedDocumentType = (typeof AI_LINKED_DOCUMENT_TYPES)[number];

export function isAiLinkedDocumentType(v: unknown): v is AiLinkedDocumentType {
  return AI_LINKED_DOCUMENT_TYPES.includes(v as AiLinkedDocumentType);
}

/**
 * АУДИТЫН үйлдэл → бичилт БАТЛАГДСАН гэсэн дохио (lib/audit.ts гүүр).
 * Эдгээрийг хөөснөөр 20 гаруй post замыг тус тусад нь дэгээдэх шаардлагагүй.
 */
export const POSTING_AUDIT_ACTIONS = [
  "post",
  "create_posted",
  "confirm",
  "fx_post",
  "approve",
] as const;

/** Батлалтыг БУЦААСАН дохио — is_posted дахин false болно. */
export const UNPOSTING_AUDIT_ACTIONS = ["unpost"] as const;

/**
 * Баримтыг ХҮЧИНГҮЙ болгосон дохио → has_reversal = true.
 *
 * Энэ codebase-д буцаалт нь НЭГ хүснэгтэд биш, эх баримтын мөрийн
 * `status` талбарт илэрхийлэгддэг ("reversed" / "returned" / "cancelled")
 * бөгөөд зам бүр logAuditEvent-ээр дамждаг — тиймээс аудитын гүүр нь
 * 8 хүснэгтийн LEFT JOIN-оос хамаагүй тогтвортой (docs/ai-logging.md §6).
 */
export const INVALIDATING_AUDIT_ACTIONS = [
  "reverse",
  "fx_reverse",
  "delete",
  "return",
  "cancel",
  "dispose",
] as const;
export type InvalidatingAuditAction =
  (typeof INVALIDATING_AUDIT_ACTIONS)[number];

/** Эх баримтын status нь «хүчингүй» гэж уншигдах утгууд (хаалтын backstop). */
export const INVALIDATED_DOCUMENT_STATUSES = [
  "reversed",
  "returned",
  "partially_returned",
  "voided",
  "cancelled",
] as const;

export function isPostingAuditAction(action: string): boolean {
  return (POSTING_AUDIT_ACTIONS as readonly string[]).includes(action);
}

export function isUnpostingAuditAction(action: string): boolean {
  return (UNPOSTING_AUDIT_ACTIONS as readonly string[]).includes(action);
}

export function isInvalidatingAuditAction(
  action: string
): action is InvalidatingAuditAction {
  return (INVALIDATING_AUDIT_ACTIONS as readonly string[]).includes(action);
}

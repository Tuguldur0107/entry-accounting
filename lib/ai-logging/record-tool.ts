// `executeAiTool` → AI бүртгэлийн гүүр.
//
// ЯАГААД ЭНД: MCP · REST v1 · чат (Anthropic ба OpenAI) · демо · eBarimt→АР
// БҮГД `executeAiTool`-оор л дамждаг (lib/ai/tools.ts:9777). Тиймээс
// бүртгэлийн НЭГ цэг нь яг тэнд — эх сурвалж нэмэхэд энэ файл өөрчлөгдөхгүй.

import type { AiAction } from "@/lib/ai/action-markers";

import { isAiLinkedDocumentType } from "./constants";
import { logAiSuggestion, resolveAiSuggestion, type AiLogScope } from "./service";

/** AiAction.kind → polymorphic linked_document_type (аудитын entityType). */
const ACTION_ENTITY: Record<AiAction["kind"], string> = {
  voucher: "journal",
  arap: "arap",
  cash: "cash",
  inventory: "inventory",
  fa: "fa",
  purchase_order: "purchase_order",
  goods_receipt: "goods_receipt",
  pos_sale: "pos_sale",
};

/** Аль хэдийн батлагдсан төлөвүүд (ноорог биш). */
const POSTED_STATUSES = new Set([
  "posted",
  "confirmed",
  "active",
  "open",
  "closed",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Tool-ийн оролтоос баримтын огноог олж авна — байхгүй бол null. */
function documentDateOf(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  for (const key of ["date", "documentDate", "invoiceDate", "receiptDate"]) {
    const value = record[key];
    if (typeof value === "string" && ISO_DATE.test(value)) return value;
  }
  return null;
}

export type RecordAiToolInput = {
  toolName: string;
  /** Модель tool-д өгсөн аргумент = AI-ийн САНАЛ. */
  args: unknown;
  mode: string;
  /** Үүссэн объект (байвал). */
  action?: AiAction;
  /** externalRef-ээр давхардсан — ШИНЭ баримт үүсээгүй. */
  dedup?: boolean;
  latencyMs?: number;
};

/**
 * Нэг tool дуудлагыг бүртгэнэ. ХЭЗЭЭ Ч шидэхгүй.
 *
 * ЗӨВХӨН БИЧИЛТ үүсгэсэн дуудлага бүртгэгдэнэ (`action` байгаа, `dedup`
 * биш). Шалтгаан:
 *  • `list_*` / тайлангийн уншилт нь шошготой өгөгдөл ҮҮСГЭДЭГГҮЙ —
 *    бүртгэвэл эзлэхүүн олон дахин өснө, сургалтын үнэ цэн 0
 *  • `dedup` нь ШИНЭ баримт үүсгээгүй тул шинэ шошго ч үүсэхгүй
 *
 * Анхны resolution = `accepted`: санал нь БОДИТ баримт болсон. Цаашид
 * аудитын гүүр (lib/audit.ts) үүнийг залруулна:
 *   баримт засагдвал → `modified` · устгагдвал → `rejected` + has_reversal
 *   батлагдвал → is_posted · буцаагдвал → has_reversal
 */
export async function recordAiToolCall(
  scope: AiLogScope,
  input: RecordAiToolInput
): Promise<void> {
  const action = input.action;
  if (!action || input.dedup) return;

  const entityType = ACTION_ENTITY[action.kind];
  if (!entityType || !isAiLinkedDocumentType(entityType)) return;

  const suggestionId = await logAiSuggestion(scope, {
    toolName: input.toolName,
    inputPayload: { tool: input.toolName, mode: input.mode },
    suggestedValue: input.args ?? null,
    latencyMs: input.latencyMs,
  });
  if (!suggestionId) return;

  await resolveAiSuggestion(scope, suggestionId, {
    resolution: "accepted",
    finalValue: {
      kind: action.kind,
      status: action.status,
      title: action.title,
    },
    linkedDocumentType: entityType,
    linkedDocumentId: action.id,
    linkedDocumentDate: documentDateOf(input.args),
    isPosted: POSTED_STATUSES.has(action.status),
  });
}

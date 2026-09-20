// AI бүртгэлийн ХҮСЭЛТИЙН контекст — AsyncLocalStorage.
//
// ЯАГААД ALS: `executeAiTool(userId, name, input, mode)` нь 6 газраас
// дуудагддаг (чат ×2, MCP, REST, демо, eBarimt→АР). Гарын үсгийг нь
// өөрчилбөл 6 call site + тест бүгд эвдэрнэ. Оронд нь орц бүр өөрийн
// контекстоо ALS-д тавина — `executeAiTool` өөрчлөгдөхгүй, backward
// compatible. Хэв маяг нь lib/ai/post-limit.ts-тэй ИЖИЛ.
//
// Контекст БАЙХГҮЙ үед `internal_agent` гэж бүртгэгдэнэ (хамгийн
// болгоомжтой default) — бүртгэл алдагдахгүй.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import {
  DEFAULT_TRAINING_SCOPE,
  type AiSuggestionSource,
  type AiTrainingScope,
} from "./constants";

export type AiLogContext = {
  source: AiSuggestionSource;
  /** Нэг харилцан яриа (чатын thread id, MCP session) — бүлэглэх түлхүүр. */
  sessionId?: string | null;
  /** Нэг модель-ээлж — олон tool дуудлагыг бүлэглэнэ. */
  requestId?: string | null;
  modelName?: string | null;
  modelVersion?: string | null;
  /**
   * Хүссэн training scope. ОРХИГДВОЛ `tenant_only`. Энэ утгыг өгөх нь
   * scope-ыг БАТАЛГААЖУУЛАХГҮЙ — planTrainingScope дахин шалгана.
   */
  trainingScope?: AiTrainingScope;
};

const storage = new AsyncLocalStorage<AiLogContext>();

/** fn доторх бүх AI tool дуудлага энэ контекстоор бүртгэгдэнэ. */
export function runWithAiLogContext<T>(
  ctx: AiLogContext,
  fn: () => Promise<T>
): Promise<T> {
  // requestId өгөгдөөгүй бол энэ ээлжинд НЭГ-ийг үүсгэнэ — нэг хүсэлтийн
  // олон tool дуудлага бүлэглэгдэнэ.
  return storage.run({ requestId: randomUUID(), ...ctx }, fn);
}

/** Одоогийн контекст — байхгүй бол болгоомжтой default. */
export function currentAiLogContext(): AiLogContext {
  return (
    storage.getStore() ?? {
      source: "internal_agent",
      trainingScope: DEFAULT_TRAINING_SCOPE,
    }
  );
}

/** Контекст идэвхтэй эсэх (тест / дебаг). */
export function hasAiLogContext(): boolean {
  return storage.getStore() !== undefined;
}

// AI/MCP/REST-ийн ШУУД БАТЛАХ дээд хязгаар — байгууллагаар тохируулагддаг.
//
// §9 human-in-the-loop: "Шууд бичих" горимд ч энэ дүнгээс их бичилт НООРОГ
// үлдэж, нягтланч вэб дээрээсээ батална. Хязгаар нь
// `company_settings.ai_post_limit_mnt`-д хадгалагдана; null = 10 сая ₮ default.
//
// АЮУЛГҮЙ БАЙДАЛ: хамгаалагдаж буй агент ӨӨРИЙН хязгаарыг ӨСГӨЖ ЧАДАХГҮЙ
// (SIM ENT-068: симуляцид AI PO хаах гацааг тойрохын тулд лимитээ 50 сая
// болгож өсгөсөн; баримтанд суулгасан «зааварчилгаа» (prompt injection)
// агентаар лимитээ өсгүүлээд том дүн батлуулах зам ч болно). TOOL-оор
// (AI/MCP/REST) зөвхөн БУУРУУЛНА — өсгөлт `[HUMAN_REQUIRED]`, вэбийн
// Тохиргоо → Компанийн мэдээлэл хуудсаас админ хүн л тавина.

import { AsyncLocalStorage } from "node:async_hooks";

/** Тохируулаагүй байгууллагын хязгаар (§9). */
export const DEFAULT_AI_POST_LIMIT_MNT = 10_000_000;


/** Хадгалагдсан утга (numeric → string) → бодит хязгаар. Гажиг/хоосон бол default. */
export function resolveAiPostLimit(stored: string | number | null | undefined): number {
  const value = stored == null ? NaN : Number(stored);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_AI_POST_LIMIT_MNT;
}

export type AiPostLimitPlan =
  | {
      ok: true;
      /** DB-д бичих утга — null = default рүү буцаана. */
      valueMnt: number | null;
      /** Хадгалсны дараа хүчин төгөлдөр болох хязгаар. */
      effectiveMnt: number;
      direction: "raise" | "lower" | "same";
    }
  | { ok: false; code: string; message: string };

/**
 * Хязгаарын өөрчлөлтийг шалгана — ЦЭВЭР (DB-гүй, тесттэй).
 * `viaTool` нь AI/MCP/REST-ээс ирсэн эсэх: тэр замд ӨСГӨЛТ таазтай.
 */
export function planAiPostLimitChange(args: {
  currentMnt: number;
  /** null = default рүү буцаах. */
  requestedMnt: number | null;
  viaTool: boolean;
}): AiPostLimitPlan {
  const { currentMnt, requestedMnt, viaTool } = args;
  if (requestedMnt !== null && (!Number.isFinite(requestedMnt) || requestedMnt <= 0))
    return {
      ok: false,
      code: "INVALID_LIMIT",
      message: "Шууд батлах хязгаар 0-ээс их тоо байна (хоосон = 10 сая ₮ default)",
    };

  const effectiveMnt = requestedMnt === null ? DEFAULT_AI_POST_LIMIT_MNT : requestedMnt;
  const direction =
    effectiveMnt > currentMnt ? "raise" : effectiveMnt < currentMnt ? "lower" : "same";

  if (viaTool && direction === "raise")
    return {
      ok: false,
      code: "HUMAN_REQUIRED",
      message:
        `AI/MCP шууд батлах хязгаараа ӨСГӨЖ чадахгүй (одоо ${currentMnt.toLocaleString("en-US")}₮ → ` +
        `${effectiveMnt.toLocaleString("en-US")}₮) — Тохиргоо → Компанийн мэдээлэл хуудсаас админ ` +
        "хүн өөрөө тавина. Хязгаараас их бичилт ноорог үлдэж вэбээс батлагдана",
    };

  return { ok: true, valueMnt: requestedMnt, effectiveMnt, direction };
}

// ── Хүсэлтийн хүрээн дэх идэвхтэй хязгаар ───────────────────────────────────
// executeAiTool нэг л удаа уншаад энд тавина — гүн дэх assertPostLimit нь
// sync хэвээр (22 дуудах цэгийг async болгохгүй), зэрэгцээ хүсэлтүүд
// бие биенийхээ утгыг харахгүй (AsyncLocalStorage).

const limitStore = new AsyncLocalStorage<number>();

export function runWithAiPostLimit<T>(limitMnt: number, fn: () => Promise<T>): Promise<T> {
  return limitStore.run(limitMnt, fn);
}

/** Идэвхтэй хязгаар — контекстгүй дуудагдвал default (хамгийн болгоомжтой). */
export function currentAiPostLimit(): number {
  return limitStore.getStore() ?? DEFAULT_AI_POST_LIMIT_MNT;
}

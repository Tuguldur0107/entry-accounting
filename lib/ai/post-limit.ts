// AI/MCP/REST-ийн ШУУД БАТЛАХ дээд хязгаар — байгууллагаар тохируулагддаг.
//
// §9 human-in-the-loop: "Шууд бичих" горимд ч энэ дүнгээс их бичилт НООРОГ
// үлдэж, нягтланч вэб дээрээсээ батална. Хязгаар нь
// `company_settings.ai_post_limit_mnt`-д хадгалагдана; null = 10 сая ₮ default.
//
// АЮУЛГҮЙ БАЙДАЛ: агент өөрийн таазыг хязгааргүй өргөхийг хориглоно —
// баримтанд суулгасан «зааварчилгаа» (prompt injection) агентаар лимитээ
// өсгүүлээд дараа нь том дүн батлуулах зам байж болно. Тиймээс TOOL-оор
// өсгөх нь AI_POST_LIMIT_TOOL_CEILING_MNT-ээр тагласан; түүнээс дээш зөвхөн
// вэбийн Тохиргоо → Компанийн мэдээлэл хуудсаар (админ хүн) тавигдана.
// Бууруулахад тааз хамаарахгүй (болгоомжтой тал руу үргэлж чөлөөтэй).

import { AsyncLocalStorage } from "node:async_hooks";

/** Тохируулаагүй байгууллагын хязгаар (§9). */
export const DEFAULT_AI_POST_LIMIT_MNT = 10_000_000;

/** Tool-оор ӨСГӨХ дээд тааз — түүнээс дээш зөвхөн вэбээс (хүн). */
export const AI_POST_LIMIT_TOOL_CEILING_MNT = 1_000_000_000;

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

  if (viaTool && direction === "raise" && effectiveMnt > AI_POST_LIMIT_TOOL_CEILING_MNT)
    return {
      ok: false,
      code: "LIMIT_CEILING_EXCEEDED",
      message:
        `${effectiveMnt.toLocaleString("en-US")}₮ нь tool-оор өсгөх таазнаас ` +
        `(${AI_POST_LIMIT_TOOL_CEILING_MNT.toLocaleString("en-US")}₮) их — ` +
        "үүнээс дээш хязгаарыг Тохиргоо → Компанийн мэдээлэл хуудсаас админ өөрөө тавина",
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

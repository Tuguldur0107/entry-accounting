// ТЕГ-ийн нийтийн лавлах (РД → ТТД + нэр) — БРАУЗЕРААС ЭХЛЭЭД.
//
// `api.ebarimt.mn` ЗӨВХӨН Монголын IP-ээс хариулдаг. Entry-ийн сервер (Railway)
// гадаадад тул серверийн лавлах `EBARIMT_PUBLIC_API_BASE` прокси тохируулаагүй
// бол timeout болдог (docs/deployment/ebarimt.md §4a). Харин кассчин / нягтлан
// Монголд сууж байгаа тул тэдний БРАУЗЕР лавлахад шууд хүрнэ — эхлээд тэндээс,
// сүлжээний (CORS, гео, timeout) алдаа гарвал серверийн action руу буцна.
// Лавлах «олдсонгүй» гэж ХАРИУЛСАН бол серверээр дахин асуухгүй — тэр нь
// хариулт; серверийн timeout-ын алдаа түүнийг дарах ёсгүй.
//
// ТТД ЗОХИОХГҮЙ: хоёр зам хоёулаа ТЕГ-ийн хариуг л буцаана (lookup.ts).
// Иргэний РД-аар лавлахгүй дүрэм lookupTinByRegNo дотор (ХХМХ 4.1.11).

import { EBARIMT_ERRORS } from "./constants";
import { EbarimtError } from "./receipt";
import { lookupTinByRegNo, type TinInfo } from "./lookup";

/**
 * Браузерын лавлахын алдаа серверээр дахин оролдох шалтгаан мөн эсэх — ЦЭВЭР
 * (tests/ebarimt-browser-lookup.test.ts). Сүлжээ / CORS / timeout / хариу
 * уншигдаагүй → true; ТЕГ «олдсонгүй», буруу оролт (settings код) → false.
 */
export function shouldFallbackToServer(error: unknown): boolean {
  if (error instanceof EbarimtError) return error.code !== EBARIMT_ERRORS.settings;
  return true;
}

export type TinLookupResult = { info?: TinInfo; error?: string };

/**
 * Браузерт: эхлээд ТЕГ-ээс шууд, сүлжээний алдаанд `server` (server action) руу.
 * Сервер талд (window байхгүй) шууд `server`.
 */
export async function lookupTinPreferBrowser(
  regNoOrTin: string,
  server: (value: string) => Promise<TinLookupResult>
): Promise<TinLookupResult> {
  if (typeof window !== "undefined") {
    try {
      return { info: await lookupTinByRegNo(regNoOrTin) };
    } catch (error) {
      if (!shouldFallbackToServer(error))
        return { error: error instanceof Error ? error.message.replace(/^\[[A-Z_]+\]\s*/, "") : String(error) };
    }
  }
  return server(regNoOrTin);
}

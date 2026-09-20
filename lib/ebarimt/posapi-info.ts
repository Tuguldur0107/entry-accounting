// `GET /rest/info`-ийн хариуг уншигдахуйц болгоно — ЦЭВЭР (DB-гүй, тесттэй).
// Албан спек §6 (POS API 3.0, ГТСМТТ УҮГ): operatorName, operatorTIN, posId,
// posNo, lastSentDate, leftLotteries (баримтад «leftLoteries» гэж ч бичигдсэн —
// хоёуланг нь уншина), merchants[{name, tin, customers[]}].
//
// Юунд хэрэгтэй: ТЕГ-ийн тестийн шалгах жагсаалт «сугалааны дугаар дуусаж буй
// болон борлуулалтын мэдээлэл илгээх 3 өдрийн хугацаа дуусаж буйг анхааруулах»
// гэж шаарддаг — эх нь ЭНЭ хариу (lib/notifications/attention.ts дүрэм).

import type { PosApiHealth, PosApiInfo } from "./types";

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function integer(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function parsePosApiInfo(body: PosApiInfo): PosApiHealth {
  const merchantsRaw = Array.isArray(body.merchants) ? body.merchants : [];
  const merchants = merchantsRaw
    .map((entry) => {
      const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      return { name: text(row.name) ?? "", tin: text(row.tin) ?? "" };
    })
    .filter((merchant) => merchant.tin.length > 0);
  return {
    operatorName: text(body.operatorName),
    operatorTin: text(body.operatorTIN ?? body.operatorTin),
    posNo: text(body.posNo),
    lastSentDate: text(body.lastSentDate),
    leftLotteries: integer(body.leftLotteries ?? body.leftLoteries),
    merchants,
  };
}

/** Мерчантын ТТД энэ PosAPI-д бүртгэлтэй юу (операторын хүсэлтийг батласан). */
export function isMerchantRegistered(info: PosApiHealth, merchantTin: string): boolean | null {
  if (info.merchants.length === 0) return null; // PosAPI жагсаалт өгөөгүй — мэдэхгүй
  const tin = merchantTin.trim();
  return info.merchants.some((merchant) => merchant.tin === tin);
}

/**
 * "yyyy-MM-dd HH:mm:ss" (PosAPI-ийн цаг, Улаанбаатар) → тухайн мөчөөс хойш
 * өнгөрсөн ЦАГ; огноо уншигдахгүй бол null. `now` мөн УБ-ын ISO ("YYYY-MM-DDTHH:mm").
 */
export function hoursSince(lastSentDate: string | null, nowUlaanbaatar: string): number | null {
  if (!lastSentDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(lastSentDate.trim());
  if (!match) return null;
  const then = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
  const nowMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(nowUlaanbaatar);
  if (!nowMatch) return null;
  const now = Date.UTC(+nowMatch[1], +nowMatch[2] - 1, +nowMatch[3], +(nowMatch[4] ?? 0), +(nowMatch[5] ?? 0));
  return Math.max(0, (now - then) / 3_600_000);
}

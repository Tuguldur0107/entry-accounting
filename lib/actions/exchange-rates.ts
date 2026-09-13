"use server";

// Монголбанкны ханшийн ТҮҮХ — татаж ХАДГАЛАХ, уншиж харуулах, тухайн
// огнооны ханшийг олох server action-ууд.
//
// Яагаад: хэрэглэгч эхний үлдэгдэл / өмнөх хугацааны бичилт оруулахад
// ӨМНӨХ ҮЕИЙН ханш хэрэгтэй болдог. Тиймээс түүхээ нэг удаа татаж
// хадгалаад (`syncMongolbankRates`), дараа нь тэгшитгэлийн огноо сонгох
// бүрд хадгалснаасаа уншина (`getStoredRateForDate`) — Монголбанкийг
// давтан цохихгүй, офлайн ч ажиллана.
//
// `exchange_rates` нь НИЙТИЙН лавлах хүснэгт (`organizationId` БАЙХГҮЙ —
// ханш нь нийтийн баримт). Гэхдээ дуудлага бүрд эрхийн шалгалт хэвээр:
// ханш татах/унших нь мөнгөн хөрөнгийн ажил тул модулийн түлхүүр `cash`.
//
// ХАНШ ХЭЗЭЭ Ч ЗОХИОГДОХГҮЙ (CLAUDE.md §10): олдохгүй бол { error }
// буцаана — хэрэглэгч гараар оруулна.
//
// Хэв маяг: Core (шиднэ) + wrapper (ActionResult, actionError).

import { revalidatePath } from "next/cache";

import { actionError, type ActionResult } from "@/lib/action-result";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction } from "@/lib/auth";
import {
  ISO_DATE_RE,
  fetchMongolbankHistory,
} from "@/lib/cash/exchange-rates";
import { getOfficialRateForDate } from "@/lib/cash/official-rate";
// rate-store-ыг импортлох нь ханшийн агуулахыг `getOfficialRateForDate`-д
// БҮРТГЭНЭ (lib/cash/exchange-rates.ts дотоод тайлбар) — тиймээс энэ файлаар
// дайрсан хайлт бүр STORE-FIRST явна.
import {
  loadStoredRates,
  saveExchangeRates,
  storedRateCoverage,
  type StoredRateRow,
} from "@/lib/cash/rate-store";

/** Хадгалагдсан түүхийн хамрах хүрээ — UI-д "юу татагдсан бэ" харуулна. */
export type StoredRateCoverage = {
  rows: number;
  minDate: string | null;
  maxDate: string | null;
  currencies: number;
};

const CURRENCY_RE = /^[A-Z]{3}$/;
const KNOWN_SOURCES = ["mongolbank", "tdb", "golomt"];

/** Монголбанкны вэб дээрх түүхийн эхлэл — үүнээс өмнөх муж хоосон ирдэг. */
const MONGOLBANK_MIN_DATE = "2015-01-01";
/** Нэг sync-д татах дээд хугацаа (5 жил, өндөр жилтэй). */
const MAX_SYNC_DAYS = 5 * 366;
/** Түүхийн жагсаалтын өгөгдмөл мөрийн хязгаар (≈ 100 хоног × 50 валют). */
const DEFAULT_HISTORY_LIMIT = 5_000;

// ─── Цэвэр туслахууд (энэ файлаас export ХИЙХГҮЙ — "use server") ─────────────

function isoDate(value: unknown): string | null {
  const text = String(value ?? "")
    .trim()
    .slice(0, 10);
  return ISO_DATE_RE.test(text) ? text : null;
}

/** Улаанбаатарын өнөөдөр (YYYY-MM-DD) — ирээдүйн огноо таслахад. */
function todayInUlaanbaatar(): string {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Ulaanbaatar",
  });
}

/** [from, to] мужийн хоногийн тоо (хоёр талдаа хаалттай). */
function dayCount(from: string, to: string): number {
  const span =
    Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(span / 86_400_000) + 1;
}

function requireRange(from: unknown, to: unknown) {
  const start = isoDate(from);
  const end = isoDate(to);
  if (!start || !end)
    throw new Error("Огноо YYYY-MM-DD хэлбэртэй байх ёстой");
  if (start > end)
    throw new Error("Эхлэх огноо дуусах огнооноос хойш байж болохгүй");
  return { from: start, to: end };
}

function requireCurrency(value: unknown): string {
  const code = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!CURRENCY_RE.test(code))
    throw new Error(
      `Валютын код буруу байна: "${String(value ?? "")}" (жишээ нь USD)`
    );
  return code;
}

function requireSource(value: unknown): string | undefined {
  const source = String(value ?? "").trim();
  if (!source) return undefined;
  if (!KNOWN_SOURCES.includes(source))
    throw new Error(
      `Ханшийн эх сурвалж буруу байна: "${source}" (${KNOWN_SOURCES.join(", ")})`
    );
  return source;
}

// ─── 1. Түүх татаж хадгалах ──────────────────────────────────────────────────

async function syncMongolbankRatesCore(input: {
  from: string;
  to: string;
  currencies?: string[];
}): Promise<{ saved: number; from: string; to: string; days: number }> {
  const { orgId, userId } = await requireModuleAction("cash", "write");
  const { from, to } = requireRange(input?.from, input?.to);

  const today = todayInUlaanbaatar();
  if (to > today)
    throw new Error(
      `Ирээдүйн ханш байхгүй — дуусах огноо ${today}-наас хэтрэхгүй байна`
    );
  if (from < MONGOLBANK_MIN_DATE)
    throw new Error(
      `Монголбанкны түүхэн ханш ${MONGOLBANK_MIN_DATE}-ээс хойш байдаг — эхлэх огноогоо шалгана уу`
    );

  const days = dayCount(from, to);
  if (days > MAX_SYNC_DAYS)
    throw new Error(
      `Нэг удаад дээд тал нь 5 жилийн муж татна (одоо ${days} хоног) — хэсэгчлэн татна уу`
    );

  // Валют заасан бол зөвхөн тэдгээр (MNT нь суурь валют тул хасна);
  // заагаагүй бол Монголбанкны нийтэлсэн БҮХ валют татагдана.
  const currencies = input?.currencies?.length
    ? [...new Set(input.currencies.map(requireCurrency))].filter(
        (code) => code !== "MNT"
      )
    : undefined;
  if (currencies && currencies.length === 0)
    throw new Error(
      "MNT нь суурь валют (ханш = 1) — татах валютаа (USD, EUR ...) заана уу"
    );

  const quotes = await fetchMongolbankHistory(from, to, currencies);
  if (quotes.length === 0)
    throw new Error(
      `Монголбанкнаас ${from} — ${to} мужид ханш олдсонгүй — огноо/валютаа шалгаад дахин оролдоно уу`
    );

  const saved = await saveExchangeRates(quotes, userId);

  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "sync",
    entityType: "exchange_rate",
    entityId: `mongolbank:${from}:${to}`,
    summary: `Монголбанкны ханшийн түүх ${from} — ${to} (${days} хоног${
      currencies ? `, ${currencies.join(", ")}` : ", бүх валют"
    }): ${saved} мөр хадгалагдав`,
  });

  // Кэш цэвэрлэлт нь АМЖИЛТТАЙ татацыг унагахгүй: request scope-гүй дуудагч
  // (cron, script, тест) дээр `revalidatePath` invariant шидэж, хадгалагдсан
  // мөрүүд байсаар байтал { error } буцах эрсдэлтэй.
  try {
    revalidatePath("/cash/rates");
  } catch (caught) {
    console.error("syncMongolbankRates revalidatePath:", caught);
  }

  return { saved, from, to, days };
}

/**
 * Монголбанкны түүхэн албан ханшийг [from, to] мужаар татаж хадгална.
 * Давхардсан огноо/валют нь дарагдана (upsert) тул дахин дуудахад аюулгүй.
 */
export async function syncMongolbankRates(input: {
  from: string;
  to: string;
  currencies?: string[];
}): Promise<
  ActionResult<{ saved: number; from: string; to: string; days: number }>
> {
  try {
    return await syncMongolbankRatesCore(input);
  } catch (caught) {
    return actionError(
      "syncMongolbankRates",
      caught,
      "Монголбанкны ханшийн түүх татагдсангүй"
    );
  }
}

// ─── 2. Хадгалагдсан түүхийг унших ───────────────────────────────────────────

async function loadExchangeRateHistoryCore(input: {
  from: string;
  to: string;
  currency?: string;
  source?: string;
  limit?: number;
}): Promise<{ rows: StoredRateRow[]; coverage: StoredRateCoverage }> {
  await requireModuleAction("cash", "read");
  const { from, to } = requireRange(input?.from, input?.to);
  const currency = String(input?.currency ?? "").trim()
    ? requireCurrency(input?.currency)
    : undefined;
  const source = requireSource(input?.source);

  const [rows, coverage] = await Promise.all([
    loadStoredRates({
      from,
      to,
      currency,
      source,
      limit: input?.limit ?? DEFAULT_HISTORY_LIMIT,
    }),
    storedRateCoverage(source),
  ]);
  return { rows, coverage };
}

/**
 * Хадгалагдсан ханшийн жагсаалт (шинэ огноо эхэндээ) + хамрах хүрээ.
 * Сүлжээ хөндөхгүй — зөвхөн хадгалсныг харуулна.
 */
export async function loadExchangeRateHistory(input: {
  from: string;
  to: string;
  currency?: string;
  source?: string;
  limit?: number;
}): Promise<
  ActionResult<{ rows: StoredRateRow[]; coverage: StoredRateCoverage }>
> {
  try {
    return await loadExchangeRateHistoryCore(input);
  } catch (caught) {
    return actionError(
      "loadExchangeRateHistory",
      caught,
      "Ханшийн түүх уншигдсангүй"
    );
  }
}

// ─── 3. Тухайн огнооны ханш (UI-аас тэгшитгэлийн огноо сонгоход) ─────────────

async function getStoredRateForDateCore(input: {
  currency: string;
  date: string;
}): Promise<{
  rate: number;
  rateDate: string;
  source: string;
  stored: boolean;
}> {
  await requireModuleAction("cash", "read");
  const currency = requireCurrency(input?.currency);
  const date = isoDate(input?.date);
  if (!date) throw new Error("Ханшийн огноо YYYY-MM-DD хэлбэртэй байх ёстой");

  const today = todayInUlaanbaatar();
  if (date > today)
    throw new Error(
      `Ирээдүйн (${date}) ханш байхгүй — огноогоо ${today}-аар хязгаарлана уу`
    );

  // STORE-FIRST. `getOfficialRateForDate` нь дараалалдаа:
  //   (а) ЯГ тэр өдрийн ХАДГАЛСАН ханш → сүлжээ хөндөхгүй,
  //   (б) байхгүй бол Монголбанкнаас татаад ХАДГАЛНА,
  //   (в) эх сурвалж унасан бол ≤10 хоногийн дотоод хадгалсан ханшаар нөхнө,
  //   (г) бас олдохгүй бол ШИДНЭ — ханш ЗОХИОХГҮЙ.
  const lookup = await getOfficialRateForDate(currency, date);
  return {
    rate: lookup.rate,
    rateDate: lookup.rateDate,
    source: lookup.source,
    stored: lookup.stored,
  };
}

/**
 * Тухайн огнооны Монголбанкны албан ханш — эхлээд хадгалсан түүхээс,
 * байхгүй бол Монголбанкнаас татаад хадгална.
 *
 * `rateDate` нь ханшийн БОДИТ огноо (эх сурвалж унасан үед сонгосон
 * огнооноос өмнөх ажлын өдөр байж болно) — UI-д ил харуулна.
 * `stored: true` = хадгалсан түүхээс уншсан.
 */
export async function getStoredRateForDate(input: {
  currency: string;
  date: string;
}): Promise<
  ActionResult<{
    rate: number;
    rateDate: string;
    source: string;
    stored: boolean;
  }>
> {
  try {
    return await getStoredRateForDateCore(input);
  } catch (caught) {
    return actionError(
      "getStoredRateForDate",
      caught,
      "Ханш олдсонгүй — ханшийг гараар оруулна уу"
    );
  }
}

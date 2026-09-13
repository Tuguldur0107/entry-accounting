// Монголбанкны (болон арилжааны банкны) ханшийн ТҮҮХИЙГ хадгалах / унших
// давхарга. Хүснэгт нь НИЙТИЙН лавлах — `organizationId` БАЙХГҮЙ (ханш нь
// нийтийн баримт), тиймээс энд эрхийн шалгалт хийхгүй: дуудагч server action
// нь өөрөө `requireModuleAction` дайруулна.
//
// Энэ бол ЭНГИЙН модуль ("use server" БИШ) — server action, cron, script
// гурвуулаа шууд дуудна.
//
// ХАНШ ХЭЗЭЭ Ч ЗОХИОГДОХГҮЙ: хадгалагдаагүй огноонд `loadStoredRate` нь null
// буцаана (дуудагч татах эсвэл хэрэглэгчээс гар ханш авна).

import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";

import {
  ISO_DATE_RE,
  rateForBasis,
  registerExchangeRateStore,
  type ExchangeRateBasis,
  type ExchangeRateQuote,
  type ExchangeRateSource,
} from "@/lib/cash/exchange-rates";
import { db } from "@/lib/db";
import { exchangeRates } from "@/lib/db/schema";

const CURRENCY_RE = /^[A-Z]{3}$/;
const KNOWN_SOURCES: ExchangeRateSource[] = ["mongolbank", "tdb", "golomt"];
const DEFAULT_SOURCE: ExchangeRateSource = "mongolbank";

/** Нэг INSERT-д явуулах мөрийн тоо (365 хоног × ~50 валют ≈ 18k мөр). */
const CHUNK_SIZE = 500;
const DEFAULT_ROW_LIMIT = 2_000;
const MAX_ROW_LIMIT = 50_000;

/** Хадгалагдсан ханшийн мөр — тоонууд number болж хөрвөсөн байна. */
export type StoredRateRow = {
  id: string;
  source: string;
  date: string;
  currency: string;
  officialRate: number | null;
  nonCashBuyRate: number | null;
  nonCashSellRate: number | null;
  cashBuyRate: number | null;
  cashSellRate: number | null;
  sourceUrl: string | null;
  fetchedAt: string;
};

type RateInsert = typeof exchangeRates.$inferInsert;

// ─── Туслахууд ───────────────────────────────────────────────────────────────

function toNumber(value: string | null) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumericText(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : String(value);
}

const ROW_COLUMNS = {
  id: exchangeRates.id,
  source: exchangeRates.source,
  date: exchangeRates.date,
  currency: exchangeRates.currency,
  officialRate: exchangeRates.officialRate,
  nonCashBuyRate: exchangeRates.nonCashBuyRate,
  nonCashSellRate: exchangeRates.nonCashSellRate,
  cashBuyRate: exchangeRates.cashBuyRate,
  cashSellRate: exchangeRates.cashSellRate,
  sourceUrl: exchangeRates.sourceUrl,
  fetchedAt: exchangeRates.fetchedAt,
};

type RawRateRow = {
  [K in keyof typeof ROW_COLUMNS]: (typeof exchangeRates.$inferSelect)[K];
};

function toStoredRow(row: RawRateRow): StoredRateRow {
  return {
    id: row.id,
    source: row.source,
    date: row.date,
    currency: row.currency,
    officialRate: toNumber(row.officialRate),
    nonCashBuyRate: toNumber(row.nonCashBuyRate),
    nonCashSellRate: toNumber(row.nonCashSellRate),
    cashBuyRate: toNumber(row.cashBuyRate),
    cashSellRate: toNumber(row.cashSellRate),
    sourceUrl: row.sourceUrl,
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

// ─── Бичих ───────────────────────────────────────────────────────────────────

/**
 * Нэг quote-ыг DB мөр болгоно. Огноо / валют / эх сурвалж гажиг эсвэл бүх
 * ханш нь хоосон бол null (хоосон мөр хадгалахгүй).
 */
function toInsertRow(
  value: ExchangeRateQuote,
  fetchedAt: Date,
  fetchedBy?: string
): RateInsert | null {
  const date = String(value.date ?? "")
    .trim()
    .slice(0, 10);
  const currency = String(value.currency ?? "")
    .trim()
    .toUpperCase();
  if (!ISO_DATE_RE.test(date) || !CURRENCY_RE.test(currency)) return null;
  if (!KNOWN_SOURCES.includes(value.source)) return null;

  const rates = {
    officialRate: toNumericText(value.officialRate),
    nonCashBuyRate: toNumericText(value.nonCashBuyRate),
    nonCashSellRate: toNumericText(value.nonCashSellRate),
    cashBuyRate: toNumericText(value.cashBuyRate),
    cashSellRate: toNumericText(value.cashSellRate),
  };
  if (Object.values(rates).every((rate) => rate == null)) return null;

  return {
    source: value.source,
    date,
    currency,
    ...rates,
    sourceUrl: value.sourceUrl ?? null,
    fetchedAt,
    fetchedBy: fetchedBy ?? null,
  };
}

/**
 * Нэг INSERT дотор ижил (source, currency, date) хоёр удаа орвол Postgres
 * "cannot affect row a second time" гэж унадаг тул урьдчилж нэгтгэнэ —
 * хожмынх нь ХООСОН БИШ утгаараа дарна.
 */
function mergeRows(rows: RateInsert[]) {
  const merged = new Map<string, RateInsert>();
  for (const row of rows) {
    const key = `${row.source}|${row.currency}|${row.date}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, row);
      continue;
    }
    merged.set(key, {
      ...previous,
      officialRate: row.officialRate ?? previous.officialRate,
      nonCashBuyRate: row.nonCashBuyRate ?? previous.nonCashBuyRate,
      nonCashSellRate: row.nonCashSellRate ?? previous.nonCashSellRate,
      cashBuyRate: row.cashBuyRate ?? previous.cashBuyRate,
      cashSellRate: row.cashSellRate ?? previous.cashSellRate,
      sourceUrl: row.sourceUrl ?? previous.sourceUrl,
    });
  }
  return [...merged.values()];
}

/**
 * Ханшийн quote-уудыг хадгална — (source, currency, date)-аар upsert.
 * ШИНЭ утга null биш үед л хуучныг дарна (жишээ нь албан ханш татсан нь
 * арилжааны банкны buy/sell баганыг устгахгүй). Буцаах нь бичигдсэн мөрийн тоо.
 */
export async function saveExchangeRates(
  quotes: ExchangeRateQuote[],
  fetchedBy?: string
): Promise<number> {
  const fetchedAt = new Date();
  const rows = mergeRows(
    quotes.flatMap((value) => {
      const row = toInsertRow(value, fetchedAt, fetchedBy);
      return row ? [row] : [];
    })
  );
  if (!rows.length) return 0;

  let written = 0;
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE);
    const saved = await db
      .insert(exchangeRates)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          exchangeRates.source,
          exchangeRates.currency,
          exchangeRates.date,
        ],
        set: {
          officialRate: sql`coalesce(excluded.official_rate, ${exchangeRates.officialRate})`,
          nonCashBuyRate: sql`coalesce(excluded.non_cash_buy_rate, ${exchangeRates.nonCashBuyRate})`,
          nonCashSellRate: sql`coalesce(excluded.non_cash_sell_rate, ${exchangeRates.nonCashSellRate})`,
          cashBuyRate: sql`coalesce(excluded.cash_buy_rate, ${exchangeRates.cashBuyRate})`,
          cashSellRate: sql`coalesce(excluded.cash_sell_rate, ${exchangeRates.cashSellRate})`,
          sourceUrl: sql`coalesce(excluded.source_url, ${exchangeRates.sourceUrl})`,
          fetchedAt: sql`excluded.fetched_at`,
          fetchedBy: sql`coalesce(excluded.fetched_by, ${exchangeRates.fetchedBy})`,
        },
      })
      .returning({ id: exchangeRates.id });
    written += saved.length;
  }
  return written;
}

// ─── Унших ───────────────────────────────────────────────────────────────────

/**
 * ЦЭВЭР: quote жагсаалтаас огноо ≤ asOf-ийн ХАМГИЙН СҮҮЛИЙНХ.
 * Амралтын өдөр → өмнөх ажлын өдрийн ханш гарч ирнэ. Олдохгүй бол null.
 */
export function pickLatestOnOrBefore<T extends { date: string }>(
  rows: T[],
  asOf: string
): T | null {
  if (!ISO_DATE_RE.test(String(asOf ?? "").trim())) return null;
  const limit = String(asOf).trim();
  let best: T | null = null;
  for (const row of rows) {
    const date = row?.date;
    if (typeof date !== "string" || !ISO_DATE_RE.test(date)) continue;
    if (date > limit) continue;
    if (!best || date > best.date) best = row;
  }
  return best;
}

function basisConditions(basis: ExchangeRateBasis) {
  if (basis === "official") return [isNotNull(exchangeRates.officialRate)];
  if (basis === "buy") return [isNotNull(exchangeRates.nonCashBuyRate)];
  if (basis === "sell") return [isNotNull(exchangeRates.nonCashSellRate)];
  return [
    isNotNull(exchangeRates.nonCashBuyRate),
    isNotNull(exchangeRates.nonCashSellRate),
  ];
}

/**
 * Хадгалагдсан ханш: тухайн валютын огноо ≤ date-ийн ХАМГИЙН СҮҮЛИЙНХ
 * (амралтын өдөр → өмнөх ажлын өдөр). Олдохгүй бол null — дуудагч эх
 * сурвалжаас татах эсвэл гар ханш асууна.
 */
export async function loadStoredRate(input: {
  currency: string;
  date: string;
  source?: string;
  basis?: ExchangeRateBasis;
}): Promise<{
  rate: number;
  rateDate: string;
  source: string;
  sourceUrl: string | null;
  fetchedAt: string;
} | null> {
  const currency = String(input.currency ?? "")
    .trim()
    .toUpperCase();
  const date = String(input.date ?? "").trim();
  const source = String(input.source ?? DEFAULT_SOURCE).trim();
  const basis: ExchangeRateBasis = input.basis ?? "official";
  if (!CURRENCY_RE.test(currency) || !ISO_DATE_RE.test(date)) return null;

  const [row] = await db
    .select(ROW_COLUMNS)
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.currency, currency),
        eq(exchangeRates.source, source),
        lte(exchangeRates.date, date),
        ...basisConditions(basis)
      )
    )
    .orderBy(desc(exchangeRates.date))
    .limit(1);
  if (!row) return null;

  const stored = toStoredRow(row);
  const rate = rateForBasis(stored, basis);
  if (rate == null || rate <= 0) return null;
  return {
    rate,
    rateDate: stored.date,
    source: stored.source,
    sourceUrl: stored.sourceUrl,
    fetchedAt: stored.fetchedAt,
  };
}

/** Хадгалагдсан ханшийн мужийн жагсаалт (шинэ огноо эхэндээ). */
export async function loadStoredRates(input: {
  from: string;
  to: string;
  currency?: string;
  source?: string;
  limit?: number;
}): Promise<StoredRateRow[]> {
  const from = String(input.from ?? "").trim();
  const to = String(input.to ?? "").trim();
  if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) return [];
  if (from > to) return [];

  const currency = input.currency?.trim().toUpperCase();
  const source = input.source?.trim();
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? DEFAULT_ROW_LIMIT), 1),
    MAX_ROW_LIMIT
  );

  const rows = await db
    .select(ROW_COLUMNS)
    .from(exchangeRates)
    .where(
      and(
        gte(exchangeRates.date, from),
        lte(exchangeRates.date, to),
        ...(currency && CURRENCY_RE.test(currency)
          ? [eq(exchangeRates.currency, currency)]
          : []),
        ...(source ? [eq(exchangeRates.source, source)] : [])
      )
    )
    .orderBy(desc(exchangeRates.date), asc(exchangeRates.currency))
    .limit(limit);
  return rows.map(toStoredRow);
}

/** Хадгалагдсан түүхийн хамрах хүрээ (UI-д "юу татагдсан бэ" харуулахад). */
export async function storedRateCoverage(source?: string): Promise<{
  rows: number;
  minDate: string | null;
  maxDate: string | null;
  currencies: number;
}> {
  const filter = source?.trim();
  const [row] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      minDate: sql<string | null>`min(${exchangeRates.date})`,
      maxDate: sql<string | null>`max(${exchangeRates.date})`,
      currencies: sql<number>`count(distinct ${exchangeRates.currency})::int`,
    })
    .from(exchangeRates)
    .where(filter ? eq(exchangeRates.source, filter) : undefined);
  return {
    rows: row?.rows ?? 0,
    minDate: row?.minDate ?? null,
    maxDate: row?.maxDate ?? null,
    currencies: row?.currencies ?? 0,
  };
}

// `getOfficialRateForDate` нь энэ модулийг ШУУД import хийж чадахгүй
// (exchange-rates.ts-ийг client component ч уншдаг тул postgres драйвер
// browser bundle-д орох болно) — тиймээс энд бүртгүүлнэ. Server талын
// дурын модуль `import "@/lib/cash/rate-store"` хийсэн даруйд ханшийн
// хайлт ХАДГАЛСАНААС эхэлдэг болно.
registerExchangeRateStore({ loadStoredRate, saveExchangeRates });

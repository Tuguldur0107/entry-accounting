export type ExchangeRateSource = "mongolbank" | "tdb" | "golomt";
export type ExchangeRateBasis = "official" | "mid" | "buy" | "sell";

export type ExchangeRateQuote = {
  id: string;
  source: ExchangeRateSource;
  sourceName: string;
  sourceType: "central" | "commercial";
  sourceUrl: string;
  date: string;
  currency: string;
  officialRate: number | null;
  nonCashBuyRate: number | null;
  nonCashSellRate: number | null;
  cashBuyRate: number | null;
  cashSellRate: number | null;
  fetchedAt?: string;
};

const SOURCE_DETAILS = {
  mongolbank: {
    sourceName: "Монголбанк",
    sourceType: "central" as const,
    sourceUrl: "https://www.mongolbank.mn/mn/currency-rates",
  },
  tdb: {
    sourceName: "Худалдаа, хөгжлийн банк",
    sourceType: "commercial" as const,
    sourceUrl: "https://acs.tdbm.mn/mn/exchange",
  },
  golomt: {
    sourceName: "Голомт банк",
    sourceType: "commercial" as const,
    sourceUrl: "https://www.golomtbank.com/exchange",
  },
};

/** ISO огноо (YYYY-MM-DD) — ханшийн огноо энэ хэлбэртэй л байна. */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

function numericRate(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** "2026-09-04" / "2026-09-04T00:00:00" → "2026-09-04"; бусад → null. */
function isoDateOf(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim().slice(0, 10);
  return ISO_DATE_RE.test(text) ? text : null;
}

function normalizeCurrencies(currencies: string[]) {
  return [
    ...new Set(
      currencies
        .map((currency) => currency.trim().toUpperCase())
        .filter((currency) => CURRENCY_RE.test(currency))
    ),
  ];
}

function quote(
  source: ExchangeRateSource,
  date: string,
  currency: string,
  rates: Omit<
    ExchangeRateQuote,
    | "id"
    | "source"
    | "sourceName"
    | "sourceType"
    | "sourceUrl"
    | "date"
    | "currency"
    | "fetchedAt"
  >
): ExchangeRateQuote {
  return {
    id: `${source}-${date}-${currency}`,
    source,
    ...SOURCE_DETAILS[source],
    date,
    currency,
    ...rates,
  };
}

/** Ханшийн суурь сонгох — quote эсвэл хадгалагдсан мөр аль нь ч болно. */
export function rateForBasis(
  value: Pick<
    ExchangeRateQuote,
    "officialRate" | "nonCashBuyRate" | "nonCashSellRate"
  >,
  basis: ExchangeRateBasis
) {
  if (basis === "official") return value.officialRate;
  if (basis === "buy") return value.nonCashBuyRate;
  if (basis === "sell") return value.nonCashSellRate;
  if (value.nonCashBuyRate == null || value.nonCashSellRate == null) return null;
  return (value.nonCashBuyRate + value.nonCashSellRate) / 2;
}

type MongolbankResponse = {
  success?: boolean;
  data?: Array<Record<string, unknown> & { RATE_DATE?: string }>;
};

export function parseMongolbankRates(
  payload: MongolbankResponse,
  currencies: string[],
  asOf: string
) {
  const rows = (payload.data ?? [])
    .filter((row) => row.RATE_DATE && row.RATE_DATE <= asOf)
    .sort((left, right) =>
      String(right.RATE_DATE).localeCompare(String(left.RATE_DATE))
    );

  return currencies.flatMap((currency) => {
    const row = rows.find((candidate) => numericRate(candidate[currency]));
    const officialRate = row ? numericRate(row[currency]) : null;
    if (!row?.RATE_DATE || officialRate == null) return [];
    return [
      quote("mongolbank", row.RATE_DATE, currency, {
        officialRate,
        nonCashBuyRate: null,
        nonCashSellRate: null,
        cashBuyRate: null,
        cashSellRate: null,
      }),
    ];
  });
}

/**
 * ЦЭВЭР: Монголбанкны хариунаас өдөр БҮРИЙН мөрийг quote болгоно (түүх хадгалах
 * зам). `parseMongolbankRates` нь зөвхөн сүүлийн хүчинтэй мөрийг өгдөг —
 * тэр нь "тухайн өдрийн ханш" хайлтад, энэ нь ТҮҮХ татахад.
 *
 * `currencies` өгөөгүй бол мөрөнд байгаа БҮХ хүчинтэй валют (3 үсэгт багана,
 * тоон утга > 0). Огноогүй / гажиг мөрийг чимээгүй алгасна — ханш ЗОХИОХГҮЙ.
 */
export function parseMongolbankHistory(
  payload: MongolbankResponse,
  currencies?: string[]
): ExchangeRateQuote[] {
  const wanted = currencies ? normalizeCurrencies(currencies) : null;
  const results: ExchangeRateQuote[] = [];

  for (const row of payload.data ?? []) {
    if (!row || typeof row !== "object") continue;
    const date = isoDateOf(row.RATE_DATE);
    if (!date) continue;
    const codes =
      wanted ??
      Object.keys(row).filter(
        (key) => key !== "RATE_DATE" && CURRENCY_RE.test(key)
      );
    for (const currency of codes) {
      const officialRate = numericRate(row[currency]);
      if (officialRate == null) continue;
      results.push(
        quote("mongolbank", date, currency, {
          officialRate,
          nonCashBuyRate: null,
          nonCashSellRate: null,
          cashBuyRate: null,
          cashSellRate: null,
        })
      );
    }
  }

  return results.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.currency.localeCompare(right.currency)
  );
}

function textContent(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTdbRates(
  html: string,
  currencies: string[],
  date: string
) {
  const publishedDate =
    html
      .match(/name=["']dt["'][^>]*value=["'](\d{4})\/(\d{2})\/(\d{2})["']/i)
      ?.slice(1, 4)
      .join("-") || date;
  const table =
    html.match(
      /<div[^>]+id=["']exchange-table-result["'][^>]*>([\s\S]*?)<\/table>/i
    )?.[1] ?? "";
  const allowed = new Set(currencies);
  const results: ExchangeRateQuote[] = [];

  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (cell) => textContent(cell[1])
    );
    const currency = cells[0]?.match(/\b[A-Z]{3}\b/)?.[0];
    if (!currency || !allowed.has(currency) || cells.length < 7) continue;
    results.push(
      quote("tdb", publishedDate, currency, {
        officialRate: numericRate(cells[2]),
        nonCashBuyRate: numericRate(cells[3]),
        nonCashSellRate: numericRate(cells[4]),
        cashBuyRate: numericRate(cells[5]),
        cashSellRate: numericRate(cells[6]),
      })
    );
  }
  return results;
}

type GolomtRate = {
  mongolbank?: { cvalue?: unknown };
  non_cash_buy?: { cvalue?: unknown };
  non_cash_sell?: { cvalue?: unknown };
  cash_buy?: { cvalue?: unknown };
  cash_sell?: { cvalue?: unknown };
};

export function parseGolomtRates(
  payload: { result?: Record<string, GolomtRate> },
  currencies: string[],
  date: string
) {
  return currencies.flatMap((currency) => {
    const value = payload.result?.[currency];
    if (!value) return [];
    return [
      quote("golomt", date, currency, {
        officialRate: numericRate(value.mongolbank?.cvalue),
        nonCashBuyRate: numericRate(value.non_cash_buy?.cvalue),
        nonCashSellRate: numericRate(value.non_cash_sell?.cvalue),
        cashBuyRate: numericRate(value.cash_buy?.cvalue),
        cashSellRate: numericRate(value.cash_sell?.cvalue),
      }),
    ];
  });
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function checkedFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(12_000),
    headers: {
      "User-Agent": "EntryAccounting/1.0",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`);
  return response;
}

const MONGOLBANK_DATA_URL =
  "https://www.mongolbank.mn/mn/currency-rates/data";

/** Нэг хүсэлтээр татах дээд муж — МБ урт мужид ч хариулдаг ч жилээр хуваана. */
const MONGOLBANK_MAX_RANGE_DAYS = 365;

async function fetchMongolbankRange(startDate: string, endDate: string) {
  const query = new URLSearchParams({ startDate, endDate });
  const response = await checkedFetch(`${MONGOLBANK_DATA_URL}?${query}`, {
    method: "POST",
  });
  return (await response.json()) as MongolbankResponse;
}

export async function fetchMongolbankRates(
  asOf: string,
  currencies: string[]
) {
  const payload = await fetchMongolbankRange(addDays(asOf, -10), asOf);
  return parseMongolbankRates(payload, currencies, asOf);
}

/**
 * ТҮҮХ: [from, to] мужийн өдөр тутмын албан ханш. Муж нь 1 жилээс урт бол
 * жилээр ХУВААЖ дараалан татна (МБ-ыг зэрэг олон хүсэлтээр цохихгүй).
 * Огноо буруу / муж урвуу бол ШИДНЭ.
 */
export async function fetchMongolbankHistory(
  from: string,
  to: string,
  currencies?: string[]
): Promise<ExchangeRateQuote[]> {
  if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to))
    throw new Error("Ханшийн огноо буруу байна");
  if (from > to)
    throw new Error("Эхлэх огноо дуусах огнооноос хойш байж болохгүй");

  const merged = new Map<string, ExchangeRateQuote>();
  let start = from;
  while (start <= to) {
    const chunkEnd = addDays(start, MONGOLBANK_MAX_RANGE_DAYS - 1);
    const end = chunkEnd < to ? chunkEnd : to;
    const payload = await fetchMongolbankRange(start, end);
    for (const value of parseMongolbankHistory(payload, currencies))
      merged.set(`${value.date}|${value.currency}`, value);
    start = addDays(end, 1);
  }

  return [...merged.values()].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.currency.localeCompare(right.currency)
  );
}

// ─── Системийн СУУРЬ ханш (Монголбанкны албан ханш огноогоор) ────────────────
//
// docs/procurement §3.5: хүлээн авалт, нэхэмжлэх, PO хаалт бүгд тухайн
// өдрийн Монголбанкны АЛБАН ханшаар үнэлэгдэнэ (төлбөрт л арилжааны банкны
// ханш). Ханш олдохгүй бол ҮНЭ ЗОХИОХГҮЙ — шидэж, хэрэглэгчээс гар ханш
// авна (CLAUDE.md §10 effective date, docs/cost "үнэ хэзээ ч зохиохгүй").

export type OfficialRateLookup = {
  currency: string;
  rate: number;
  /** Монголбанкны бодит ханшны огноо — амралтын өдөр бол өмнөх ажлын өдөр. */
  rateDate: string;
  source: "mongolbank";
  basis: "official";
  sourceUrl: string;
  fetchedAt: string;
  /** true = хадгалагдсан түүхээс уншсан, false = эх сурвалжаас шинээр татсан. */
  stored: boolean;
};

// ─── Ханшийн агуулахын залгуур (rate-store.ts) ───────────────────────────────
//
// ЭНЭ ФАЙЛД `@/lib/db`-г import ХИЙХИЙГ ХОРИГЛОНО: client component ч эндээс
// (`rateForBasis`, төрлүүд) уншдаг тул postgres драйвер browser bundle-д орж
// build унана. Тиймээс хадгалалтын давхарга нь `lib/cash/rate-store.ts`-д
// амьдарч, import хийгдэх мөчдөө ӨӨРИЙГӨӨ энд бүртгүүлнэ. Бүртгэгдээгүй
// (жишээ нь цэвэр client / тест) орчинд getOfficialRateForDate нь урьдын
// адил шууд Монголбанкнаас татна.

export type StoredRateHit = {
  rate: number;
  rateDate: string;
  source: string;
  sourceUrl: string | null;
  fetchedAt: string;
};

export type ExchangeRateStore = {
  loadStoredRate(input: {
    currency: string;
    date: string;
    source?: string;
    basis?: ExchangeRateBasis;
  }): Promise<StoredRateHit | null>;
  saveExchangeRates(
    quotes: ExchangeRateQuote[],
    fetchedBy?: string
  ): Promise<number>;
};

// globalThis дээр хадгална — Next нь route бүрд тусдаа bundle үүсгэдэг тул
// модуль хэд ч хуулбарлагдсан НЭГ л агуулах ажиллана.
const storeHolder = globalThis as typeof globalThis & {
  __eaExchangeRateStore?: ExchangeRateStore;
};

export function registerExchangeRateStore(store: ExchangeRateStore) {
  storeHolder.__eaExchangeRateStore = store;
}

export function getExchangeRateStore(): ExchangeRateStore | null {
  return storeHolder.__eaExchangeRateStore ?? null;
}

/** ЦЭВЭР (тесттэй): quote жагсаалтаас тухайн валютын албан ханшийг сонгоно. */
export function pickOfficialRate(
  quotes: ExchangeRateQuote[],
  currency: string
): { rate: number; rateDate: string; sourceUrl: string } | null {
  const code = currency.trim().toUpperCase();
  const quote = quotes.find(
    (candidate) =>
      candidate.source === "mongolbank" && candidate.currency === code
  );
  const rate = quote ? rateForBasis(quote, "official") : null;
  if (!quote || rate == null) return null;
  return { rate, rateDate: quote.date, sourceUrl: quote.sourceUrl };
}

/** Эх сурвалж унасан үед хадгалсан ханшаар нөхөх дээд хугацаа (хоногоор). */
const STALE_FALLBACK_DAYS = 10;

function daysBetween(from: string, to: string) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/**
 * Системийн СУУРЬ ханш: Монголбанкны албан ханш тухайн огноогоор. MNT → 1.
 *
 * Дараалал:
 *   (а) ЯГ тэр өдрийн хадгалагдсан ханш → шууд буцаана (сүлжээ хөндөхгүй).
 *   (б) байхгүй бол Монголбанкнаас татаад ХАДГАЛНА.
 *   (в) татагдахгүй бол ≤10 хоногийн дотоод хадгалсан ханшаар нөхнө.
 *   (г) бас олдохгүй бол ШИДНЭ — үнэ ЗОХИОХГҮЙ, хэрэглэгч гараар оруулна.
 *
 * (а)-д ЯГ таарсан огноог шаардаж байгаа нь санамсаргүй хуучин ханш
 * хэрэглэхээс сэргийлнэ: агуулах тухайн огноог хүртэл дүүргэгдээгүй байхад
 * "≤ date-ийн сүүлийнх" нь Монголбанкны бодит ханшнаас ЗӨРӨХ боломжтой
 * (МБ амралтын өдөр ч мөр нийтэлдэг). Хүлээн авалт/тэгшитгэл нь ТУХАЙН
 * ӨДРИЙН ханшаар үнэлэгдэх ёстой (docs/procurement §3.5).
 */
export async function getOfficialRateForDate(
  currency: string,
  date: string
): Promise<OfficialRateLookup> {
  const code = currency.trim().toUpperCase();
  if (!ISO_DATE_RE.test(date)) throw new Error("Ханшийн огноо буруу байна");
  const fetchedAt = new Date().toISOString();
  const sourceUrl = SOURCE_DETAILS.mongolbank.sourceUrl;
  if (code === "MNT")
    return {
      currency: code,
      rate: 1,
      rateDate: date,
      source: "mongolbank",
      basis: "official",
      sourceUrl,
      fetchedAt,
      stored: false,
    };
  if (!CURRENCY_RE.test(code))
    throw new Error(`Валютын код буруу байна: ${currency}`);

  // (а) Хадгалагдсан түүх — өмнөх үеийн эхний үлдэгдэл, FX тэгшитгэлд гол зам.
  const store = getExchangeRateStore();
  const hit = store
    ? await store
        .loadStoredRate({
          currency: code,
          date,
          source: "mongolbank",
          basis: "official",
        })
        .catch(() => null)
    : null;
  const storedLookup = (found: StoredRateHit): OfficialRateLookup => ({
    currency: code,
    rate: found.rate,
    rateDate: found.rateDate,
    source: "mongolbank",
    basis: "official",
    sourceUrl: found.sourceUrl ?? sourceUrl,
    fetchedAt: found.fetchedAt,
    stored: true,
  });
  if (hit && hit.rateDate === date) return storedLookup(hit);

  // (б) Эх сурвалжаас татаад хадгална.
  let fetchError = "";
  const quotes = await fetchMongolbankRates(date, [code]).catch(
    (caught: unknown) => {
      fetchError = caught instanceof Error ? caught.message : String(caught);
      return [] as ExchangeRateQuote[];
    }
  );
  // Хадгалалт унасан ч ханшийн уншилт зогсохгүй (агуулах нь кэш, эх сурвалж биш).
  if (store && quotes.length)
    await store.saveExchangeRates(quotes).catch(() => 0);

  const picked = pickOfficialRate(quotes, code);
  if (picked)
    return {
      currency: code,
      ...picked,
      source: "mongolbank",
      basis: "official",
      fetchedAt,
      stored: false,
    };

  // (в) Эх сурвалж унасан — хадгалсан ханшаар нөхнө (зөвхөн 10 хоногийн дотор,
  // fetchMongolbankRates-ийн хайх цонхтой ижил). Хэтэрвэл гар ханш шаардана.
  if (hit && daysBetween(hit.rateDate, date) <= STALE_FALLBACK_DAYS)
    return storedLookup(hit);

  // (г) Ханш ЗОХИОХГҮЙ.
  if (fetchError)
    throw new Error(
      `Монголбанкны ханш татагдсангүй (${fetchError}) — ханшийг гараар оруулна уу`
    );
  throw new Error(
    `${code} валютын Монголбанкны албан ханш ${date}-нд олдсонгүй — ханшийг гараар оруулна уу`
  );
}

export async function fetchTdbRates(asOf: string, currencies: string[]) {
  const formattedDate = asOf.replaceAll("-", "/");
  const response = await checkedFetch(
    `https://acs.tdbm.mn/mn/exchange?dt=${encodeURIComponent(formattedDate)}`
  );
  return parseTdbRates(await response.text(), currencies, asOf);
}

export async function fetchGolomtRates(asOf: string, currencies: string[]) {
  const formattedDate = asOf.replaceAll("-", "");
  const response = await checkedFetch(
    `https://www.golomtbank.com/api/exchange/?date=${formattedDate}`
  );
  return parseGolomtRates(
    (await response.json()) as { result?: Record<string, GolomtRate> },
    currencies,
    asOf
  );
}

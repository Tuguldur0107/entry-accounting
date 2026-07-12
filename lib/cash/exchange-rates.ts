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

function numericRate(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

export function rateForBasis(
  value: ExchangeRateQuote,
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

export async function fetchMongolbankRates(
  asOf: string,
  currencies: string[]
) {
  const query = new URLSearchParams({
    startDate: addDays(asOf, -10),
    endDate: asOf,
  });
  const response = await checkedFetch(
    `https://www.mongolbank.mn/mn/currency-rates/data?${query}`,
    { method: "POST" }
  );
  return parseMongolbankRates(
    (await response.json()) as MongolbankResponse,
    currencies,
    asOf
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

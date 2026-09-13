// Тухайн өдрийн ханш — тулгалт / тэгшитгэлийн диалог эндээс уншина.
//
// Монголбанк нь STORE-FIRST: эхлээд ХАДГАЛСАН түүхээс (`loadStoredRates` +
// `pickLatestOnOrBefore`), олдохгүй валютыг л эх сурвалжаас татаад буцаж
// ХАДГАЛНА. Ингэснээр өмнөх үеийн огноо сонгоход (эхний үлдэгдэл, түүхэн
// бичилт) сүлжээ хөндөхгүй, Монголбанк унасан ч ажиллана.
//
// Арилжааны банкууд (ТDB, Голомт) түүхийн API-гүй тул шууд татна — гэхдээ
// татсаныг нь мөн хадгална (дараагийн ижил огнооны хүсэлтэд хэрэг болно).
// Хадгалалт унавал хариу УНАХГҮЙ (агуулах нь кэш, эх сурвалж биш).

import { auth } from "@/lib/auth";
import {
  fetchGolomtRates,
  fetchMongolbankRates,
  fetchTdbRates,
  type ExchangeRateQuote,
  type ExchangeRateSource,
} from "@/lib/cash/exchange-rates";
import {
  loadStoredRates,
  pickLatestOnOrBefore,
  saveExchangeRates,
  type StoredRateRow,
} from "@/lib/cash/rate-store";

export const runtime = "nodejs";

const DEFAULT_CURRENCIES = ["USD", "EUR", "CNY", "RUB", "JPY", "GBP", "KRW"];

const SOURCE_META: Record<
  ExchangeRateSource,
  { name: string; type: "central" | "commercial"; url: string }
> = {
  mongolbank: {
    name: "Монголбанк",
    type: "central",
    url: "https://www.mongolbank.mn/mn/currency-rates",
  },
  tdb: {
    name: "Худалдаа, хөгжлийн банк",
    type: "commercial",
    url: "https://acs.tdbm.mn/mn/exchange",
  },
  golomt: {
    name: "Голомт банк",
    type: "commercial",
    url: "https://www.golomtbank.com/exchange",
  },
};

/** Хадгалсан ханш хайх цонх — `fetchMongolbankRates`-ийн цонхтой ижил. */
const STORED_WINDOW_DAYS = 10;

/** `stored: true` = хадгалсан түүхээс уншсан, false = эх сурвалжаас шинэ. */
type QuoteWithStored = ExchangeRateQuote & { stored: boolean };

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function storedQuote(
  source: ExchangeRateSource,
  row: StoredRateRow
): QuoteWithStored {
  const meta = SOURCE_META[source];
  return {
    id: `${source}-${row.date}-${row.currency}`,
    source,
    sourceName: meta.name,
    sourceType: meta.type,
    sourceUrl: row.sourceUrl ?? meta.url,
    date: row.date,
    currency: row.currency,
    officialRate: row.officialRate,
    nonCashBuyRate: row.nonCashBuyRate,
    nonCashSellRate: row.nonCashSellRate,
    cashBuyRate: row.cashBuyRate,
    cashSellRate: row.cashSellRate,
    fetchedAt: row.fetchedAt,
    stored: true,
  };
}

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId)
    return Response.json({ error: "Нэвтрэх шаардлагатай" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return Response.json({ error: "Ханшийн огноо буруу" }, { status: 400 });

  const requested = (searchParams.get("currencies") ?? "")
    .split(",")
    .map((currency) => currency.trim().toUpperCase())
    .filter((currency) => /^[A-Z]{3}$/.test(currency) && currency !== "MNT");
  const currencies = [
    ...new Set(requested.length ? requested : DEFAULT_CURRENCIES),
  ];
  const sourceFilter = searchParams.get("source");
  if (sourceFilter && !(sourceFilter in SOURCE_META))
    return Response.json({ error: "Ханшийн эх сурвалж буруу" }, { status: 400 });

  const fetchedAt = new Date().toISOString();
  const errors: string[] = [];

  /** Монголбанк: хадгалсан түүх → дутуу валютыг л татаад хадгална. */
  async function loadMongolbank(): Promise<QuoteWithStored[]> {
    const quotes: QuoteWithStored[] = [];
    const missing: string[] = [];

    // Нэг хайлтаар 10 хоногийн цонх — амралтын өдөр өмнөх ажлын өдөр рүү
    // унана (`pickLatestOnOrBefore`).
    const stored = await loadStoredRates({
      from: addDays(date, -STORED_WINDOW_DAYS),
      to: date,
      source: "mongolbank",
    }).catch(() => [] as StoredRateRow[]);
    const byCurrency = new Map<string, StoredRateRow[]>();
    for (const row of stored) {
      if (row.officialRate == null) continue;
      const list = byCurrency.get(row.currency);
      if (list) list.push(row);
      else byCurrency.set(row.currency, [row]);
    }

    for (const currency of currencies) {
      const hit = pickLatestOnOrBefore(byCurrency.get(currency) ?? [], date);
      if (hit) quotes.push(storedQuote("mongolbank", hit));
      else missing.push(currency);
    }
    if (missing.length === 0) return quotes;

    let fetched: ExchangeRateQuote[] = [];
    try {
      fetched = await fetchMongolbankRates(date, missing);
    } catch {
      errors.push(`${SOURCE_META.mongolbank.name}: мэдээлэл татаж чадсангүй`);
      return quotes;
    }
    // Татсаныг ХАДГАЛНА — дараагийн хүсэлт агуулахаас уншина. Алдааг залгина.
    if (fetched.length)
      await saveExchangeRates(fetched, userId).catch(() => 0);
    quotes.push(...fetched.map((quote) => ({ ...quote, fetchedAt, stored: false })));

    const notFound = missing.filter(
      (currency) => !fetched.some((quote) => quote.currency === currency)
    );
    if (notFound.length)
      errors.push(
        `${SOURCE_META.mongolbank.name}: ${notFound.join(", ")} ханш олдсонгүй`
      );
    return quotes;
  }

  /** Арилжааны банк: шууд татаад, амжилттай бол хадгална. */
  async function loadCommercial(
    source: Extract<ExchangeRateSource, "tdb" | "golomt">
  ): Promise<QuoteWithStored[]> {
    const meta = SOURCE_META[source];
    let fetched: ExchangeRateQuote[] = [];
    try {
      fetched =
        source === "tdb"
          ? await fetchTdbRates(date, currencies)
          : await fetchGolomtRates(date, currencies);
    } catch {
      errors.push(`${meta.name}: мэдээлэл татаж чадсангүй`);
      return [];
    }
    if (fetched.length === 0) {
      errors.push(`${meta.name}: ханш олдсонгүй`);
      return [];
    }
    await saveExchangeRates(fetched, userId).catch(() => 0);
    return fetched.map((quote) => ({ ...quote, fetchedAt, stored: false }));
  }

  const loaders: Array<() => Promise<QuoteWithStored[]>> = (
    ["mongolbank", "tdb", "golomt"] as const
  )
    .filter((source) => !sourceFilter || sourceFilter === source)
    .map((source) =>
      source === "mongolbank" ? loadMongolbank : () => loadCommercial(source)
    );

  // Эх сурвалжийн дараалал ХЭВЭЭР үлдэнэ (client эрэмбэлдэггүй).
  const collected = await Promise.all(loaders.map((load) => load()));

  return Response.json(
    { quotes: collected.flat(), errors, fetchedAt },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}

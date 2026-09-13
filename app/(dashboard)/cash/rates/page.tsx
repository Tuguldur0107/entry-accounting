// «Ханшийн түүх» (/cash/rates) — Монголбанкны хадгалагдсан ханшийн лавлах.
//
// `exchange_rates` нь НИЙТИЙН лавлах — `organizationId` БАЙХГҮЙ (ханш нь
// нийтийн баримт) тул энд org-оор шүүхгүй. Нэвтрэлт + модулийн эрхийг
// `loadExchangeRateHistory` (`requireModuleAction("cash", "read")`) шалгана —
// алдаа нь ActionResult-аар ирэх тул хуудас унахгүй, шалтгаан нь харагдана.
//
// URL параметр (`from` / `to` / `currency` / `source`) нь ЦОРЫН ГАНЦ эх
// сурвалж — CLAUDE.md §4: ил параметр cookie-гийн сонголтыг ДАРНА, байхгүй
// бол `getPeriodSelection()`-ийн муж default болно (deep link ажиллана).

import { asc } from "drizzle-orm";

import {
  ExchangeRateHistoryView,
  type ExchangeRateHistoryRow,
} from "@/components/cash/exchange-rate-history-view";
import { EmptyState } from "@/components/ui/empty-state";
import { loadExchangeRateHistory } from "@/lib/actions/exchange-rates";
import { ISO_DATE_RE } from "@/lib/cash/exchange-rates";
import { db } from "@/lib/db";
import { exchangeRates } from "@/lib/db/schema";
import { getPeriodSelection } from "@/lib/periods/selection";

/** Нэг хуудсанд ачаалах дээд мөр — хэтэрвэл UI-д «мужаа нарийсга» гэж сануулна. */
const ROW_LIMIT = 5_000;

const KNOWN_SOURCES = ["mongolbank", "tdb", "golomt"];

type SearchParams = Promise<{
  from?: string;
  to?: string;
  currency?: string;
  source?: string;
}>;

function isoOrNull(value: string | undefined) {
  return value && ISO_DATE_RE.test(value) ? value : null;
}

export default async function ExchangeRateHistoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const selection = await getPeriodSelection();

  const requestedFrom = isoOrNull(params.from) ?? selection.from;
  const requestedTo = isoOrNull(params.to) ?? selection.to;
  // Урвуу муж (from > to) чимээгүй хоосон хүснэгт болохын оронд солигдоно.
  const from = requestedFrom <= requestedTo ? requestedFrom : requestedTo;
  const to = requestedFrom <= requestedTo ? requestedTo : requestedFrom;

  const currency = /^[A-Za-z]{3}$/.test(params.currency ?? "")
    ? params.currency!.toUpperCase()
    : "";
  const source = KNOWN_SOURCES.includes(params.source ?? "")
    ? params.source!
    : "";

  // Эх сурвалжийн chip нь тоолууртай тул мөрүүдийг эх сурвалжаар ШҮҮХГҮЙ
  // ачаална (шүүлт нь client талд) — мөн хамрах хүрээ нь БҮХ эх сурвалжийг
  // хамарсан хэвээр үлдэнэ.
  const {
    rows: storedRows,
    coverage,
    error,
  } = await loadExchangeRateHistory({
    from,
    to,
    currency: currency || undefined,
    limit: ROW_LIMIT,
  });

  if (error || !storedRows || !coverage)
    return (
      <EmptyState
        icon="warning"
        title="Ханшийн түүх уншигдсангүй"
        description={error ?? "Ханшийн лавлах уншигдсангүй"}
      />
    );

  // Шүүлтүүрийн валютын жагсаалт нь ИДЭВХТЭЙ шүүлтээс хамаарахгүй байх
  // ёстой (эс бөгөөс нэг валют сонгомогц бусад руу шилжих боломжгүй болно)
  // — тиймээс лавлахаас бүтнээр нь уншина.
  const currencyRows = await db
    .select({ currency: exchangeRates.currency })
    .from(exchangeRates)
    .groupBy(exchangeRates.currency)
    .orderBy(asc(exchangeRates.currency));

  const rows: ExchangeRateHistoryRow[] = storedRows.map((row) => ({
    id: row.id,
    source: row.source,
    date: row.date,
    currency: row.currency,
    officialRate: row.officialRate,
    nonCashBuyRate: row.nonCashBuyRate,
    nonCashSellRate: row.nonCashSellRate,
    cashBuyRate: row.cashBuyRate,
    cashSellRate: row.cashSellRate,
    sourceUrl: row.sourceUrl,
    fetchedAt: row.fetchedAt,
  }));

  return (
    <ExchangeRateHistoryView
      key={`${from}:${to}:${currency}:${source}`}
      from={from}
      to={to}
      currency={currency}
      source={source}
      rows={rows}
      coverage={coverage}
      currencies={currencyRows.map((row) => row.currency)}
      truncated={rows.length >= ROW_LIMIT}
    />
  );
}

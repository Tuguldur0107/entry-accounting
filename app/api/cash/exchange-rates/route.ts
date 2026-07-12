import { auth } from "@/lib/auth";
import {
  fetchGolomtRates,
  fetchMongolbankRates,
  fetchTdbRates,
  type ExchangeRateQuote,
} from "@/lib/cash/exchange-rates";

export const runtime = "nodejs";

const DEFAULT_CURRENCIES = ["USD", "EUR", "CNY", "RUB", "JPY", "GBP", "KRW"];

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return Response.json({ error: "Нэвтрэх шаардлагатай" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return Response.json({ error: "Ханшийн огноо буруу" }, { status: 400 });

  const requested = (searchParams.get("currencies") ?? "")
    .split(",")
    .map((currency) => currency.trim().toUpperCase())
    .filter((currency) => /^[A-Z]{3}$/.test(currency) && currency !== "MNT");
  const currencies = [...new Set(requested.length ? requested : DEFAULT_CURRENCIES)];
  const sourceFilter = searchParams.get("source");
  if (
    sourceFilter &&
    !["mongolbank", "tdb", "golomt"].includes(sourceFilter)
  )
    return Response.json({ error: "Ханшийн эх сурвалж буруу" }, { status: 400 });

  const sources = [
    {
      key: "mongolbank",
      name: "Монголбанк",
      load: () => fetchMongolbankRates(date, currencies),
    },
    {
      key: "tdb",
      name: "Худалдаа, хөгжлийн банк",
      load: () => fetchTdbRates(date, currencies),
    },
    {
      key: "golomt",
      name: "Голомт банк",
      load: () => fetchGolomtRates(date, currencies),
    },
  ].filter((source) => !sourceFilter || source.key === sourceFilter);
  const settled = await Promise.allSettled(sources.map((source) => source.load()));
  const quotes: ExchangeRateQuote[] = [];
  const errors: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      quotes.push(...result.value);
      if (result.value.length === 0)
        errors.push(`${sources[index].name}: ханш олдсонгүй`);
    } else {
      errors.push(`${sources[index].name}: мэдээлэл татаж чадсангүй`);
    }
  });

  const fetchedAt = new Date().toISOString();
  return Response.json(
    {
      quotes: quotes.map((quote) => ({ ...quote, fetchedAt })),
      errors,
      fetchedAt,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=300",
      },
    }
  );
}

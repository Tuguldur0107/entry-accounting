// Монголбанкны албан ханшийн ЦЭВЭР логик (сүлжээнд хандахгүй).
// docs/procurement §3.5: системийн суурь ханш = МБ-ны албан ханш огноогоор;
// амралтын өдөр бол өмнөх ажлын өдрийн ханш; олдохгүй бол ҮНЭ ЗОХИОХГҮЙ.

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseMongolbankHistory,
  parseMongolbankRates,
  pickOfficialRate,
  type ExchangeRateQuote,
} from "../lib/cash/exchange-rates";

const PAYLOAD = {
  success: true,
  data: [
    { RATE_DATE: "2026-09-04", USD: "3,445.00", CNY: "482.10" },
    { RATE_DATE: "2026-09-05", USD: "3,450.00", CNY: "483.00" },
    // asOf-оос ХОЙШХИ мөр — хэрэглэгдэхгүй.
    { RATE_DATE: "2026-09-09", USD: "3,470.00", CNY: "484.00" },
  ],
};

test("амралтын өдөр — өмнөх ажлын өдрийн албан ханш сонгогдоно", () => {
  // 2026-09-06 = Ням гараг: МБ мөр байхгүй тул 09-05-ны ханш.
  const quotes = parseMongolbankRates(PAYLOAD, ["USD"], "2026-09-06");
  const picked = pickOfficialRate(quotes, "USD");
  assert.ok(picked);
  assert.equal(picked.rate, 3450);
  assert.equal(picked.rateDate, "2026-09-05");
  assert.match(picked.sourceUrl, /mongolbank\.mn/);
});

test("хүссэн огнооны ханш байвал тэр өдрийнх нь авна", () => {
  const picked = pickOfficialRate(
    parseMongolbankRates(PAYLOAD, ["USD"], "2026-09-04"),
    "USD"
  );
  assert.ok(picked);
  assert.equal(picked.rate, 3445);
  assert.equal(picked.rateDate, "2026-09-04");
});

test("валют жагсаалтад алга бол null (гар ханш шаардана)", () => {
  const quotes = parseMongolbankRates(PAYLOAD, ["USD"], "2026-09-06");
  assert.equal(pickOfficialRate(quotes, "EUR"), null);
});

test("МБ-нд тухайн валютын ханш байхгүй бол quote ч үүсэхгүй", () => {
  const quotes = parseMongolbankRates(PAYLOAD, ["EUR"], "2026-09-06");
  assert.deepEqual(quotes, []);
  assert.equal(pickOfficialRate(quotes, "EUR"), null);
});

test("валютын код том/жижиг үсгээр таарна", () => {
  const quotes = parseMongolbankRates(PAYLOAD, ["CNY"], "2026-09-06");
  assert.equal(pickOfficialRate(quotes, " cny ")?.rate, 483);
});

test("арилжааны банкны quote-ыг албан ханшид тооцохгүй", () => {
  const tdbQuote: ExchangeRateQuote = {
    id: "tdb-2026-09-05-USD",
    source: "tdb",
    sourceName: "Худалдаа, хөгжлийн банк",
    sourceType: "commercial",
    sourceUrl: "https://acs.tdbm.mn/mn/exchange",
    date: "2026-09-05",
    currency: "USD",
    officialRate: 3450,
    nonCashBuyRate: 3448,
    nonCashSellRate: 3455,
    cashBuyRate: 3445,
    cashSellRate: 3460,
  };
  assert.equal(pickOfficialRate([tdbQuote], "USD"), null);
});

test("албан ханш хоосон quote-ыг сонгохгүй", () => {
  const emptyOfficial: ExchangeRateQuote = {
    id: "mongolbank-2026-09-05-USD",
    source: "mongolbank",
    sourceName: "Монголбанк",
    sourceType: "central",
    sourceUrl: "https://www.mongolbank.mn/mn/currency-rates",
    date: "2026-09-05",
    currency: "USD",
    officialRate: null,
    nonCashBuyRate: 3448,
    nonCashSellRate: 3455,
    cashBuyRate: null,
    cashSellRate: null,
  };
  assert.equal(pickOfficialRate([emptyOfficial], "USD"), null);
});

// ─── Түүх татах (parseMongolbankHistory) ─────────────────────────────────────
//
// `parseMongolbankRates` нь НЭГ өдрийн (сүүлийн хүчинтэй) ханш өгдөг бол
// `parseMongolbankHistory` нь мужийн ӨДӨР БҮРИЙГ хадгалахад бэлдэнэ.

const HISTORY = {
  success: true,
  data: [
    { RATE_DATE: "2026-09-05", USD: "3,450.00", CNY: "483.00", EUR: "4,010.5" },
    // Ням гараг — МБ давтан нийтэлдэг; түүхэнд мөрөөрөө орно.
    { RATE_DATE: "2026-09-04", USD: "3,445.00", CNY: "482.10" },
  ],
};

test("түүх: өдөр БҮРИЙН мөр quote болно (сүүлийнх нь биш)", () => {
  const quotes = parseMongolbankHistory(HISTORY, ["USD"]);
  assert.deepEqual(
    quotes.map((quote) => [quote.date, quote.officialRate]),
    [
      ["2026-09-04", 3445],
      ["2026-09-05", 3450],
    ]
  );
  assert.ok(quotes.every((quote) => quote.source === "mongolbank"));
  assert.ok(quotes.every((quote) => quote.currency === "USD"));
});

test("түүх: таслалтай текст тоо болж хөрвөнө", () => {
  const [first] = parseMongolbankHistory(HISTORY, ["EUR"]);
  assert.equal(first.date, "2026-09-05");
  assert.equal(first.officialRate, 4010.5);
});

test("түүх: мөрөнд байхгүй валютаар quote үүсэхгүй", () => {
  // EUR нь зөвхөн 09-05-нд бий — 09-04-ний мөр алгасагдана.
  const quotes = parseMongolbankHistory(HISTORY, ["USD", "EUR"]);
  assert.equal(quotes.filter((quote) => quote.currency === "EUR").length, 1);
  assert.equal(quotes.filter((quote) => quote.currency === "USD").length, 2);
  assert.deepEqual(parseMongolbankHistory(HISTORY, ["JPY"]), []);
});

test("түүх: валют өгөөгүй бол мөрөнд байгаа БҮХ хүчинтэй валют орно", () => {
  const quotes = parseMongolbankHistory(HISTORY);
  assert.deepEqual(
    quotes.map((quote) => `${quote.date} ${quote.currency}`),
    [
      "2026-09-04 CNY",
      "2026-09-04 USD",
      "2026-09-05 CNY",
      "2026-09-05 EUR",
      "2026-09-05 USD",
    ]
  );
});

test("түүх: буруу мөр, буруу утга чимээгүй алгасагдана (ханш зохиогдохгүй)", () => {
  const quotes = parseMongolbankHistory({
    data: [
      // Огноогүй мөр.
      { USD: "3,500.00" },
      // Огноо гажиг.
      { RATE_DATE: "05/09/2026", USD: "3,500.00" },
      // Тоо биш / тэг / сөрөг утга.
      { RATE_DATE: "2026-09-07", USD: "-", CNY: "0", EUR: "-4,010.5" },
      // Валют биш багана, timestamp-тай огноо.
      { RATE_DATE: "2026-09-08T00:00:00", ID: "77", USDX: "1", USD: "3,460" },
    ],
  });
  assert.deepEqual(
    quotes.map((quote) => [quote.date, quote.currency, quote.officialRate]),
    [["2026-09-08", "USD", 3460]]
  );
});

test("түүх: хоосон хариунаас quote гарахгүй", () => {
  assert.deepEqual(parseMongolbankHistory({}), []);
  assert.deepEqual(parseMongolbankHistory({ success: true, data: [] }), []);
});

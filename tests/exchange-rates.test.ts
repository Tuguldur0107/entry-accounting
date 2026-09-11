// Монголбанкны албан ханшийн ЦЭВЭР логик (сүлжээнд хандахгүй).
// docs/procurement §3.5: системийн суурь ханш = МБ-ны албан ханш огноогоор;
// амралтын өдөр бол өмнөх ажлын өдрийн ханш; олдохгүй бол ҮНЭ ЗОХИОХГҮЙ.

import test from "node:test";
import assert from "node:assert/strict";

import {
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

// Ханшийн агуулахын ЦЭВЭР логик (DB-д ч сүлжээнд ч хандахгүй).
// `pickLatestOnOrBefore` нь "тухайн огнооны ханш" сонголтын гол дүрэм:
// амралтын өдөр / баярын өдөр Монголбанк ханш нийтэлдэггүй тул ӨМНӨХ
// ажлын өдрийн ханш хэрэглэгдэнэ. Олдохгүй бол null — ханш ЗОХИОХГҮЙ.

import test from "node:test";
import assert from "node:assert/strict";

import { pickLatestOnOrBefore } from "../lib/cash/rate-store";

const ROWS = [
  { date: "2026-09-03", rate: 3440 },
  { date: "2026-09-04", rate: 3445 },
  { date: "2026-09-07", rate: 3455 },
];

test("амралтын өдөр — өмнөх ажлын өдрийн мөр сонгогдоно", () => {
  // 2026-09-06 = Ням гараг: 09-05, 09-06 мөр байхгүй тул 09-04.
  assert.deepEqual(pickLatestOnOrBefore(ROWS, "2026-09-06"), {
    date: "2026-09-04",
    rate: 3445,
  });
});

test("яг тэр өдрийн мөр байвал түүнийг авна", () => {
  assert.deepEqual(pickLatestOnOrBefore(ROWS, "2026-09-07"), {
    date: "2026-09-07",
    rate: 3455,
  });
});

test("дараалал холилдсон ч хамгийн сүүлийнх нь гарна", () => {
  const shuffled = [ROWS[2], ROWS[0], ROWS[1]];
  assert.equal(pickLatestOnOrBefore(shuffled, "2026-09-30")?.date, "2026-09-07");
});

test("хүссэн огноо бүх мөрөөс ӨМНӨ бол null (өмнөх үеийн ханш алга)", () => {
  assert.equal(pickLatestOnOrBefore(ROWS, "2026-09-02"), null);
});

test("хоосон жагсаалт → null", () => {
  assert.equal(pickLatestOnOrBefore([], "2026-09-06"), null);
});

test("гажиг огноотой мөр үл тоомсорлогдоно", () => {
  const rows = [
    { date: "05/09/2026", rate: 9999 },
    { date: "", rate: 9999 },
    { date: "2026-09-04", rate: 3445 },
  ];
  assert.deepEqual(pickLatestOnOrBefore(rows, "2026-09-06"), {
    date: "2026-09-04",
    rate: 3445,
  });
});

test("хайх огноо гажиг бол null (таамаглахгүй)", () => {
  assert.equal(pickLatestOnOrBefore(ROWS, "2026-9-6"), null);
  assert.equal(pickLatestOnOrBefore(ROWS, ""), null);
});

test("сар/жилийн хил дамжсан ч мөрийн эрэмбэ зөв", () => {
  const rows = [
    { date: "2025-12-31", rate: 3400 },
    { date: "2026-01-02", rate: 3410 },
  ];
  assert.equal(pickLatestOnOrBefore(rows, "2026-01-01")?.date, "2025-12-31");
  assert.equal(pickLatestOnOrBefore(rows, "2026-01-05")?.date, "2026-01-02");
});

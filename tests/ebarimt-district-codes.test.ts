import test from "node:test";
import assert from "node:assert/strict";

import {
  districtLabel,
  EBARIMT_DISTRICTS,
  findDistrict,
  normalizeDistrictEntries,
} from "../lib/ebarimt/district-codes";

test("албан лавлах: бүх код 4 оронтой, давхардалгүй, эрэмбэлэгдсэн", () => {
  assert.ok(EBARIMT_DISTRICTS.length > 500);
  const codes = EBARIMT_DISTRICTS.map((entry) => entry.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.match(code, /^\d{4}$/);
  assert.deepEqual([...codes].sort(), codes);
});

test("код = аймаг/дүүрэг (2) + сум/хороо (2) — андуурч болох хоёр кодыг ялгана", () => {
  assert.equal(districtLabel("2403"), "Баянзүрх · 3-р хороо");
  assert.equal(districtLabel("3505"), "Чингэлтэй · 5-р хороо");
  assert.equal(findDistrict(" 2403 ")?.district, "Баянзүрх");
});

test("жагсаалтад байхгүй кодыг зохиохгүй — null", () => {
  assert.equal(districtLabel("9999"), null);
  assert.equal(districtLabel(""), null);
});

test("гажиг мөрийг алгасна, давхардлаас эхнийх нь", () => {
  const list = normalizeDistrictEntries([
    { code: "2403", district: "Баянзүрх", khoroo: "3-р хороо" },
    { code: "2403", district: "Давхар", khoroo: "x" },
    { code: "24", district: "Баянзүрх", khoroo: "" },
    null,
    "2405",
    { code: "12345", district: "a", khoroo: "b" },
  ]);
  assert.deepEqual(list, [{ code: "2403", district: "Баянзүрх", khoroo: "3-р хороо" }]);
  assert.equal(districtLabel("2403", list), "Баянзүрх · 3-р хороо");
});

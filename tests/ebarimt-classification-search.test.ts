// eBarimt ангиллын кодын (7 орон) хайлт — ЦЭВЭР тест. Жишээ нэрс нь ТЕСТИЙН
// өгөгдөл (албан жагсаалт биш) — зөвхөн эрэмбэ/шүүлтийн дүрмийг шалгана.

import test from "node:test";
import assert from "node:assert/strict";

import {
  classificationName,
  mergeClassificationMatches,
  normalizeClassificationEntries,
  searchClassifications,
} from "../lib/ebarimt/classification-search";

const ENTRIES = normalizeClassificationEntries([
  { code: "6331000", name: "Ресторанаар хоол үйлчлэх" },
  { code: "6331100", name: "Түргэн хоолны үйлчилгээ" },
  { code: "2399990", name: "Бусад хүнсний бүтээгдэхүүн" },
  { code: "2399990", name: "Давхардсан (алгасна)" },
  { code: "12345", name: "Богино (алгасна)" },
  { code: "1111111", name: "  " },
]);

test("цэвэрлэгээ: 7 оронтой, нэртэй, давхардалгүй, кодоор эрэмбэлсэн", () => {
  assert.deepEqual(
    ENTRIES.map((entry) => entry.code),
    ["2399990", "6331000", "6331100"]
  );
  assert.equal(classificationName(ENTRIES, "2399990"), "Бусад хүнсний бүтээгдэхүүн");
  assert.equal(classificationName(ENTRIES, "0000000"), null);
});

test("хайлт: яг код → кодын эхлэл → нэр", () => {
  assert.deepEqual(searchClassifications(ENTRIES, "6331000").map((e) => e.code), ["6331000"]);
  assert.deepEqual(searchClassifications(ENTRIES, "6331").map((e) => e.code), ["6331000", "6331100"]);
  assert.deepEqual(searchClassifications(ENTRIES, "ХООЛ").map((e) => e.code), ["6331000", "6331100"]);
  assert.deepEqual(searchClassifications(ENTRIES, "түргэн хоол").map((e) => e.code), ["6331100"]);
  assert.equal(searchClassifications(ENTRIES, "").length, 3);
  assert.equal(searchClassifications(ENTRIES, "", 2).length, 2);
});

test("байгууллагын хэрэглэж буй код нэмэгдэнэ, албан нэр давамгайлна", () => {
  const merged = mergeClassificationMatches(
    searchClassifications(ENTRIES, ""),
    [
      { code: "2399990", usage: "3 бараа" },
      { code: "9999999", usage: "«Бусад» ангилал" },
      { code: "bad", usage: "алгасна" },
    ],
    ""
  );
  const known = merged.find((entry) => entry.code === "2399990")!;
  assert.equal(known.source, "official");
  assert.equal(known.usage, "3 бараа");
  const unknown = merged.find((entry) => entry.code === "9999999")!;
  assert.equal(unknown.source, "org");
  assert.match(unknown.name, /жагсаалтад алга/);
  assert.equal(merged.some((entry) => entry.code === "bad"), false);
});

test("хоосон албан жагсаалттай ч байгууллагын код хайгдана", () => {
  const merged = mergeClassificationMatches([], [{ code: "6331000", usage: "«Ресторан» ангилал" }], "ресторан");
  assert.deepEqual(merged.map((entry) => entry.code), ["6331000"]);
  assert.deepEqual(mergeClassificationMatches([], [{ code: "6331000", usage: "x" }], "zzz"), []);
});

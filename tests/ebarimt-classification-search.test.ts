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

test("хайлтын эрэмбэ: нэрийн эхлэл → үгийн эхлэл → дэд мөр («ус» ≠ «Бусад»)", () => {
  const entries = normalizeClassificationEntries([
    { code: "0111200", name: "Бусад төрлийн улаан буудай" },
    { code: "2441030", name: "Хийжүүлсэн ус" },
    { code: "2441010", name: "Ус, рашаан" },
    { code: "0132100", name: "Бэрсүүт жүрж" },
    { code: "2211000", name: "Сүү, боловсруулсан" },
  ]);
  assert.deepEqual(searchClassifications(entries, "ус").map((e) => e.code), ["2441010", "2441030", "0111200"]);
  assert.deepEqual(searchClassifications(entries, "сүү").map((e) => e.code), ["2211000", "0132100"]);
});

test("АЛБАН жагсаалт (ҮСХ БҮНА PDF-ээс): бүрэн, 7 оронтой, давхардалгүй, нэртэй", async () => {
  const { EBARIMT_CLASSIFICATIONS } = await import("../lib/ebarimt/classification-codes");
  // scripts/extract-buna-pdf.py-ийн гаралт — 3500 мөр, эх баримтад давхардсан 1 код
  assert.equal(EBARIMT_CLASSIFICATIONS.length, 3499);
  assert.ok(EBARIMT_CLASSIFICATIONS.every((e) => /^\d{7}$/.test(e.code) && e.name.length > 0));
  // тэргүүлэх 0 хадгалагдсан (Excel хөрвүүлэлтэд алдагддаг) + олон мөрт нэр бүтэн
  assert.equal(classificationName(EBARIMT_CLASSIFICATIONS, "0111100"), "Улаан буудайн үр");
  assert.equal(classificationName(EBARIMT_CLASSIFICATIONS, "0411900"), "Бусад төрлийн амьд загас");
  assert.match(classificationName(EBARIMT_CLASSIFICATIONS, "0192200") ?? "", /рами\)-наас бусад төрлийн\)$/);
  assert.equal(classificationName(EBARIMT_CLASSIFICATIONS, "6331000"), "Рестораны бүрэн үйлчилгээтэй хоол, ундаар үйлчлэх үйлчилгээ");
  // PDF-ийн глифийн задрал («т өрлийн») нийлсэн
  assert.ok(!EBARIMT_CLASSIFICATIONS.some((e) => /(^| )[бвгджзклмнпрстфхцчшщ] [үө]/.test(e.name)));
});

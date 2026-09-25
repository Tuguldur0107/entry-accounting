// SIM2-029: «Харилцах GL данс» талбарт «4100», «Эздийн» гэж бичихэд санал гарна.
import test from "node:test";
import assert from "node:assert/strict";

import { suggestAccounts } from "../lib/grid/account-search";

const OPTIONS = [
  { code: "41000001", name: "Эздийн өмч" },
  { code: "41100000", name: "Хувь эзэмшигчдийн өмч" },
  { code: "44000001", name: "Хуримтлагдсан ашиг" },
  { code: "73100002", name: "Түрээсийн зардал" },
  { code: "11000001", name: "Харилцахад байгаа бэлэн мөнгө MNT" },
];

test("кодын угтвараар", () => {
  assert.deepEqual(suggestAccounts(OPTIONS, "4100").map((o) => o.code), ["41000001"]);
  assert.deepEqual(suggestAccounts(OPTIONS, "41").map((o) => o.code), ["41000001", "41100000"]);
});

test("нэрээр (үгийн эхлэл түрүүлнэ, том/жижиг үсэг хамаагүй)", () => {
  assert.deepEqual(suggestAccounts(OPTIONS, "Эздийн").map((o) => o.code), ["41000001"]);
  assert.deepEqual(suggestAccounts(OPTIONS, "түрээс").map((o) => o.code), ["73100002"]);
  assert.deepEqual(suggestAccounts(OPTIONS, "өмч").map((o) => o.code), ["41000001", "41100000"]);
});

test("хоосон эсвэл сегментчилсэн код — санал алга; limit", () => {
  assert.deepEqual(suggestAccounts(OPTIONS, "  "), []);
  assert.deepEqual(suggestAccounts(OPTIONS, "100.41000001"), []);
  assert.equal(suggestAccounts(OPTIONS, "0", 2).length, 2);
});

test("SIM2-035: стандарт chart-д ЖДҮ-ийн зардлын данс (73100002 түрээс …) бий", async () => {
  const { STANDARD_ACCOUNTS } = await import("../lib/constants/standard-accounts");
  const numbers = new Set(STANDARD_ACCOUNTS.map((account) => account.number));
  for (let n = 2; n <= 16; n += 1) assert.ok(numbers.has(`731000${String(n).padStart(2, "0")}`), `7310000${n}`);
  // D: түрээсийн нэхэмжлэхэд «түрээс» гэж хайхад олдоно
  assert.equal(
    suggestAccounts(STANDARD_ACCOUNTS.map((a) => ({ code: a.number, name: a.name })), "түрээс")[0]?.code,
    "73100002"
  );
});

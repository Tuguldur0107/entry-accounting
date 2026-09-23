// ENT-004: нэвтрүүлэлтийн загвар/баримтын дансны дугаар стандарт модонд
// (lib/constants/standard-accounts.ts) БАЙХ ёстой — байхгүй дугаар (14110000,
// 11210000) иш татсан загвараар оруулсан харилцагч дахин данс үүсгэдэг байв.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { STANDARD_ACCOUNTS } from "../lib/constants/standard-accounts";

const KNOWN = new Set(STANDARD_ACCOUNTS.map((account) => account.number));
const DIR = "docs/deployment/master-data";

/** CSV-ийн дансны багануудын утга. */
function csvAccountCodes(file: string, columns: string[]): string[] {
  const [header, ...rows] = readFileSync(`${DIR}/${file}`, "utf8").trim().split("\n");
  const names = header.split(",");
  const indexes = columns.map((column) => names.indexOf(column)).filter((index) => index >= 0);
  assert.equal(indexes.length, columns.length, `${file}: багана олдсонгүй`);
  return rows.flatMap((row) => indexes.map((index) => row.split(",")[index]).filter(Boolean));
}

test("master-data загварын дансууд стандарт модонд байна", () => {
  const codes = [
    ...csvAccountCodes("01-gl-accounts.csv", ["number"]),
    ...csvAccountCodes("05-cash-accounts.csv", ["glAccount"]),
    ...csvAccountCodes("07-fixed-assets.csv", ["assetAccountNumber", "accumDepAccountNumber", "depExpenseAccountNumber"]),
    ...csvAccountCodes("08-opening-balances.csv", ["account"]),
  ];
  const missing = [...new Set(codes)].filter((code) => !KNOWN.has(code));
  assert.deepEqual(missing, []);
});

test("баримт/skill/system prompt-д хуучин дугаар (11210000, 14110000, 41100000) үлдээгүй", () => {
  for (const file of [
    `${DIR}/README.md`,
    "docs/deployment/onboarding.md",
    ".claude/skills/master-data-import/SKILL.md",
    "lib/ai/system-prompt.ts",
  ]) {
    const text = readFileSync(file, "utf8");
    for (const legacy of ["11210000", "14110000", "41100000"])
      assert.ok(!text.includes(legacy), `${file}: ${legacy}`);
  }
});

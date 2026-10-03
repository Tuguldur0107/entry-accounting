// Ontology-ийн объектын төлвийг ШУУД бичих газрууд — ЗӨВХӨН БАГАСДАГ жагсаалт
// (docs/ontology-audit.md §6.5, P2 → P3).
//
// P3-д шилжилт бүр `lib/ontology/engine.ts`-ийн нөхцөлтэй бичилтээр явна. Тэр
// хүртэл одоо байгаа `.update(<table>).set({ status: … })` бичилтүүдийг файл бүрээр
// тоолж түгжинэ:
//   • тоо ӨСВӨЛ тест унана — шинэ шилжилтийг ЭХЛЭЭД lib/ontology/objects/*-д
//     бүртгэж (describe_ontology, drift тест), тоог энд PR-д ИЛ өсгөнө;
//   • тоо БУУРВАЛ (engine руу шилжүүлсэн, код устгасан) мөн унана — жагсаалтыг
//     бодит тоо руу БУУЛГАНА, эс бөгөөс ирээдүйн нэмэлт тоонд нуугдана.
// Бичилтийн утга бүртгэлтэй төлөв эсэхийг tests/ontology-registry.test.ts шалгана.
// DB шаардахгүй.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "../lib/db/schema";
import { ONTOLOGY_OBJECTS } from "../lib/ontology";

/** файл → ontology объектын хүснэгтэд `status` бичдэг `.set({…})`-ийн тоо. */
const KNOWN_DIRECT_STATUS_WRITES: Record<string, number> = {
  // 2026-10-03 (P2 эхлэл): 16 файл, 47 бичилт; + бараа, хүлээн авалт, өртөг, ҮХ, элэгдэл: 17 файл, 63.
  "lib/actions/arap-advances.ts": 1,
  "lib/actions/arap-ecl.ts": 4,
  "lib/actions/arap.ts": 6,
  "lib/actions/cash.ts": 8,
  "lib/actions/costing.ts": 3,
  "lib/actions/fa.ts": 12,
  "lib/actions/gl.ts": 2,
  "lib/actions/inventory.ts": 2,
  "lib/actions/pos.ts": 2,
  "lib/actions/procurement.ts": 9,
  "lib/actions/qpay.ts": 1,
  "lib/arap/credit-note-db.ts": 2,
  "lib/cash/import-statement.ts": 1,
  "lib/gl/reverse-voucher.ts": 1,
  "lib/qpay/arap.ts": 3,
  "lib/qpay/refund.ts": 1,
  "lib/qpay/store.ts": 5,
};

const objectExports = new Set(
  Object.entries(schema)
    .filter(([, value]) => is(value, PgTable) && ONTOLOGY_OBJECTS.some((object) => object.table === getTableConfig(value as PgTable).name))
    .map(([name]) => name)
);

function libFiles(dir = "lib"): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return path === join("lib", "ontology") ? [] : libFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** `{` дээрээс эхэлсэн объект литералын төгсгөл (мөр/шаблон доторх хаалт алгасна). */
function objectLiteral(source: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return source.slice(open, index + 1);
  }
  return source.slice(open);
}

/** Объект литералын ДЭЭД түвшинд `status` түлхүүр байгаа эсэх. */
function hasTopLevelStatus(literal: string): boolean {
  let depth = 0;
  for (let index = 0; index < literal.length; index += 1) {
    const char = literal[index];
    if (char === "{" || char === "(" || char === "[") depth += 1;
    else if (char === "}" || char === ")" || char === "]") depth -= 1;
    else if (depth === 1 && /[\s,{]/.test(literal[index - 1] ?? "") && /^status\s*[:,}]/.test(literal.slice(index))) return true;
  }
  return false;
}

function countStatusWrites(source: string): number {
  let count = 0;
  for (const match of source.matchAll(/\.update\(\s*(\w+)\s*\)\s*\.set\(\s*\{/g)) {
    if (!objectExports.has(match[1])) continue;
    const open = match.index! + match[0].length - 1;
    if (hasTopLevelStatus(objectLiteral(source, open))) count += 1;
  }
  return count;
}

test("тоолуур: дээд түвшний status-ийг л тоолно", () => {
  assert.equal(countStatusWrites(`tx.update(cashDocuments).set({ status: "posted", voucherId })`), 1);
  assert.equal(countStatusWrites(`db.update(arApDocuments)\n  .set({ paidAmount: sql\`\${a} + 1\`, status })`), 1);
  assert.equal(countStatusWrites(`db.update(arApDocuments).set({ meta: { status: "x" }, paidAmount: 1 })`), 0);
  assert.equal(countStatusWrites(`db.update(users).set({ status: "x" })`), 0);
});

test("ontology объектын төлвийг шууд бичих газар нэмэгдээгүй (зөвхөн багасна)", () => {
  const actual: Record<string, number> = {};
  for (const file of libFiles()) {
    const count = countStatusWrites(readFileSync(file, "utf8"));
    if (count > 0) actual[file] = count;
  }
  const grown = Object.entries(actual).filter(([file, count]) => count > (KNOWN_DIRECT_STATUS_WRITES[file] ?? 0));
  assert.deepEqual(
    grown,
    [],
    "Шинэ шууд төлвийн бичилт — шилжилтийг lib/ontology/objects/*-д бүртгээд KNOWN_DIRECT_STATUS_WRITES-ийн тоог PR-д ил өсгөнө"
  );
  const shrunk = Object.entries(KNOWN_DIRECT_STATUS_WRITES).filter(([file, count]) => (actual[file] ?? 0) < count);
  assert.deepEqual(shrunk, [], "Бичилт багассан — KNOWN_DIRECT_STATUS_WRITES-ийг бодит тоо руу буулгана уу");
});

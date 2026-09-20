import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  REMOVED_COLUMNS,
  REMOVED_TABLES,
} from "../scripts/lib/removed-schema-objects.mjs";

// preDeploy нь `REMOVED_TABLES`-ийн хүснэгтийг `archive` схем рүү ЗӨӨДӨГ тул
// амьд хүснэгт санамсаргүй энд орвол production дээр тэр хүснэгт public-оос
// АЛГА болж систем бүхэлдээ унана. Мөн `REMOVED_COLUMNS`-ийн багана нь
// УСТГАГДДАГ. Иймд эдгээр нэр схемд ДАХИН амилаагүй эсэхийг статикаар барина.

const schema = readFileSync(
  new URL("../lib/db/schema.ts", import.meta.url),
  "utf8"
);

/** schema.ts-ийн `pgTable("нэр", { … })` блок бүрийн баганы нэрс. */
function schemaTables(source: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const header = /pgTable\(\s*"([a-z_0-9]+)"\s*,\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(source)) !== null) {
    let index = match.index + match[0].length;
    let depth = 1;
    while (index < source.length && depth > 0) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") depth -= 1;
      index += 1;
    }
    const body = source.slice(match.index + match[0].length, index);
    const columns = new Set(
      [...body.matchAll(/^\s*\w+:\s*\w+\(\s*"([a-z_0-9]+)"/gm)].map((m) => m[1])
    );
    tables.set(match[1], columns);
  }
  return tables;
}

const tables = schemaTables(schema);

test("schema.ts-ээс хүснэгтүүд танигдана (parser эрүүл)", () => {
  // Parser унавал доорх шалгалтууд ХУУРАМЧААР давах тул эхлээд өөрийг нь барина.
  assert.ok(tables.size > 50, `pgTable блок цөөхөн олдлоо: ${tables.size}`);
  assert.ok(tables.has("employees"));
  assert.ok(tables.get("employees")!.has("employer_si_percent"));
});

test("REMOVED_TABLES дахь хүснэгт схемд БАЙХГҮЙ (амьд хүснэгт архивлахгүй)", () => {
  for (const name of REMOVED_TABLES) {
    assert.ok(
      !tables.has(name),
      `"${name}" схемд ДАХИН нэмэгдсэн байна — REMOVED_TABLES-ээс хасахгүй бол ` +
        `preDeploy түүнийг archive схем рүү зөөж production-ийг унагана`
    );
  }
});

test("REMOVED_COLUMNS дахь багана схемд БАЙХГҮЙ (амьд багана устгахгүй)", () => {
  for (const { table, column } of REMOVED_COLUMNS) {
    const columns = tables.get(table);
    if (!columns) continue; // хүснэгт нь бүхэлдээ хасагдсан — асуудалгүй
    assert.ok(
      !columns.has(column),
      `${table}.${column} схемд ДАХИН нэмэгдсэн байна — REMOVED_COLUMNS-ээс ` +
        `хасахгүй бол preDeploy түүнийг устгана`
    );
  }
});

test("бүртгэлүүд цэгцтэй — давхардалгүй, хоосон биш", () => {
  assert.equal(new Set(REMOVED_TABLES).size, REMOVED_TABLES.length);
  const keys = REMOVED_COLUMNS.map((entry) => `${entry.table}.${entry.column}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const name of REMOVED_TABLES) assert.match(name, /^[a-z][a-z_0-9]*$/);
  for (const entry of REMOVED_COLUMNS) {
    assert.match(entry.table, /^[a-z][a-z_0-9]*$/);
    assert.match(entry.column, /^[a-z][a-z_0-9]*$/);
  }
});

test("migrate SQL нь зөвхөн public схемийн нэмэх/шинэчлэх алхамтай", () => {
  // Устгалт нь ЗӨВХӨН давталтын төгсгөлийн `drop column`-оор явна — migrate
  // дотор drop/truncate байвал санамсаргүй өгөгдөл алдана.
  for (const entry of REMOVED_COLUMNS) {
    for (const statement of entry.migrate ?? []) {
      assert.doesNotMatch(
        statement.toLowerCase(),
        /\b(drop|truncate|delete)\b/,
        `${entry.table}.${entry.column} migrate дотор устгах үйлдэл байна`
      );
    }
  }
});

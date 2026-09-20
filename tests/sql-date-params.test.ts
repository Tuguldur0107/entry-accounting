// Drizzle-ийн raw `sql\`…\`` template дотор JS Date-ийг ШУУД параметр болгож
// өгвөл postgres драйвер «The "string" argument must be of type string or
// Buffer… Received an instance of Date» гэж унадаг (2026-09-20: /api/health.qpay
// null, QPay тохиргооны таб production дээр уншигдахгүй байв). Дүрэм:
// `${date.toISOString()}::timestamptz` эсвэл drizzle operator (lt/gte…).
// Энэ тест `${<нэр>}` хэлбэрээр интерполяцилсан Date хувьсагчийг статикаар барина.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["lib", "app"];
const DATE_VAR = /const\s+(\w+)\s*=\s*new Date\(/g;

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

test("raw sql template-д Date хувьсагч шууд параметр болохгүй", () => {
  const offenders: string[] = [];
  for (const file of ROOTS.flatMap((root) => walk(root, []))) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("sql`") && !source.includes("sql<")) continue;
    const dateVars = [...source.matchAll(DATE_VAR)].map((m) => m[1]);
    for (const name of new Set(dateVars)) {
      // `${name}` дараа нь `.toISOString()` / `.getTime()` ЭСВЭЛ `::` cast байхгүй бол зөрчил.
      const bare = new RegExp("\\$\\{" + name + "\\}(?!::)", "g");
      for (const line of source.split("\n")) {
        if (/sql(<[^>]*>)?`/.test(line) && bare.test(line)) offenders.push(`${file}: ${line.trim().slice(0, 120)}`);
        bare.lastIndex = 0;
      }
    }
  }
  assert.deepEqual(offenders, []);
});

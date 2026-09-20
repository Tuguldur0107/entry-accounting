// RLS-ГҮЙ СОНГОЛТЫН ХАМГААЛАЛТ — статик шалгалт (docs/ai-logging.md §3).
//
// Энэ төсөлд PostgreSQL Row Level Security ашиглаагүй (одоогийн бүх модуль
// апп-ын түвшинд `getActiveOrg()`-оор scope авдаг; RLS-д шилжихийн тулд
// query бүрийг `SET LOCAL`-тай транзакцад боох хэрэгтэй болно). Улмаар
// tenant тусгаарлалт нь БҮХЭЛДЭЭ кодын сахилгаас хамаарна: нэг хөгжүүлэгч
// `organizationId` шүүлтгүй query бичихэд cross-tenant задрал үүснэ.
//
// Тиймээс `ai_suggestion_log` / `ai_suggestion_outcome` хоёрт хандах query
// ЗӨВХӨН `lib/ai-logging/service.ts`-д байна — тэнд функц бүр `AiLogScope`
// хүлээн авч WHERE-т `organizationId` ЗААВАЛ тавина.
//
// Энэ тест унавал: шинэ query-гээ service.ts дотор scope-той helper болгон
// нэмээд дуудагчаас түүнийг дууд (шууд `db.select(...)` бичихгүй).
//
// DATABASE_URL ШААРДАХГҮЙ — CI-ийн ҮНДСЭН жагсаалтад ажиллана.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["lib", "app", "components", "scripts", "custom"];

/** Хамгаалагдсан хүснэгтүүд — Drizzle-ийн нэр ба SQL-ийн нэр хоёулаа. */
const GUARDED = [
  "aiSuggestionLog",
  "aiSuggestionOutcome",
  "ai_suggestion_log",
  "ai_suggestion_outcome",
];

/**
 * Зөвшөөрөгдсөн зам:
 *  • lib/ai-logging/     — ЦОРЫН ГАНЦ бичих/унших давхарга
 *  • lib/db/schema.ts    — хүснэгтийн тодорхойлолт өөрөө
 *  • scripts/apply-pending-ddl.mjs — идемпотент DDL (migration)
 *  • scripts/lib/removed-schema-objects.mjs — хасагдсан объектын бүртгэл
 */
const ALLOWED = [
  join("lib", "ai-logging"),
  join("lib", "db", "schema.ts"),
  join("scripts", "apply-pending-ddl.mjs"),
  join("scripts", "lib", "removed-schema-objects.mjs"),
];

function walk(dir: string, out: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // хавтас байхгүй (custom/ хоосон fork) — алгасна
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function isAllowed(file: string): boolean {
  return ALLOWED.some((prefix) => file.startsWith(prefix));
}

test("AI бүртгэлийн хүснэгтэд ЗӨВХӨН lib/ai-logging/ хандана", () => {
  const offenders: string[] = [];
  for (const file of ROOTS.flatMap((root) => walk(root, []))) {
    if (isAllowed(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const table of GUARDED) {
      if (!source.includes(table)) continue;
      for (const [i, line] of source.split("\n").entries()) {
        if (!line.includes(table)) continue;
        // Тайлбар мөр нь зөрчил биш — дүрмийг баримтжуулахыг хориглохгүй.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "AI бүртгэлийн хүснэгтийг lib/ai-logging/-ээс ГАДНА хөндсөн байна —\n" +
      "scope-той helper болгон service.ts-д нэмнэ үү:\n" +
      offenders.join("\n")
  );
});

test("service.ts-ийн бичих/унших функц бүр scope параметртэй", () => {
  const source = readFileSync(join("lib", "ai-logging", "service.ts"), "utf8");
  // `export async function <нэр>(` мөрийн ДАРААХ мөр нь scope параметр байх.
  const exported = [
    ...source.matchAll(/export async function (\w+)\(\s*\n\s*([^\n,)]+)/g),
  ];
  assert.ok(exported.length >= 6, "экспортлогдсон функц хэт цөөн олдлоо");
  const missing = exported
    .filter(([, , firstParam]) => !/scope|event\b/.test(firstParam))
    .map(([, name]) => name);
  assert.deepEqual(
    missing,
    [],
    `эдгээр функц эхний параметрээрээ scope хүлээж авахгүй байна: ${missing.join(", ")}`
  );
});

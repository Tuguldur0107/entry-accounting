import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// SERVER component («use client»-гүй page/layout/route) нь `"use client"`
// модулиас ФУНКЦ / тогтмол импортлож ДУУДАХ боломжгүй. Төрөл нь compile-д
// арилдаг тул асуудалгүй; component нь props-оор рендерлэгддэг тул мөн зүгээр.
// Гэвч жирийн функц дуудвал Next.js ажиллах үед:
//   «Attempted to call isSalesView() from the server but isSalesView is on
//    the client.»
// гэж УНАНА — `tsc` ч, `next build` ч үүнийг барьдаггүй, зөвхөн тухайн хуудсыг
// нээхэд production дээр илэрдэг (2026-09-24: /inventory/reports?tab=sales
// Борлуулалтын таб ОГТ нээгдэхгүй байв).
//
// ХЭВ МАЯГ: цэвэр логик/тогтмолыг «use client»-гүй тусдаа модульд гаргаж
// (жишээ нь `lib/pos/report-views.ts`) хоёр тал хоёулаа импортлоно.

const ROOT = path.join(import.meta.dirname, "..");
const SOURCE_DIRS = ["app", "components", "lib"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SOURCE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
const sourceOf = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));

// «use client» нь файлын ЭХНИЙ мэдэгдэл — тэргүүлэх тайлбар (// … эсвэл /* … */)
// хоосон мөрийн дараа ч байж болно.
const isClientModule = (file: string) =>
  /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(["'])use client\1/.test(sourceOf.get(file) ?? "");

/** `@/lib/...` эсвэл `./`, `../` харьцангуй зам → бодит файл (олдвол). */
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ])
    if (sourceOf.has(candidate)) return candidate;
  return null;
}

/**
 * Импортын блокоос ЗӨВХӨН утгын (type биш) нэрсийг авна.
 * `import { A, type B, c as d }` → ["A", "d"].
 */
function valueBindings(block: string): string[] {
  return block
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("type "))
    .map((part) => {
      const alias = part.split(/\s+as\s+/);
      return (alias[1] ?? alias[0]).trim();
    })
    .filter(Boolean);
}

test("server модуль «use client» файлаас ФУНКЦ импортлож дууддаггүй", () => {
  const violations: string[] = [];

  for (const [file, source] of sourceOf) {
    if (isClientModule(file)) continue; // client → client зүгээр
    // `import { … }` ба `import Default, { … }` хоёулаа; `import type { … }`
    // блокийг бүхэлд нь алгасна. Default импорт нь component (Том үсэг) эсвэл
    // функц байж болно — нэрсийн жагсаалтад нэмнэ.
    const importRe =
      /import\s+(?!type\s)(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
    for (const match of source.matchAll(importRe)) {
      const target = resolveImport(file, match[3]);
      if (!target || !isClientModule(target)) continue;
      const names = [...(match[1] ? [match[1]] : []), ...valueBindings(match[2])];
      for (const name of names) {
        // Component (Том үсгээр эхэлсэн) нь рендерлэгдэнэ — дуудагдахгүй.
        if (/^[A-Z]/.test(name)) continue;
        // Тухайн нэрийг ҮНЭХЭЭР дуудаж байгаа эсэх (`name(`).
        if (!new RegExp(`\\b${name}\\s*\\(`).test(source)) continue;
        violations.push(
          `${path.relative(ROOT, file)} → ${name}() нь client модульд ` +
            `(${path.relative(ROOT, target)}) — цэвэр модульд гарга`
        );
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Server талаас client модулийн функц дуудаж байна:\n${violations.join("\n")}`
  );
});

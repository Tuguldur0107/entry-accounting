// Модулийн route guard-ийн статик тест.
//
// ШАЛТГААН (2026-09-20 SaaS/админ аудит): гишүүний модулийн эрх «Байхгүй»
// (none) байхад навигаци нуугддаг ч URL-ээр шууд орвол хуудас ачаалагдаж
// байсан — уншилтын loader-ууд getActiveOrg-оор л scope авдаг байв.
// Хамгаалалт нь модулийн ХАВТАС бүрийн layout.tsx дахь <ModuleGuard> —
// шинэ хуудас нэмэхэд автоматаар хамрагдана, харин шинэ МОДУЛИЙН хавтас
// нэмэхэд layout мартагдвал энэ тест унана.
//
// Дүрэм: app/(dashboard)/<хавтас> бүр (доорх жагсаалтын дагуу) ModuleGuard
// эсвэл RoleGuard-тай layout.tsx-тэй байна; guard-ийн moduleKeys нь
// lib/constants/app-modules.ts-ийн түлхүүр байна.

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { APP_MODULE_DEFS } from "../lib/constants/app-modules";

const DASHBOARD = "app/(dashboard)";

/** Хавтас → хүлээгдэх guard (модулийн түлхүүр эсвэл role). */
const EXPECTED: Record<string, { module?: string[]; role?: string }> = {
  gl: { module: ["gl"] },
  cash: { module: ["cash"] },
  receivables: { module: ["ar"] },
  payables: { module: ["ap"] },
  arap: { module: ["ar", "ap"] },
  inventory: { module: ["inv", "pos"] },
  "inventory/items": { module: ["inv"] },
  "inventory/movements": { module: ["inv"] },
  "inventory/counting": { module: ["inv"] },
  "inventory/reports": { module: ["inv"] },
  "inventory/pos": { module: ["pos"] },
  "inventory/sales": { module: ["pos"] },
  costing: { module: ["cost"] },
  procurement: { module: ["proc"] },
  fa: { module: ["fa"] },
  tax: { module: ["tax"] },
  payroll: { module: ["payroll"] },
  ai: { module: ["ai"] },
  admin: { role: "admin" },
  "settings/permissions": { role: "admin" },
};

/** Guard шаардахгүй хавтас — хувийн (мэдэгдэл), redirect, эсвэл бүх гишүүнд нээлттэй. */
const EXEMPT = new Set(["notifications", "close", "settings", "vat"]);

function guardOf(source: string): { module?: string[]; role?: string } | null {
  const role = source.match(/<RoleGuard\s+minRole="([a-z]+)"/);
  if (role) return { role: role[1] };
  const single = source.match(/<ModuleGuard\s+moduleKeys="([a-z]+)"/);
  if (single) return { module: [single[1]] };
  const many = source.match(/<ModuleGuard\s+moduleKeys=\{\[([^\]]+)\]\}/);
  if (many)
    return { module: many[1].split(",").map((k) => k.trim().replace(/"/g, "")) };
  return null;
}

test("модулийн хавтас бүр guard-тай layout.tsx-тэй", () => {
  const validKeys = new Set(APP_MODULE_DEFS.map((def) => def.key));
  for (const [dir, expected] of Object.entries(EXPECTED)) {
    const file = join(DASHBOARD, dir, "layout.tsx");
    assert.ok(existsSync(file), `${file} байхгүй — ModuleGuard/RoleGuard-тай layout нэмнэ үү`);
    const guard = guardOf(readFileSync(file, "utf8"));
    assert.ok(guard, `${file} guard-гүй (components/layout/access-guard.tsx)`);
    if (expected.role) assert.equal(guard.role, expected.role, file);
    if (expected.module) {
      assert.deepEqual(guard.module, expected.module, file);
      for (const key of guard.module)
        assert.ok(validKeys.has(key), `${file}: "${key}" нь app-modules.ts-д байхгүй түлхүүр`);
    }
  }
});

test("app/(dashboard)-ийн БҮХ дээд хавтас жагсаалтад эсвэл exempt-д бүртгэлтэй", () => {
  const dirs = readdirSync(DASHBOARD, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const unknown = dirs.filter((dir) => !(dir in EXPECTED) && !EXEMPT.has(dir));
  assert.deepEqual(
    unknown,
    [],
    `Шинэ модулийн хавтас: ${unknown.join(", ")} — tests/module-route-guards.test.ts-ийн EXPECTED-д guard-ыг нь бүртгэнэ үү`
  );
});

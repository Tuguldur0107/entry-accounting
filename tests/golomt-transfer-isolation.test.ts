// Голомтын гүйлгээ (CGWTXNADD) Entry-д ОРООГҮЙ гэдгийг сахиулна
// (CLAUDE.md §5f, docs/bank/00-payments-proposal.md): банкны хариу (Хавсралт 3, Q2)
// ирэх хүртэл гүйлгээний зам ЗӨВХӨН UAT-ийн тусдаа скриптэд
// (scripts/golomt-uat-transfer.ts) — апп, lib, component-д байхгүй.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOTS = ["app", "lib", "components", "custom"];
const FORBIDDEN = [/\/v1\/transaction\/cgw\/transfer/, /X-Golomt-Code/i, /golomt-uat-transfer/];

function files(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

test("гүйлгээний зам / X-Golomt-Code апп, lib, component-д алга", () => {
  const offenders = ROOTS.flatMap(files).filter((path) => {
    const source = readFileSync(path, "utf8");
    return FORBIDDEN.some((pattern) => pattern.test(source));
  });
  assert.deepEqual(offenders, []);
});

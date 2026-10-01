// AI/MCP/REST tool давхарга DB-д ШУУД бичихгүй — бичилт бүр эрх (requireModuleAction)
// ба аудит (logAuditEvent) бүхий server action-аар (CLAUDE.md §9a).
// 2026-10-01: update_counterparty нь db.update-ийг шууд дууддаг тул viewer ч
// нийлүүлэгчийн банкны дансыг сольж чаддаг байв (ontology-audit §4.2).
// Статик — DATABASE_URL ШААРДАХГҮЙ.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("lib/ai/tools.ts: db/tx-ийн insert/update/delete дуудлага алга", () => {
  const source = readFileSync("lib/ai/tools.ts", "utf8");
  const hits = source
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => !line.startsWith("//") && !line.startsWith("*"))
    .filter(({ line }) => /\b(db|tx)\s*\.\s*(insert|update|delete)\s*\(/.test(line) || /^\.(insert|update|delete)\(\s*[A-Za-z]+\s*\)/.test(line));
  assert.deepEqual(
    hits,
    [],
    `tool нь DB-г шууд бичиж байна — server action (эрх + аудит)-аар дуудна:\n${hits.map((hit) => `  L${hit.number}: ${hit.line}`).join("\n")}`
  );
});

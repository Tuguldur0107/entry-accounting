// eTax-ийн AI/MCP tool-ууд (docs/dev/etax.md §10): унших + ноорог бэлтгэх л —
// ТЕГ-д хадгалах/илгээх tool БАЙХГҮЙ ([HUMAN_REQUIRED], татварын тайлан = хүний гарын үсэг).
// Статик — DATABASE_URL ШААРДАХГҮЙ.
import assert from "node:assert/strict";
import { test } from "node:test";

import { AI_TOOLS, aiToolsForSurface } from "../lib/ai/tools";

const ETAX_TOOLS = ["get_etax_status", "list_etax_submissions", "prepare_etax_return", "refresh_etax_submission_status"];

test("eTax: 4 tool бүртгэлтэй, MCP ба REST хоёуланд", () => {
  for (const name of ETAX_TOOLS) {
    const tool = AI_TOOLS.find((t) => t.name === name);
    assert.ok(tool, name);
    assert.ok(aiToolsForSurface("mcp").some((t) => t.name === name), `${name} mcp`);
    assert.ok(aiToolsForSurface("rest").some((t) => t.name === name), `${name} rest`);
  }
});

test("eTax: ТЕГ-д хадгалах / илгээх / төлөв гараар солих tool байхгүй; бэлтгэх tool [HUMAN_REQUIRED]-ийг ил хэлнэ", () => {
  const names = AI_TOOLS.map((t) => t.name);
  for (const name of names) {
    if (!name.includes("etax")) continue;
    assert.ok(!/submit|save_.*to_tax|set_etax|mark_etax/.test(name), `${name} — ТЕГ рүү бичих tool ХОРИОТОЙ`);
  }
  const prepare = AI_TOOLS.find((t) => t.name === "prepare_etax_return")!;
  assert.match(prepare.description, /\[HUMAN_REQUIRED\]/);
  assert.match(prepare.description, /НООРОГ/);
  assert.deepEqual((prepare.inputSchema as { required: string[] }).required, ["form", "period"]);
  const formSchema = (prepare.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties.form;
  assert.deepEqual(formSchema.enum, ["vat", "pit", "cit"]);
});

test("eTax: унших tool-ууд ТЕГ рүү юу ч илгээдэггүй гэдгээ тайлбартаа хэлнэ", () => {
  const status = AI_TOOLS.find((t) => t.name === "get_etax_status")!;
  assert.match(status.description, /ЗӨВХӨН унших/);
  assert.match(status.description, /нууц буцахгүй/);
  const refresh = AI_TOOLS.find((t) => t.name === "refresh_etax_submission_status")!;
  assert.match(refresh.description, /юу ч илгээхгүй/);
});

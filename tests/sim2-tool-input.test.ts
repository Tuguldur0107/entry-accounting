// SIM2-016: tool-ийн required талбар дутуу үед талбарын нэртэй алдаа.
import test from "node:test";
import assert from "node:assert/strict";

import { toolInputProblem } from "../lib/ai/tool-input";
import { AI_TOOLS } from "../lib/ai/tools";

const schema = {
  type: "object",
  properties: { documentId: { type: "string", description: "Баримтын ID эсвэл дугаар (бүтэн/6+ тэмдэгт)" } },
  required: ["documentId"],
};

test("delete_cash_document documentId-гүй → «documentId шаардлагатай», JS алдаа биш", () => {
  assert.match(toolInputProblem(schema, {})!, /шаардлагатай талбар дутуу: documentId \(Баримтын ID эсвэл дугаар/);
  assert.match(toolInputProblem(schema, { documentId: "  " })!, /documentId/);
  assert.equal(toolInputProblem(schema, { documentId: "CM-25-000001" }), null);
  assert.match(toolInputProblem(schema, "abc")!, /объект/);
  assert.equal(toolInputProblem({ type: "object", properties: {} }, undefined), null);
});

test("бүх core tool-ийн required талбар schema-ийн properties-д зарлагдсан", () => {
  for (const tool of AI_TOOLS) {
    const inputSchema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    for (const field of inputSchema.required ?? [])
      assert.ok(inputSchema.properties?.[field], `${tool.name}.${field}`);
  }
});

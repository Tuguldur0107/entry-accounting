import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeCustomizations,
  validateCustomization,
} from "../lib/custom/validate";
import type { CustomTool, EntryCustomization } from "../lib/custom/types";

const CORE = ["create_journal_voucher", "list_counterparties"];

function tool(name: string, extra: Partial<CustomTool> = {}): CustomTool {
  return {
    name,
    description: "Туршилтын custom tool тайлбар",
    inputSchema: { type: "object", properties: {} },
    execute: async () => ({ resultText: "ok" }),
    ...extra,
  };
}

test("хоосон customization зөв", () => {
  assert.deepEqual(validateCustomization({}, CORE), []);
  assert.deepEqual(validateCustomization(mergeCustomizations(), CORE), []);
});

test("зөв tool + hooks алдаагүй", () => {
  const c: EntryCustomization = {
    tools: [tool("get_custom_report")],
    hooks: { beforeJournalPost: async () => ({ ok: true }) },
  };
  assert.deepEqual(validateCustomization(c, CORE), []);
});

test("core нэртэй давхцах, давхардсан, буруу хэлбэртэй нэр", () => {
  const errors = validateCustomization(
    { tools: [tool("create_journal_voucher"), tool("my_tool"), tool("my_tool"), tool("Bad-Name")] },
    CORE
  );
  assert.equal(errors.length, 3);
  assert.match(errors[0], /core tool/);
  assert.match(errors[1], /давхардсан/);
  assert.match(errors[2], /буруу/);
});

test("description, inputSchema, execute дутуу", () => {
  const broken = {
    name: "my_tool",
    description: "богино",
    inputSchema: { type: "array" },
  } as unknown as CustomTool;
  const errors = validateCustomization({ tools: [broken] }, CORE);
  assert.equal(errors.length, 3);
});

test("hook функц биш бол алдаа", () => {
  const c = { hooks: { afterJournalPost: "no" } } as unknown as EntryCustomization;
  assert.equal(validateCustomization(c, CORE).length, 1);
});

test("mergeCustomizations: before-hook эхний татгалзалд зогсоно, after дарааллаар", async () => {
  const calls: string[] = [];
  const a: EntryCustomization = {
    name: "a",
    tools: [tool("tool_a")],
    hooks: {
      beforeJournalPost: async () => {
        calls.push("a");
        return { ok: false, reason: "a татгалзав" };
      },
      afterJournalPost: async () => {
        calls.push("after-a");
      },
    },
  };
  const b: EntryCustomization = {
    name: "b",
    tools: [tool("tool_b")],
    hooks: {
      beforeJournalPost: async () => {
        calls.push("b");
        return { ok: true };
      },
      afterJournalPost: async () => {
        calls.push("after-b");
      },
    },
  };
  const merged = mergeCustomizations(a, b);
  assert.equal(merged.name, "a + b");
  assert.deepEqual(merged.tools?.map((t) => t.name), ["tool_a", "tool_b"]);
  const ctx = {
    orgId: "o",
    userId: "u",
    voucherId: "v",
    date: "2026-09-01",
    description: "",
    lines: [],
    totalDebit: 0,
    source: "post" as const,
  };
  const result = await merged.hooks!.beforeJournalPost!(ctx);
  assert.deepEqual(result, { ok: false, reason: "a татгалзав" });
  assert.deepEqual(calls, ["a"]);
  await merged.hooks!.afterJournalPost!(ctx);
  assert.deepEqual(calls, ["a", "after-a", "after-b"]);
  assert.equal(merged.hooks?.beforePeriodClose, undefined);
});

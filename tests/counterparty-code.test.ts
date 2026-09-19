import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCounterpartyCode } from "../lib/arap/counterparty-code";

test("код: зай тайрч, том үсэгт шилжүүлнэ; хоосон → null", () => {
  assert.equal(normalizeCounterpartyCode("  sup-042 "), "SUP-042");
  assert.equal(normalizeCounterpartyCode("10 001"), "10 001");
  assert.equal(normalizeCounterpartyCode(""), null);
  assert.equal(normalizeCounterpartyCode("   "), null);
  assert.equal(normalizeCounterpartyCode(undefined), null);
  assert.equal(normalizeCounterpartyCode(null), null);
});

test("код: 32 тэмдэгтээс урт бол шидэнэ", () => {
  assert.throws(() => normalizeCounterpartyCode("A".repeat(33)), /32/);
  assert.equal(normalizeCounterpartyCode("A".repeat(32)), "A".repeat(32));
});

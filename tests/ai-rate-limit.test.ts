import test from "node:test";
import assert from "node:assert/strict";

import { AI_RATE_LIMITS, aiToolRateKind, checkAiRateLimit } from "../lib/ai/rate-limit";

test("ENT-009: tool-ийн төрөл нэрээр", () => {
  assert.equal(aiToolRateKind("list_arap_documents"), "read");
  assert.equal(aiToolRateKind("get_trial_balance"), "read");
  assert.equal(aiToolRateKind("reconcile_modules"), "read");
  assert.equal(aiToolRateKind("create_arap_invoice"), "write");
  assert.equal(aiToolRateKind("pay_arap_document"), "write");
});

test("ENT-009: унших/бичих/чат тусдаа bucket, минутын цонх", () => {
  const user = `u-${Math.random()}`;
  const now = 1_000_000;
  for (let i = 0; i < AI_RATE_LIMITS.read; i += 1) assert.equal(checkAiRateLimit(user, "read", now), true);
  assert.equal(checkAiRateLimit(user, "read", now), false);
  // бичих, чат нь уншилтаас үл хамаарна
  assert.equal(checkAiRateLimit(user, "write", now), true);
  assert.equal(checkAiRateLimit(user, "chat", now), true);
  // 1 минутын дараа дахин нээгдэнэ
  assert.equal(checkAiRateLimit(user, "read", now + 60_001), true);
  assert.ok(AI_RATE_LIMITS.write > 10 && AI_RATE_LIMITS.read > AI_RATE_LIMITS.write);
});

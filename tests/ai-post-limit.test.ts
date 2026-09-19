import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AI_POST_LIMIT_TOOL_CEILING_MNT,
  currentAiPostLimit,
  DEFAULT_AI_POST_LIMIT_MNT,
  planAiPostLimitChange,
  resolveAiPostLimit,
  runWithAiPostLimit,
} from "../lib/ai/post-limit";

test("resolveAiPostLimit — хоосон / гажиг утга default рүү унана", () => {
  assert.equal(resolveAiPostLimit(null), DEFAULT_AI_POST_LIMIT_MNT);
  assert.equal(resolveAiPostLimit(undefined), DEFAULT_AI_POST_LIMIT_MNT);
  assert.equal(resolveAiPostLimit(""), DEFAULT_AI_POST_LIMIT_MNT);
  assert.equal(resolveAiPostLimit("хог"), DEFAULT_AI_POST_LIMIT_MNT);
  assert.equal(resolveAiPostLimit(0), DEFAULT_AI_POST_LIMIT_MNT);
  assert.equal(resolveAiPostLimit(-5), DEFAULT_AI_POST_LIMIT_MNT);
});

test("resolveAiPostLimit — numeric багана string-ээр ирдэг", () => {
  assert.equal(resolveAiPostLimit("50000000.00"), 50_000_000);
  assert.equal(resolveAiPostLimit(50_000_000), 50_000_000);
});

test("вэбээс (viaTool=false) хязгаарыг тааз хамаарахгүй тавина", () => {
  const plan = planAiPostLimitChange({
    currentMnt: DEFAULT_AI_POST_LIMIT_MNT,
    requestedMnt: AI_POST_LIMIT_TOOL_CEILING_MNT * 5,
    viaTool: false,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok && { value: plan.valueMnt, dir: plan.direction }, {
    value: AI_POST_LIMIT_TOOL_CEILING_MNT * 5,
    dir: "raise",
  });
});

test("tool-оор таазнаас дээш ӨСГӨХ хориотой", () => {
  const plan = planAiPostLimitChange({
    currentMnt: DEFAULT_AI_POST_LIMIT_MNT,
    requestedMnt: AI_POST_LIMIT_TOOL_CEILING_MNT + 1,
    viaTool: true,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.ok === false && plan.code, "LIMIT_CEILING_EXCEEDED");
});

test("tool-оор таазтай тэнцүү хүртэл өсгөж болно", () => {
  const plan = planAiPostLimitChange({
    currentMnt: DEFAULT_AI_POST_LIMIT_MNT,
    requestedMnt: AI_POST_LIMIT_TOOL_CEILING_MNT,
    viaTool: true,
  });
  assert.equal(plan.ok, true);
});

test("tool-оор БУУРУУЛАХАД тааз хамаарахгүй — таазнаас дээш байснаас ч", () => {
  const plan = planAiPostLimitChange({
    currentMnt: AI_POST_LIMIT_TOOL_CEILING_MNT * 10,
    requestedMnt: AI_POST_LIMIT_TOOL_CEILING_MNT * 2,
    viaTool: true,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.ok && plan.direction, "lower");
});

test("null = default рүү буцаах (tool-оос ч чөлөөтэй)", () => {
  const plan = planAiPostLimitChange({
    currentMnt: 500_000_000,
    requestedMnt: null,
    viaTool: true,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.ok && plan.valueMnt, null);
  assert.equal(plan.ok && plan.effectiveMnt, DEFAULT_AI_POST_LIMIT_MNT);
  assert.equal(plan.ok && plan.direction, "lower");
});

test("default-оос доош байхад null өгвөл ӨСГӨЛТ гэж тооцогдоно", () => {
  const plan = planAiPostLimitChange({
    currentMnt: 1_000_000,
    requestedMnt: null,
    viaTool: true,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.ok && plan.direction, "raise");
});

test("сөрөг / тэг / гажиг хязгаар татгалзана", () => {
  for (const requestedMnt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const plan = planAiPostLimitChange({
      currentMnt: DEFAULT_AI_POST_LIMIT_MNT,
      requestedMnt,
      viaTool: false,
    });
    assert.equal(plan.ok, false, `${requestedMnt} татгалзах ёстой`);
    assert.equal(plan.ok === false && plan.code, "INVALID_LIMIT");
  }
});

test("ижил утга өгвөл direction = same", () => {
  const plan = planAiPostLimitChange({
    currentMnt: 25_000_000,
    requestedMnt: 25_000_000,
    viaTool: true,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.ok && plan.direction, "same");
});

test("контекстгүй үед хязгаар нь default (хамгийн болгоомжтой)", () => {
  assert.equal(currentAiPostLimit(), DEFAULT_AI_POST_LIMIT_MNT);
});

test("runWithAiPostLimit — хүрээндээ утга өгч, гараад сэргэнэ", async () => {
  await runWithAiPostLimit(75_000_000, async () => {
    assert.equal(currentAiPostLimit(), 75_000_000);
    await Promise.resolve();
    assert.equal(currentAiPostLimit(), 75_000_000);
  });
  assert.equal(currentAiPostLimit(), DEFAULT_AI_POST_LIMIT_MNT);
});

test("зэрэгцээ хүсэлтүүд бие биенийхээ хязгаарыг харахгүй", async () => {
  const seen: number[] = [];
  await Promise.all([
    runWithAiPostLimit(20_000_000, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(currentAiPostLimit());
    }),
    runWithAiPostLimit(30_000_000, async () => {
      seen.push(currentAiPostLimit());
    }),
  ]);
  assert.deepEqual(seen.sort((a, b) => a - b), [20_000_000, 30_000_000]);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AI_POST_LIMIT_TOOL_MAX_MNT,
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

test("вэбээс (viaTool=false, хүн) хязгаарыг өсгөж болно", () => {
  const plan = planAiPostLimitChange({
    currentMnt: DEFAULT_AI_POST_LIMIT_MNT,
    requestedMnt: 5_000_000_000,
    viaTool: false,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok && { value: plan.valueMnt, dir: plan.direction }, {
    value: 5_000_000_000,
    dir: "raise",
  });
});

test("tool-оор тааз (1 тэрбум) хүртэл өсгөж болно", () => {
  for (const requestedMnt of [DEFAULT_AI_POST_LIMIT_MNT + 1, 50_000_000, AI_POST_LIMIT_TOOL_MAX_MNT]) {
    const plan = planAiPostLimitChange({
      currentMnt: DEFAULT_AI_POST_LIMIT_MNT,
      requestedMnt,
      viaTool: true,
    });
    assert.equal(plan.ok, true, `${requestedMnt} зөвшөөрөгдөх ёстой`);
    assert.deepEqual(plan.ok && { value: plan.valueMnt, dir: plan.direction }, {
      value: requestedMnt,
      dir: "raise",
    });
  }
});

test("ENT-068: tool-оор таазнаас ДЭЭШ өсгөх нь хориотой", () => {
  for (const requestedMnt of [AI_POST_LIMIT_TOOL_MAX_MNT + 1, 5_000_000_000]) {
    const plan = planAiPostLimitChange({
      currentMnt: DEFAULT_AI_POST_LIMIT_MNT,
      requestedMnt,
      viaTool: true,
    });
    assert.equal(plan.ok, false, `${requestedMnt} хориотой байх ёстой`);
    assert.equal(plan.ok === false && plan.code, "HUMAN_REQUIRED");
    assert.match(plan.ok === false ? plan.message : "", /1,000,000,000₮-өөс дээш/);
  }
});

test("ENT-068: таазнаас дээш байгаа хязгаарыг tool-оор ЦААШ өсгөх нь хориотой", () => {
  // Вэбээс 5 тэрбум тавьсан байхад tool-оор 6 тэрбум → HUMAN_REQUIRED.
  const plan = planAiPostLimitChange({
    currentMnt: 5_000_000_000,
    requestedMnt: 6_000_000_000,
    viaTool: true,
  });
  assert.equal(plan.ok === false && plan.code, "HUMAN_REQUIRED");
});

test("default руу буцаах нь өсгөлт ч байсан таазан дотор бол tool-оор чөлөөтэй", () => {
  const plan = planAiPostLimitChange({
    currentMnt: 1_000_000,
    requestedMnt: null,
    viaTool: true,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.ok && { value: plan.valueMnt, eff: plan.effectiveMnt, dir: plan.direction }, {
    value: null,
    eff: DEFAULT_AI_POST_LIMIT_MNT,
    dir: "raise",
  });
});

test("tool-оор ижил утга тавих нь өөрчлөлтгүй — зөвшөөрнө", () => {
  const plan = planAiPostLimitChange({
    currentMnt: 20_000_000,
    requestedMnt: 20_000_000,
    viaTool: true,
  });
  assert.equal(plan.ok && plan.direction, "same");
});

test("tool-оор БУУРУУЛАХ чөлөөтэй", () => {
  const plan = planAiPostLimitChange({
    currentMnt: 10_000_000_000,
    requestedMnt: 2_000_000_000,
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

test("default-оос доош байхад null өгвөл ӨСГӨЛТ гэж тооцогдоно (вэбээс)", () => {
  const plan = planAiPostLimitChange({
    currentMnt: 1_000_000,
    requestedMnt: null,
    viaTool: false,
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

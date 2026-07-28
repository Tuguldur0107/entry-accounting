import test from "node:test";
import assert from "node:assert/strict";

import { allocate, type AllocationTarget } from "../lib/costing/allocation";

// Тайлбарт хэрэглэсэн жишээ: 1,000,000₮ тээвэр, 3 бараа.
const TARGETS: AllocationTarget[] = [
  { movementId: "A", quantity: 100, value: 5_000_000 },
  { movementId: "B", quantity: 200, value: 3_000_000 },
  { movementId: "C", quantity: 700, value: 2_000_000 },
];

const byMovement = (lines: { movementId: string; amount: number }[]) =>
  new Map(lines.map((line) => [line.movementId, line.amount]));

test("value base: splits by purchase amount", () => {
  const result = allocate({
    totalAmount: 1_000_000,
    base: "value",
    targets: TARGETS,
  });
  assert.ok(result.ok);
  const amounts = byMovement(result.lines);
  assert.equal(amounts.get("A"), 500_000);
  assert.equal(amounts.get("B"), 300_000);
  assert.equal(amounts.get("C"), 200_000);
  // §4.3 хяналт: нийлбэр нь нийт дүнтэй ЯГ тэнцэнэ
  assert.equal(
    result.lines.reduce((sum, line) => sum + line.amount, 0),
    1_000_000
  );
});

test("quantity base: splits by units", () => {
  const result = allocate({
    totalAmount: 1_000_000,
    base: "quantity",
    targets: TARGETS,
  });
  assert.ok(result.ok);
  const amounts = byMovement(result.lines);
  assert.equal(amounts.get("A"), 100_000);
  assert.equal(amounts.get("B"), 200_000);
  assert.equal(amounts.get("C"), 700_000);
  assert.equal(
    result.lines.reduce((sum, line) => sum + line.amount, 0),
    1_000_000
  );
});

test("rounding residual lands on the largest line so the total is exact", () => {
  // 100₮-ийг 3 тэнцүү барааг хооронд → 33.33 + 33.33 + 33.33 = 99.99
  const result = allocate({
    totalAmount: 100,
    base: "quantity",
    targets: [
      { movementId: "A", quantity: 1, value: 0 },
      { movementId: "B", quantity: 1, value: 0 },
      { movementId: "C", quantity: 1, value: 0 },
    ],
  });
  assert.ok(result.ok);
  const sum = result.lines.reduce((acc, line) => acc + line.amount, 0);
  assert.equal(Math.round(sum * 100) / 100, 100);
  // Мөр бүр 33.33 эсвэл 33.34
  for (const line of result.lines) assert.ok(line.amount >= 33.33);
});

test("manual base: accepted only when the lines add up to the total", () => {
  const ok = allocate({
    totalAmount: 1_000_000,
    base: "manual",
    targets: [
      { ...TARGETS[0], manualAmount: 600_000 },
      { ...TARGETS[1], manualAmount: 250_000 },
      { ...TARGETS[2], manualAmount: 150_000 },
    ],
  });
  assert.ok(ok.ok);
  assert.equal(byMovement(ok.lines).get("A"), 600_000);

  const bad = allocate({
    totalAmount: 1_000_000,
    base: "manual",
    targets: [
      { ...TARGETS[0], manualAmount: 600_000 },
      { ...TARGETS[1], manualAmount: 250_000 },
    ],
  });
  assert.ok(!bad.ok);
  assert.match(bad.error, /таарахгүй/);
});

test("zero weight is rejected instead of inventing a split", () => {
  const zeroValue = allocate({
    totalAmount: 500_000,
    base: "value",
    targets: [{ movementId: "A", quantity: 10, value: 0 }],
  });
  assert.ok(!zeroValue.ok);
  assert.match(zeroValue.error, /үнийн дүнгээр хуваах боломжгүй/);

  const zeroQty = allocate({
    totalAmount: 500_000,
    base: "quantity",
    targets: [{ movementId: "A", quantity: 0, value: 100 }],
  });
  assert.ok(!zeroQty.ok);
  assert.match(zeroQty.error, /тоогоор хуваах боломжгүй/);
});

test("empty target list and non-positive total are rejected", () => {
  const noTargets = allocate({
    totalAmount: 100,
    base: "value",
    targets: [],
  });
  assert.ok(!noTargets.ok);

  const zeroTotal = allocate({
    totalAmount: 0,
    base: "value",
    targets: TARGETS,
  });
  assert.ok(!zeroTotal.ok);
});

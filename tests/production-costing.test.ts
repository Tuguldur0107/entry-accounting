import test from "node:test";
import assert from "node:assert/strict";

import {
  computeProductionRun,
  matchPools,
  type GlCostLine,
  type PoolRule,
  type StageSpec,
} from "../lib/costing/production";

// ── Зураглал (GL → өртгийн бүлэг) ───────────────────────────────────────────

const RULES: PoolRule[] = [
  // Уурхайн өртгийн төвийн түлшний данс → FUEL бүлэг (нарийвчилсан, түрүүлнэ)
  { poolId: "fuel", costCenterCode: "120005", accountPrefix: "141040", priority: 10 },
  // Уурхайн өртгийн төвийн бусад бүгд → MINING бүлэг
  { poolId: "mining", costCenterCode: "120005", accountPrefix: null, priority: 50 },
  // Баяжуулахын цахилгаан — зөвхөн дансаар
  { poolId: "power", costCenterCode: null, accountPrefix: "14105", priority: 20 },
];

function line(partial: Partial<GlCostLine>): GlCostLine {
  return {
    voucherId: "v1",
    date: "2026-01-15",
    description: "",
    costCenter: "",
    mainAccount: "",
    amount: 0,
    ...partial,
  };
}

test("matchPools: first matching rule by priority wins, one line lands once", () => {
  const lines = [
    line({ costCenter: "120005", mainAccount: "14104000", amount: 1000 }), // fuel (10 < 50)
    line({ costCenter: "120005", mainAccount: "14103000", amount: 2000 }), // mining
    line({ costCenter: "999999", mainAccount: "14105001", amount: 300 }), // power (дансаар)
  ];
  const { pools, unmatched } = matchPools(lines, RULES);
  assert.equal(pools.get("fuel")?.amount, 1000);
  assert.equal(pools.get("mining")?.amount, 2000);
  assert.equal(pools.get("power")?.amount, 300);
  assert.equal(unmatched.length, 0);
});

test("matchPools: known cost center with no matching account is UNMATCHED, foreign lines ignored", () => {
  const lines = [
    // 120005 нь дүрмүүдэд мэдэгдэж буй төв — mining дүрэм (угтваргүй) тааруулна.
    line({ costCenter: "120005", mainAccount: "72100000", amount: 500 }),
    // Огт хамааралгүй төв + данс — чимээ болохгүй, unmatched-д ч орохгүй.
    line({ costCenter: "300100", mainAccount: "51100000", amount: -900 }),
  ];
  const rules: PoolRule[] = [
    { poolId: "fuel", costCenterCode: "120005", accountPrefix: "141040", priority: 10 },
  ];
  const { pools, unmatched } = matchPools(lines, rules);
  assert.equal(pools.size, 0);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].mainAccount, "72100000");
});

test("matchPools: a rule with both fields empty matches nothing", () => {
  const lines = [line({ costCenter: "120005", mainAccount: "14104000", amount: 100 })];
  const { pools } = matchPools(lines, [
    { poolId: "all", costCenterCode: null, accountPrefix: null, priority: 1 },
  ]);
  assert.equal(pools.size, 0);
});

// ── Шат дамжсан тооцоолол ───────────────────────────────────────────────────

test("single stage: joint products split by sales value (the Excel's method)", () => {
  // Excel-ийн 1-р сар: HCC 26,369,698 vs Thermal 121,704 борлуулалтын харьцаа.
  const stages: StageSpec[] = [
    {
      stageId: "chpp",
      poolAmounts: [
        { poolId: "processing", amount: 20_000_000 },
        { poolId: "handling", amount: 5_000_000 },
      ],
      inputs: [],
      outputs: [
        { itemId: "hcc", quantity: 269_320, salesPrice: 97.9, manualAmount: null },
        { itemId: "thermal", quantity: 64_584, salesPrice: 1.9, manualAmount: null },
      ],
      base: "sales_value",
    },
  ];
  const [result] = computeProductionRun(stages);
  assert.equal(result.status, "calculated");
  assert.equal(result.totalCost, 25_000_000);

  const hcc = result.outputs.find((output) => output.itemId === "hcc")!;
  const thermal = result.outputs.find((output) => output.itemId === "thermal")!;
  // Борлуулалтын дүн: 26,366,428 vs 122,710 → ~99.54% / 0.46%
  assert.ok(hcc.allocatedAmount > 24_800_000);
  assert.ok(thermal.allocatedAmount < 200_000);
  // Нийлбэр ЯГ таарна (largest-remainder)
  assert.equal(
    Math.round((hcc.allocatedAmount + thermal.allocatedAmount) * 100) / 100,
    25_000_000
  );
  // Нэгж өртөг
  assert.ok(Math.abs(hcc.unitCost - hcc.allocatedAmount / 269_320) < 1e-9);
});

test("chained stages: stage A output feeds stage B at A's unit cost", () => {
  const stages: StageSpec[] = [
    {
      stageId: "mining",
      poolAmounts: [{ poolId: "mine", amount: 1_000_000 }],
      inputs: [],
      outputs: [
        { itemId: "raw-coal", quantity: 100, salesPrice: null, manualAmount: null },
      ],
      base: "quantity",
    },
    {
      stageId: "chpp",
      poolAmounts: [{ poolId: "process", amount: 500_000 }],
      inputs: [
        // Энэ run-ийн mining шатнаас 80 т түүхий нүүрс зарцуулна.
        { itemId: "raw-coal", quantity: 80, unitCost: null, sourceStageId: "mining" },
      ],
      outputs: [
        { itemId: "washed", quantity: 60, salesPrice: null, manualAmount: null },
      ],
      base: "quantity",
    },
  ];
  const [mining, chpp] = computeProductionRun(stages);
  assert.equal(mining.status, "calculated");
  assert.equal(mining.outputs[0].unitCost, 10_000); // 1,000,000 / 100

  assert.equal(chpp.status, "calculated");
  assert.equal(chpp.inputs[0].unitCost, 10_000); // А шатнаас автоматаар
  assert.equal(chpp.inputs[0].amount, 800_000);
  assert.equal(chpp.totalCost, 1_300_000); // 500,000 + 800,000
  assert.ok(Math.abs(chpp.outputs[0].unitCost - 1_300_000 / 60) < 1e-6);
});

test("input from inventory uses the given (period average) unit cost", () => {
  const stages: StageSpec[] = [
    {
      stageId: "mix",
      poolAmounts: [{ poolId: "labor", amount: 200 }],
      inputs: [
        { itemId: "flour", quantity: 10, unitCost: 50, sourceStageId: null },
      ],
      outputs: [{ itemId: "bread", quantity: 100, salesPrice: null, manualAmount: null }],
      base: "quantity",
    },
  ];
  const [result] = computeProductionRun(stages);
  assert.equal(result.totalCost, 700); // 200 + 10×50
  assert.equal(result.outputs[0].unitCost, 7);
});

test("blocked propagation: a stage consuming a blocked stage's output blocks too", () => {
  const stages: StageSpec[] = [
    {
      stageId: "a",
      poolAmounts: [{ poolId: "p", amount: 999 }],
      inputs: [],
      outputs: [], // өртөгтэй ч гаралтгүй → блок
      base: "quantity",
    },
    {
      stageId: "b",
      poolAmounts: [],
      inputs: [{ itemId: "x", quantity: 1, unitCost: null, sourceStageId: "a" }],
      outputs: [{ itemId: "y", quantity: 1, salesPrice: null, manualAmount: null }],
      base: "quantity",
    },
  ];
  const [a, b] = computeProductionRun(stages);
  assert.equal(a.status, "blocked");
  assert.match(a.blockReason ?? "", /гаралтын бүтээгдэхүүн алга/);
  assert.equal(b.status, "blocked");
  assert.match(b.blockReason ?? "", /тооцоологдоогүй/);
});

test("empty stage (no cost, no output) is calculated, not an error", () => {
  const [result] = computeProductionRun([
    { stageId: "idle", poolAmounts: [], inputs: [], outputs: [], base: "quantity" },
  ]);
  assert.equal(result.status, "calculated");
  assert.equal(result.totalCost, 0);
});

test("manual base must add up; sales_value with zero prices blocks", () => {
  const manualBad = computeProductionRun([
    {
      stageId: "s",
      poolAmounts: [{ poolId: "p", amount: 1000 }],
      inputs: [],
      outputs: [
        { itemId: "a", quantity: 1, salesPrice: null, manualAmount: 400 },
        { itemId: "b", quantity: 1, salesPrice: null, manualAmount: 500 },
      ],
      base: "manual",
    },
  ])[0];
  assert.equal(manualBad.status, "blocked");
  assert.match(manualBad.blockReason ?? "", /таарахгүй/);

  const zeroPrice = computeProductionRun([
    {
      stageId: "s",
      poolAmounts: [{ poolId: "p", amount: 1000 }],
      inputs: [],
      outputs: [
        { itemId: "a", quantity: 5, salesPrice: 0, manualAmount: null },
      ],
      base: "sales_value",
    },
  ])[0];
  assert.equal(zeroPrice.status, "blocked");
});

// ҮЙЛДВЭРЛЭЛИЙН ӨРТГИЙН ХӨДӨЛГӨГЧ — цэвэр логик (DB хамааралгүй, тесттэй).
//
// Урсгал (Excel-ийн Production Cost Report-той ижил):
//   1. GL мөрүүдийг зураглалын дүрмээр (S2 өртгийн төв × дансны угтвар)
//      өртгийн бүлгүүдэд цуглуулна          → WIP хуудасны дүйцэл
//   2. Шат бүрийн нийт өртөг = бүлгүүд + зарцуулсан орц (өмнөх шатны
//      гаралт эсвэл нөөцөөс)
//   3. Нийт өртгийг гаралтын бүтээгдэхүүнүүдэд хуваарилна
//      (борлуулах үнийн харьцаа / тоо хэмжээ / гараар)  → Standard cost дүйцэл
//   4. Гаралтын нэгж өртөг дараагийн шатны орцын үнэ болно
//
// Дүрэм: үнэ ХЭЗЭЭ Ч зохиохгүй — гаралтгүй атлаа өртөгтэй шат, хуваарь
// гаргаж чадахгүй суурь бүхэн ил алдаа болж зогсоно.

import { allocate, type AllocationBase } from "./allocation";
import { roundMoney as round2 } from "@/lib/arap/accounting";

export type ProductionAllocationBase = "sales_value" | "quantity" | "manual";

export const PRODUCTION_BASE_LABELS: Record<ProductionAllocationBase, string> =
  {
    sales_value: "Борлуулах үнийн харьцаагаар",
    quantity: "Тоо хэмжээгээр",
    manual: "Гараар",
  };

// ── Зураглал ────────────────────────────────────────────────────────────────

export interface PoolRule {
  poolId: string;
  /** S2 өртгийн төвийн код — null бол хамаарахгүй. */
  costCenterCode: string | null;
  /** Үндсэн дансны угтвар — null бол хамаарахгүй. */
  accountPrefix: string | null;
  priority: number;
}

export interface GlCostLine {
  voucherId: string;
  date: string;
  description: string;
  /** S2 сегментийн утга (байхгүй бол ""). */
  costCenter: string;
  /** Үндсэн данс (S3). */
  mainAccount: string;
  /** Дебет − кредит (зардлын өсөлт эерэг). */
  amount: number;
}

export interface PoolMatch {
  poolId: string;
  amount: number;
  lineCount: number;
  lines: GlCostLine[];
}

/**
 * GL мөрүүдийг дүрмээр бүлэглэнэ. priority бага дүрэм түрүүлж таарна;
 * нэг мөр ЯГ НЭГ бүлэгт л орно. Дүрэм: costCenter байвал яг тэнцэнэ,
 * accountPrefix байвал үндсэн данс түүгээр эхэлнэ; хоёулаа байвал хоёулаа.
 * Хоёулаа хоосон дүрэм юу ч ТААРУУЛАХГҮЙ (бүх GL-ийг залгичихгүй).
 */
export function matchPools(
  lines: GlCostLine[],
  rules: PoolRule[]
): { pools: Map<string, PoolMatch>; unmatched: GlCostLine[] } {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  const pools = new Map<string, PoolMatch>();
  const unmatched: GlCostLine[] = [];

  // "Сонирхлын хүрээ": дүрмүүдийн аль нэг өртгийн төвд таарсан мөрийг л
  // зураглалгүй гэж тоолно — эс бөгөөс огт хамааралгүй GL (борлуулалт,
  // мөнгө) бүгд "зураглалгүй" болж чимээ болно.
  const knownCostCenters = new Set(
    ordered
      .map((rule) => rule.costCenterCode)
      .filter((code): code is string => Boolean(code))
  );

  for (const line of lines) {
    const rule = ordered.find((candidate) => {
      const centerOk =
        candidate.costCenterCode !== null
          ? line.costCenter === candidate.costCenterCode
          : candidate.accountPrefix !== null; // хоёулаа хоосныг тааруулахгүй
      const accountOk =
        candidate.accountPrefix !== null
          ? line.mainAccount.startsWith(candidate.accountPrefix)
          : true;
      return centerOk && accountOk;
    });

    if (rule) {
      const match = pools.get(rule.poolId);
      if (match) {
        match.amount += line.amount;
        match.lineCount += 1;
        match.lines.push(line);
      } else
        pools.set(rule.poolId, {
          poolId: rule.poolId,
          amount: line.amount,
          lineCount: 1,
          lines: [line],
        });
    } else if (knownCostCenters.has(line.costCenter)) {
      unmatched.push(line);
    }
  }

  for (const match of pools.values())
    match.amount = Math.round(match.amount * 100) / 100;
  return { pools, unmatched };
}

// ── Шат дамжсан тооцоолол ───────────────────────────────────────────────────

export interface StageInputSpec {
  itemId: string;
  quantity: number;
  /**
   * Нөөцөөс зарцуулж буй бол нэгж өртөг (сарын дундаж). Энэ run доторх
   * өмнөх шатны гаралтаас бол null — хөдөлгөгч өөрөө шийднэ.
   */
  unitCost: number | null;
  sourceStageId: string | null;
}

export interface StageOutputSpec {
  itemId: string;
  quantity: number;
  salesPrice: number | null;
  manualAmount: number | null;
}

export interface StageSpec {
  stageId: string;
  /** GL-ээс цугласан бүлгийн дүнгүүд. */
  poolAmounts: { poolId: string; amount: number }[];
  inputs: StageInputSpec[];
  outputs: StageOutputSpec[];
  base: ProductionAllocationBase;
}

export interface StageResult {
  stageId: string;
  poolTotal: number;
  inputTotal: number;
  totalCost: number;
  outputs: {
    itemId: string;
    quantity: number;
    allocatedAmount: number;
    unitCost: number;
  }[];
  inputs: {
    itemId: string;
    quantity: number;
    unitCost: number;
    amount: number;
    sourceStageId: string | null;
  }[];
  status: "calculated" | "blocked";
  blockReason: string | null;
}


const BASE_MAP: Record<ProductionAllocationBase, AllocationBase> = {
  sales_value: "value",
  quantity: "quantity",
  manual: "manual",
};

/**
 * Шатуудыг ДАРААЛЛААР нь тооцно. Өмнөх шатны гаралтын нэгж өртөг
 * дараагийн шатны орцод автоматаар очно. Аль нэг шат блоклогдвол түүнээс
 * хамаарсан дараагийн шатууд мөн блоклогдоно (үнэ зохиохгүй).
 */
export function computeProductionRun(stages: StageSpec[]): StageResult[] {
  const results: StageResult[] = [];
  /** stageId → itemId → нэгж өртөг (энэ run-д гаргасан). */
  const producedUnitCost = new Map<string, Map<string, number>>();
  const blockedStages = new Set<string>();

  for (const stage of stages) {
    const poolTotal = round2(
      stage.poolAmounts.reduce((sum, pool) => sum + pool.amount, 0)
    );

    const blocked = (reason: string): StageResult => ({
      stageId: stage.stageId,
      poolTotal,
      inputTotal: 0,
      totalCost: poolTotal,
      outputs: [],
      inputs: [],
      status: "blocked",
      blockReason: reason,
    });

    // Орцын өртгийг шийднэ.
    const inputs: StageResult["inputs"] = [];
    let inputProblem: string | null = null;
    for (const input of stage.inputs) {
      let unitCost = input.unitCost;
      if (input.sourceStageId) {
        if (blockedStages.has(input.sourceStageId)) {
          inputProblem = "Орц авах шат нь тооцоологдоогүй байна";
          break;
        }
        const produced = producedUnitCost
          .get(input.sourceStageId)
          ?.get(input.itemId);
        if (produced === undefined) {
          inputProblem =
            "Орц авах шат энэ бүтээгдэхүүнийг гаргаагүй байна";
          break;
        }
        unitCost = produced;
      }
      if (unitCost === null || !Number.isFinite(unitCost)) {
        inputProblem = "Орцын нэгж өртөг тодорхойгүй байна";
        break;
      }
      inputs.push({
        itemId: input.itemId,
        quantity: input.quantity,
        unitCost,
        amount: round2(input.quantity * unitCost),
        sourceStageId: input.sourceStageId,
      });
    }
    if (inputProblem) {
      blockedStages.add(stage.stageId);
      results.push(blocked(inputProblem));
      continue;
    }

    const inputTotal = round2(
      inputs.reduce((sum, input) => sum + input.amount, 0)
    );
    const totalCost = round2(poolTotal + inputTotal);

    if (stage.outputs.length === 0) {
      if (Math.abs(totalCost) > 0.005) {
        blockedStages.add(stage.stageId);
        results.push(
          blocked("Өртөг цугласан ч гаралтын бүтээгдэхүүн алга")
        );
        continue;
      }
      // Өртөггүй, гаралтгүй — хоосон шат, алдаа биш.
      results.push({
        stageId: stage.stageId,
        poolTotal,
        inputTotal,
        totalCost,
        outputs: [],
        inputs,
        status: "calculated",
        blockReason: null,
      });
      continue;
    }

    if (totalCost <= 0) {
      blockedStages.add(stage.stageId);
      results.push(
        blocked("Шатны нийт өртөг 0 буюу сөрөг байна — хуваарилах дүнгүй")
      );
      continue;
    }

    // Хуваарилалт — худалдааны хуваарьтай НЭГ хөдөлгөгч (allocate).
    const allocation = allocate({
      totalAmount: totalCost,
      base: BASE_MAP[stage.base],
      targets: stage.outputs.map((output, index) => ({
        movementId: String(index),
        quantity: output.quantity,
        value: round2(output.quantity * (output.salesPrice ?? 0)),
        manualAmount: output.manualAmount ?? 0,
      })),
    });
    if (!allocation.ok) {
      blockedStages.add(stage.stageId);
      results.push(blocked(allocation.error));
      continue;
    }

    const amountByIndex = new Map(
      allocation.lines.map((line) => [Number(line.movementId), line.amount])
    );
    const outputs = stage.outputs.map((output, index) => {
      const allocatedAmount = amountByIndex.get(index) ?? 0;
      return {
        itemId: output.itemId,
        quantity: output.quantity,
        allocatedAmount,
        unitCost: output.quantity > 0 ? allocatedAmount / output.quantity : 0,
      };
    });

    const stageMap = new Map<string, number>();
    for (const output of outputs) stageMap.set(output.itemId, output.unitCost);
    producedUnitCost.set(stage.stageId, stageMap);

    results.push({
      stageId: stage.stageId,
      poolTotal,
      inputTotal,
      totalCost,
      outputs,
      inputs,
      status: "calculated",
      blockReason: null,
    });
  }

  return results;
}

// Нэмэлт зардлыг бараанд ХУВААХ — цэвэр математик (DB хамааралгүй).
//
// docs/cost FR-ALLOC-001..005. OD-017 (хуваарийн суурь) нь README
// change-control 0.3-д батлагдсан: ГУРВАН суурь боломжтой, баримт бүрд
// хэрэглэгч сонгоно.
//
//   "value"    — орлогын мөнгөн дүнгийн хувь тавиараа. Үнэтэй бараа илүү
//                зардал даана. IFRS-д хамгийн өргөн хэрэглэгддэг.
//   "quantity" — тоо хэмжээгээр. Адил хэлбэр, адил жинтэй бараанд тохирно.
//   "manual"   — хэрэглэгч бараа бүрд дүнг өөрөө бичнэ.
//
// Бөөрөнхийлөлт: мөр бүрийг 2 орон болгож, гарсан үлдэгдлийг ХАМГИЙН ТОМ
// мөрд нэмнэ (largest-remainder). Ингэснээр мөрүүдийн нийлбэр нийт дүнтэй
// ЯГ тэнцэж, §4.3-ын хяналт биелнэ — тайлбаргүй зөрүү үлдэхгүй.

export type AllocationBase = "value" | "quantity" | "manual";

export const ALLOCATION_BASE_LABELS: Record<AllocationBase, string> = {
  value: "Үнийн дүнгээр",
  quantity: "Тоо хэмжээгээр",
  manual: "Гараар",
};

export interface AllocationTarget {
  /** Хуваарилагдах орлогын хөдөлгөөн. */
  movementId: string;
  quantity: number;
  /** Тухайн орлогын мөнгөн дүн ("value" суурьд). */
  value: number;
  /** "manual" суурьд хэрэглэгчийн бичсэн дүн. */
  manualAmount?: number;
}

export interface AllocationLine {
  movementId: string;
  /** Хуваарилалтад хэрэглэгдсэн жин (дүн эсвэл тоо; manual-д 0). */
  baseValue: number;
  amount: number;
}

export type AllocationResult =
  | { ok: true; lines: AllocationLine[] }
  | { ok: false; error: string };

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Нийт дүнг мөрүүдэд хуваана. Нийлбэр нь нийт дүнтэй ЯГ тэнцэнэ.
 * Хуваах боломжгүй бол (жин 0, гараар бичсэн нийлбэр таарахгүй) АЛДАА
 * буцаана — дүнг зохиохгүй.
 */
export function allocate(input: {
  totalAmount: number;
  base: AllocationBase;
  targets: AllocationTarget[];
}): AllocationResult {
  const total = round2(input.totalAmount);
  if (!(total > 0)) return { ok: false, error: "Хуваах дүн 0-ээс их байна" };
  if (input.targets.length === 0)
    return { ok: false, error: "Хуваарилах бараа сонгоогүй байна" };

  if (input.base === "manual") {
    const lines = input.targets.map((target) => ({
      movementId: target.movementId,
      baseValue: 0,
      amount: round2(target.manualAmount ?? 0),
    }));
    const sum = round2(lines.reduce((acc, line) => acc + line.amount, 0));
    if (lines.some((line) => line.amount < 0))
      return { ok: false, error: "Сөрөг дүн оруулж болохгүй" };
    if (Math.abs(sum - total) > 0.005)
      return {
        ok: false,
        error: `Бичсэн дүнгүүдийн нийлбэр (${sum.toLocaleString("en-US")}) нийт дүнтэй (${total.toLocaleString("en-US")}) таарахгүй байна`,
      };
    return { ok: true, lines: lines.filter((line) => line.amount !== 0) };
  }

  const weightOf = (target: AllocationTarget) =>
    input.base === "value" ? target.value : target.quantity;

  const weights = input.targets.map(weightOf);
  if (weights.some((weight) => weight < 0))
    return { ok: false, error: "Хуваарийн жин сөрөг байж болохгүй" };
  const weightTotal = weights.reduce((acc, weight) => acc + weight, 0);
  if (!(weightTotal > 0))
    return {
      ok: false,
      error:
        input.base === "value"
          ? "Сонгосон орлогуудын дүн 0 — үнийн дүнгээр хуваах боломжгүй"
          : "Сонгосон орлогуудын тоо хэмжээ 0 — тоогоор хуваах боломжгүй",
    };

  // Эхлээд доош бөөрөнхийлж, үлдэгдлийг хамгийн том жинтэйд нэмнэ.
  const lines: AllocationLine[] = input.targets.map((target, index) => ({
    movementId: target.movementId,
    baseValue: weights[index],
    amount: round2((total * weights[index]) / weightTotal),
  }));

  const allocated = round2(lines.reduce((acc, line) => acc + line.amount, 0));
  const residual = round2(total - allocated);
  if (residual !== 0) {
    let largest = 0;
    for (let index = 1; index < lines.length; index += 1)
      if (lines[index].baseValue > lines[largest].baseValue) largest = index;
    lines[largest].amount = round2(lines[largest].amount + residual);
  }

  return { ok: true, lines: lines.filter((line) => line.amount !== 0) };
}

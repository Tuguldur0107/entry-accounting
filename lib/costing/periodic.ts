// Хугацааны жигнэсэн дундаж (Periodic Weighted Average) — ЦЭВЭР хөдөлгөгч.
// docs/cost 01-functional-specification §5.3, FR-COST-001..005.
//
// Хамрах хүрээ (OD-001, product owner баталсан): БАРАА × АГУУЛАХ × КОМПАНИ.
// Компани нь өнөөдөр userId — тооцоолол нэг хэрэглэгчийн хүрээнд явна.
// Период (OD-002): нягтлан бодох период = хуанлийн сар (lib/periods).
// Нарийвчлал (OD-003): дундаж болон дүнг БҮТЭН нарийвчлалаар авч явна;
// бөөрөнхийлөлт зөвхөн харуулах/GL-д бичих үед.
//
// Томьёо:
//   Available Qty    = C1 Qty + Inbound Qty
//   Available Amount = C1 Amount + Inbound Amount
//   Дундаж           = Available Amount / Available Qty
//   Outbound Amount  = Outbound Qty × Дундаж
//   C2 Qty           = Available Qty − Outbound Qty
//   C2 Amount        = C2 Qty × Дундаж
//   Outbound Unit Cost = C2 Unit Cost   (FR-COST-001)
//
// Тэгээр хуваахгүй (FR-COST-005): Available Qty = 0 атлаа зарлага байвал
// тооцоолол ЗОГСОНО — үнэ зохиохгүй, ил алдаа болж харагдана. Available Qty
// сөрөг (хасах нөөц) нь OD-005-д хамаарах нээлттэй шийдвэр тул мөн зогсоно.
// Зарлага боломжит үлдэгдлээс их (C2 сөрөг болох) нь мөн OD-005 — зогсоно.

import { periodCodeOf } from "@/lib/periods/period";

/** Нэг хөдөлгөөн — тоо хэмжээний эх сурвалж (Inventory Ledger). */
export interface PeriodicMovement {
  id: string;
  date: string; // YYYY-MM-DD
  itemId: string;
  warehouseId: string;
  /** "in" — орлого/илүүдэл/буцаж ирсэн; "out" — зарлага/дутагдал/буцаалт. */
  direction: "in" | "out";
  /** Үргэлж ЭЕРЭГ (чиглэл нь direction-д). */
  quantity: number;
  /**
   * Орлогын үнэлгээний хэлбэр ("in" чиглэлд):
   *   "priced"  — эх баримтаас өртөг ирнэ (худалдан авалт, нэмэлт зардал).
   *               Өртөг байхгүй бол тухайн сар тооцоологдохгүй.
   *   "average" — тухайн сарын дунджаар үнэлэгдэнэ. Тооллогын илүүдэл,
   *               худалдан авагчаас буцаж ирсэн бараанд худалдан авах үнэ
   *               байхгүй тул (README change-control 0.2-д батлагдсан).
   */
  inboundValuation?: "priced" | "average";
  /** "priced" орлогын мөнгөн дүн. "average"-д хэрэглэгдэхгүй. */
  inboundAmount?: number | null;
  /**
   * Агуулах хоорондын шилжүүлгийн ОРЛОГО (OD-014, README change-control 0.9):
   * ижил барааны ЭХ агуулахын тухайн сарын дундаж × тоо хэмжээгээр
   * үнэлэгдсэн «priced» орлого. Дүнг computeAllScopes эх хүрээг эхэлж бодоод
   * бөглөнө; эх нь блоклогдвол дүн тодорхойгүй (null) → хүлээн авагч мөн
   * блоклогдоно (үнэ зохиохгүй).
   */
  transferFromWarehouseId?: string;
}

/** Тухайн бараа-агуулахын өмнөх периодын үлдэгдэл (C1). */
export interface OpeningBalance {
  qty: number;
  amount: number;
}

export type PeriodResultStatus =
  | "calculated"
  | "blocked-missing-inbound-cost"
  | "blocked-zero-available"
  | "blocked-negative-available"
  | "blocked-negative-closing";

export interface PeriodicResult {
  itemId: string;
  warehouseId: string;
  periodCode: string;
  // C1
  openingQty: number;
  openingAmount: number;
  /** C1 Amount / C1 Qty — Qty 0 бол null (утгагүй, зохиохгүй). */
  openingUnitCost: number | null;
  // Inbound (үнэтэй + дунджаар үнэлэгдсэн хоёрын нийлбэр)
  inboundQty: number;
  inboundAmount: number;
  /** Inbound Amount / Inbound Qty — Qty 0 бол null. */
  inboundUnitCost: number | null;
  /** Эх баримтаас өртөгтэй ирсэн орлого — дундажийг ЗӨВХӨН үүнээс бодно. */
  pricedInboundQty: number;
  pricedInboundAmount: number;
  /** Дунджаар үнэлэгдсэн орлого (илүүдэл, буцаж ирсэн). */
  averageValuedInboundQty: number;
  // Outbound
  outboundQty: number;
  /** Outbound Amount = Outbound Qty × дундаж. Блоклогдвол null. */
  outboundAmount: number | null;
  // C2
  closingQty: number;
  closingAmount: number | null;
  /** Outbound болон C2-ын ХУВААЛЦСАН нэгж өртөг (FR-COST-001). */
  averageUnitCost: number | null;
  // Хяналт (FR-COST-003 / FR-COST-004)
  qtyBalanced: boolean;
  amountBalanced: boolean;
  status: PeriodResultStatus;
  /** Тооцооллыг зогсоосон шалтгаан (монголоор, UI-д шууд харуулна). */
  blockReason: string | null;
  /** Энэ үр дүнд орсон хөдөлгөөнүүд (FR-LEDGER-COST-005 нөхөн сэргээх). */
  movementIds: string[];
}

/** Мөнгөн дүнгийн тэнцвэрийн хүлцэл — 10 орны нарийвчлалын үлдэгдэлд. */
const AMOUNT_EPSILON = 1e-6;
/**
 * Хэмжээст пропорциональ хүлцэл: тэрбум ₮-ийн хэмжээний дүнд float64-ийн
 * бөөрөнхийллийн алдаа үнэмлэхүй 1e-6-аас давдаг тул суурь хүлцэлийг
 * дүнгийн хэмжээтэй (харьцангуй 1e-9) уялдуулан өргөнө — худал
 * "тэнцээгүй" туг гарахаас сэргийлнэ.
 */
const amountToleranceFor = (scale: number) =>
  Math.max(AMOUNT_EPSILON, Math.abs(scale) * 1e-9);
/** Тоо хэмжээний хүлцэл — numeric(18,4). */
const QTY_EPSILON = 1e-9;

export const scopeKey = (itemId: string, warehouseId: string) =>
  `${itemId}::${warehouseId}`;

/**
 * НЭГ бараа-агуулах-периодын үр дүн. openingBalance нь өмнөх периодын C2.
 * movements нь ЗӨВХӨН тухайн периодын, тухайн хамрах хүрээний хөдөлгөөнүүд.
 */
export function computePeriodResult(input: {
  itemId: string;
  warehouseId: string;
  periodCode: string;
  opening: OpeningBalance;
  movements: PeriodicMovement[];
}): PeriodicResult {
  const { itemId, warehouseId, periodCode, opening, movements } = input;

  // Орлогыг ХОЁР бүлэгт хуваана: өртөгтэй ирсэн (дундажийг тодорхойлдог) ба
  // дунджаар үнэлэгдэх (илүүдэл, буцаж ирсэн — худалдан авах үнэ байхгүй).
  let pricedInboundQty = 0;
  let pricedInboundAmount = 0;
  let averageValuedInboundQty = 0;
  let outboundQty = 0;
  let missingInboundCost = false;
  const movementIds: string[] = [];

  for (const movement of movements) {
    movementIds.push(movement.id);
    if (movement.direction === "out") {
      outboundQty += movement.quantity;
      continue;
    }
    if (movement.inboundValuation === "average") {
      averageValuedInboundQty += movement.quantity;
      continue;
    }
    pricedInboundQty += movement.quantity;
    if (movement.inboundAmount == null) missingInboundCost = true;
    else pricedInboundAmount += movement.inboundAmount;
  }

  // Дундажийг ЗӨВХӨН эхний үлдэгдэл + өртөгтэй орлогоос бодно. Дараа нь
  // үнэгүй орлогыг тэр дунджаар үнэлнэ — ингэснээр
  //   C1 + Орлого = Зарлага + C2
  // тэнцэл хэвээр биелнэ (бүх тал нэг л дундажтай).
  const pricedQty = opening.qty + pricedInboundQty;
  const pricedAmount = opening.amount + pricedInboundAmount;

  const inboundQtyTotal = pricedInboundQty + averageValuedInboundQty;
  const closingQtyTotal =
    opening.qty + inboundQtyTotal - outboundQty;

  const baseOf = (inboundAmount: number) => ({
    itemId,
    warehouseId,
    periodCode,
    openingQty: opening.qty,
    openingAmount: opening.amount,
    openingUnitCost:
      Math.abs(opening.qty) > QTY_EPSILON ? opening.amount / opening.qty : null,
    inboundQty: inboundQtyTotal,
    inboundAmount,
    inboundUnitCost:
      Math.abs(inboundQtyTotal) > QTY_EPSILON
        ? inboundAmount / inboundQtyTotal
        : null,
    pricedInboundQty,
    pricedInboundAmount,
    averageValuedInboundQty,
    outboundQty,
    closingQty: closingQtyTotal,
    movementIds,
  });

  const qtyBalanced =
    Math.abs(
      opening.qty + inboundQtyTotal - (outboundQty + closingQtyTotal)
    ) < QTY_EPSILON;

  const blocked = (
    status: PeriodResultStatus,
    blockReason: string
  ): PeriodicResult => ({
    // Блоклогдвол дунджаар үнэлэгдэх орлогын дүн тодорхойгүй тул зөвхөн
    // өртөгтэй орлогын дүнг үзүүлнэ.
    ...baseOf(pricedInboundAmount),
    outboundAmount: null,
    closingAmount: null,
    averageUnitCost: null,
    // Тоо хэмжээ нь мөнгөн дүнгээс хамаарахгүй тул блоклогдсон ч шалгана.
    qtyBalanced,
    amountBalanced: false,
    status,
    blockReason,
  });

  // Өртөг бөглөгдөөгүй худалдан авалт — дундаж тодорхойгүй (ЗОХИОХГҮЙ).
  if (missingInboundCost)
    return blocked(
      "blocked-missing-inbound-cost",
      "Орлогын өртөг бөглөгдөөгүй мөр байна — дундаж тооцоологдохгүй"
    );

  // Хасах боломжит нөөц — OD-005 нээлттэй тул зогсооно.
  if (opening.qty + inboundQtyTotal < -QTY_EPSILON)
    return blocked(
      "blocked-negative-available",
      "Боломжит үлдэгдэл сөрөг байна — хасах нөөцийн дүрэм батлагдаагүй"
    );

  // Тэгээр хуваахгүй (FR-COST-005): өртөгтэй тал 0 бол дундаж гарахгүй.
  if (Math.abs(pricedQty) <= QTY_EPSILON) {
    if (
      Math.abs(outboundQty) > QTY_EPSILON ||
      Math.abs(averageValuedInboundQty) > QTY_EPSILON
    )
      return blocked(
        "blocked-zero-available",
        "Өртөгтэй орлого, эхний үлдэгдэл байхгүй тул нэгж өртөг тодорхойлогдохгүй"
      );
    // Хөдөлгөөнгүй, үлдэгдэлгүй — үнэлэх зүйлгүй, алдаа биш.
    return {
      ...baseOf(0),
      outboundAmount: 0,
      closingAmount: 0,
      averageUnitCost: null,
      qtyBalanced: true,
      amountBalanced: true,
      status: "calculated",
      blockReason: null,
    };
  }

  // Зарлага боломжит үлдэгдлээс их — C2 сөрөг болно. Хасах нөөцийн дүрэм
  // (OD-005) батлагдаагүй тул сөрөг үлдэгдлээр цааш үнэлэхгүй ЗОГСООНО;
  // дараагийн сарууд ч C1 тодорхойгүй тул мөн блоклогдоно.
  if (closingQtyTotal < -QTY_EPSILON) {
    const availableQty = opening.qty + inboundQtyTotal;
    return blocked(
      "blocked-negative-closing",
      `Зарлага (${outboundQty}) боломжит үлдэгдлээс (${availableQty}) их — сөрөг үлдэгдэл`
    );
  }

  const averageUnitCost = pricedAmount / pricedQty;
  const inboundAmount =
    pricedInboundAmount + averageValuedInboundQty * averageUnitCost;
  const availableAmount = opening.amount + inboundAmount;
  const outboundAmount = outboundQty * averageUnitCost;
  const closingAmount = closingQtyTotal * averageUnitCost;

  return {
    ...baseOf(inboundAmount),
    outboundAmount,
    closingAmount,
    averageUnitCost,
    qtyBalanced,
    amountBalanced:
      Math.abs(availableAmount - (outboundAmount + closingAmount)) <
      amountToleranceFor(availableAmount),
    status: "calculated",
    blockReason: null,
  };
}

/** Өмнөх период блоклогдсон — C1 тодорхойгүй тул энэ периодыг үнэлэхгүй. */
function unknownOpeningResult(
  itemId: string,
  warehouseId: string,
  periodCode: string,
  periodMovements: PeriodicMovement[]
): PeriodicResult {
  const sumQty = (predicate: (movement: PeriodicMovement) => boolean) =>
    periodMovements.filter(predicate).reduce((sum, movement) => sum + movement.quantity, 0);
  return {
    itemId,
    warehouseId,
    periodCode,
    openingQty: 0,
    openingAmount: 0,
    openingUnitCost: null,
    inboundQty: sumQty((movement) => movement.direction === "in"),
    inboundAmount: 0,
    inboundUnitCost: null,
    pricedInboundQty: sumQty(
      (movement) => movement.direction === "in" && movement.inboundValuation !== "average"
    ),
    pricedInboundAmount: 0,
    averageValuedInboundQty: sumQty(
      (movement) => movement.direction === "in" && movement.inboundValuation === "average"
    ),
    outboundQty: sumQty((movement) => movement.direction === "out"),
    outboundAmount: null,
    closingQty: 0,
    closingAmount: null,
    averageUnitCost: null,
    qtyBalanced: false,
    amountBalanced: false,
    status: "blocked-missing-inbound-cost",
    blockReason: "Өмнөх тайлант үе тооцоологдоогүй тул эхний үлдэгдэл тодорхойгүй",
    movementIds: periodMovements.map((movement) => movement.id),
  };
}

/**
 * Олон период дараалан — C2 нь дараагийн периодын C1 болно.
 * Блоклогдсон период дараагийнхаа C1-ийг ТОДОРХОЙГҮЙ болгох тул дараагийн
 * период мөн блоклогдоно (үнэ зохиохгүйн тулд).
 */
export function computePeriodSeries(input: {
  itemId: string;
  warehouseId: string;
  /** Өсөх дарааллаар — lib/periods/periodCodesBetween. */
  periodCodes: string[];
  /**
   * Хамгийн эхний периодын өмнөх үлдэгдэл (ихэвчлэн 0/0). `null` = өмнөх
   * (хаагдсан) период энэ хүрээнд БЛОКЛОГДСОН байсан — C1 тодорхойгүй тул
   * цуваа бүхэлдээ блоклогдоно (бүрэн дахин тооцоолсонтой ижил).
   */
  initialOpening?: OpeningBalance | null;
  /** Тухайн хамрах хүрээний БҮХ хөдөлгөөн — период дотор нь ангилагдана. */
  movements: PeriodicMovement[];
}): PeriodicResult[] {
  const { itemId, warehouseId, periodCodes, movements } = input;
  const byPeriod = new Map<string, PeriodicMovement[]>();
  for (const movement of movements) {
    const code = periodCodeOf(movement.date);
    const list = byPeriod.get(code);
    if (list) list.push(movement);
    else byPeriod.set(code, [movement]);
  }

  const results: PeriodicResult[] = [];
  let opening: OpeningBalance | null =
    input.initialOpening === undefined ? { qty: 0, amount: 0 } : input.initialOpening;

  for (const periodCode of periodCodes) {
    const periodMovements = byPeriod.get(periodCode) ?? [];

    // Өмнөх период блоклогдсон бол C1 тодорхойгүй — цааш нь үнэлэхгүй.
    if (opening === null) {
      results.push(unknownOpeningResult(itemId, warehouseId, periodCode, periodMovements));
      continue;
    }

    const result = computePeriodResult({
      itemId,
      warehouseId,
      periodCode,
      opening,
      movements: periodMovements,
    });
    results.push(result);
    opening =
      result.status === "calculated" && result.closingAmount !== null
        ? { qty: result.closingQty, amount: result.closingAmount }
        : null;
  }

  return results;
}

/**
 * Бүх хамрах хүрээгээр — бараа × агуулах бүрд цувааг бодно.
 * Буцаах нь scopeKey → тухайн хүрээний периодын үр дүнгүүд.
 *
 * Тооцоо нь ПЕРИОД-ЭХЭЛСЭН: сар бүрд хүрээнүүдийг шилжүүлгийн хамаарлын
 * дарааллаар (эх агуулах → хүлээн авагч, Kahn) бодно, учир нь шилжүүлгийн
 * орлогын дүн = эх хүрээний ТУХАЙН САРЫН дундаж × тоо (OD-014, 0.9).
 * Нэг сард агуулахууд бие биерүүгээ шилжүүлсэн ТОЙРОГ бол дундаж нь
 * хамтарсан тэгшитгэлээс гарна — энэ шийдлийг ЗОХИОХГҮЙ, тойрогт орсон
 * хүрээнүүд ил шалтгаантайгаар блоклогдоно.
 */
export function computeAllScopes(input: {
  periodCodes: string[];
  movements: PeriodicMovement[];
  /**
   * scopeKey → эхний C1 (өмнө нь хаагдсан периодоос; null = тэнд блоклогдсон).
   * Хөдөлгөөнгүй ч энд байгаа хүрээ мөн тооцогдоно — үлдэгдэл нь дараагийн
   * периодуудад дамжина (бүрэн дахин тооцоололд ийм мөр үүсдэг).
   */
  openingByScope?: Map<string, OpeningBalance | null>;
}): Map<string, PeriodicResult[]> {
  // scopeKey → periodCode → хөдөлгөөнүүд
  const byScope = new Map<string, Map<string, PeriodicMovement[]>>();
  const ensure = (key: string) => {
    let periods = byScope.get(key);
    if (!periods) {
      periods = new Map();
      byScope.set(key, periods);
    }
    return periods;
  };
  for (const key of input.openingByScope?.keys() ?? []) ensure(key);
  for (const movement of input.movements) {
    const periods = ensure(scopeKey(movement.itemId, movement.warehouseId));
    const code = periodCodeOf(movement.date);
    const list = periods.get(code);
    if (list) list.push(movement);
    else periods.set(code, [movement]);
  }

  const out = new Map<string, PeriodicResult[]>();
  const opening = new Map<string, OpeningBalance | null>();
  for (const key of byScope.keys()) {
    out.set(key, []);
    const initial = input.openingByScope?.get(key);
    opening.set(key, initial === undefined ? { qty: 0, amount: 0 } : initial);
  }

  for (const periodCode of input.periodCodes) {
    // Энэ сарын шилжүүлгийн хамаарал: хүлээн авагч → эх хүрээнүүд.
    const dependsOn = new Map<string, Set<string>>();
    for (const [key, periods] of byScope) {
      const sources = new Set<string>();
      for (const movement of periods.get(periodCode) ?? [])
        if (movement.direction === "in" && movement.transferFromWarehouseId)
          sources.add(scopeKey(movement.itemId, movement.transferFromWarehouseId));
      sources.delete(key);
      dependsOn.set(key, sources);
    }

    const order: string[] = [];
    const remaining = new Map(
      [...dependsOn].map(([key, sources]) => [
        key,
        new Set([...sources].filter((source) => byScope.has(source))),
      ])
    );
    const ready = [...remaining].filter(([, deps]) => deps.size === 0).map(([key]) => key);
    while (ready.length > 0) {
      const key = ready.shift()!;
      order.push(key);
      remaining.delete(key);
      for (const [other, deps] of remaining)
        if (deps.delete(key) && deps.size === 0) ready.push(other);
    }
    const cyclic = new Set(remaining.keys());

    const averageThisPeriod = new Map<string, number | null>();
    for (const key of [...order, ...cyclic]) {
      const [itemId, warehouseId] = key.split("::");
      const raw = byScope.get(key)!.get(periodCode) ?? [];
      const c1 = opening.get(key) ?? null;
      let result: PeriodicResult;
      if (c1 === null) {
        result = unknownOpeningResult(itemId, warehouseId, periodCode, raw);
      } else if (cyclic.has(key)) {
        result = {
          ...unknownOpeningResult(itemId, warehouseId, periodCode, raw),
          openingQty: c1.qty,
          openingAmount: c1.amount,
          openingUnitCost: Math.abs(c1.qty) > QTY_EPSILON ? c1.amount / c1.qty : null,
          blockReason:
            "Агуулах хоорондын шилжүүлэг энэ сард тойрог үүсгэсэн (хоёр агуулах бие биерүүгээ) — дундаж тодорхойлогдохгүй",
        };
      } else {
        // Шилжүүлгийн орлогыг эх хүрээний энэ сарын дунджаар үнэлнэ.
        const movements = raw.map((movement) => {
          if (movement.direction !== "in" || !movement.transferFromWarehouseId) return movement;
          const source = averageThisPeriod.get(
            scopeKey(movement.itemId, movement.transferFromWarehouseId)
          );
          return {
            ...movement,
            inboundValuation: "priced" as const,
            inboundAmount:
              source === undefined || source === null ? null : movement.quantity * source,
          };
        });
        result = computePeriodResult({ itemId, warehouseId, periodCode, opening: c1, movements });
        if (
          result.status === "blocked-missing-inbound-cost" &&
          raw.some((movement) => movement.transferFromWarehouseId)
        )
          result = {
            ...result,
            blockReason:
              "Шилжүүлгийн эх агуулахын энэ сарын өртөг тооцоологдоогүй — хүлээн авсан барааны өртөг тодорхойгүй",
          };
      }
      out.get(key)!.push(result);
      averageThisPeriod.set(key, result.status === "calculated" ? result.averageUnitCost : null);
      opening.set(
        key,
        result.status === "calculated" && result.closingAmount !== null
          ? { qty: result.closingQty, amount: result.closingAmount }
          : null
      );
    }
  }
  return out;
}

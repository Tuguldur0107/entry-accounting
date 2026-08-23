// ГҮЙЛГЭЭ ТУТМЫН ҮЛДЭГДЭЛ (Running Qty / Running Amount) — цэвэр логик.
// docs/cost 03-report-specifications §3.4 (corrected baseline: ЗААВАЛ).
//
// Периодын ДОТОРХ тооцоо: тухайн бараа-агуулах-периодын C1-ээс эхэлж мөр
// бүрд хуримтлагдана, сүүлийн мөр C2-той тулна (acceptance №9-11):
//
//   Running Qty(n)    = C1 Qty + Σ орлогын тоо − Σ зарлагын тоо
//   Running Amount(n) = C1 Amount + Σ орлогын дүн − Σ (зарлагын тоо × PWA)
//
// Мөр бүрийн дүн: өртөгтэй орлого нь БОДИТ дүнгээ, дунджаар үнэлэгдэх
// орлого (тооллогын илүүдэл, буцаж ирсэн) болон БҮХ зарлага нэг л PWA-г
// хэрэглэнэ — moving average ДАХИН БОДОХГҮЙ (§3.4).
//
// Период тооцоологдоогүй, мөр үнэлэгдээгүй, эсвэл шилжүүлэг (OD-014 —
// үнэлгээгүй) таарвал Running Amount тэр мөрөөс хойш ТОДОРХОЙГҮЙ (null)
// болно — таамаг өртөг зохиохгүй. Running Qty үргэлж бодогдоно.

import { scopeKey } from "./periodic";
import { roundMoney as round2 } from "@/lib/arap/accounting";

export type RunningKind =
  | "priced-in" // худалдан авалт — бодит орлогын дүнтэй
  | "avg-in" // илүүдэл, буцаж ирсэн — PWA-гаар
  | "avg-out" // зарлага, дутагдал, буцаалт — PWA-гаар
  | "transfer"; // тоо хөдөлнө, үнэлгээгүй (OD-014)

export interface RunningMovement {
  movementId: string;
  itemId: string;
  warehouseId: string;
  periodCode: string;
  /** Эрэмбэлэгдсэн байх ёстой: date → createdAt → id. */
  kind: RunningKind;
  /** Тэмдэгтэй тоо: орлого/transfer-in эерэг, зарлага/transfer-out сөрөг. */
  quantityDelta: number;
  /** "priced-in"-ийн бодит орлогын дүн (идэвхтэй бичилтүүдийн нийлбэр). null = үнэлэгдээгүй. */
  inboundAmount: number | null;
}

export interface ScopePeriodBasis {
  openingQty: number;
  openingAmount: number;
  /** Периодын жигнэсэн дундаж — тооцоологдоогүй бол null. */
  average: number | null;
}

export interface RunningValue {
  qty: number;
  /** null = энэ мөрөөс хойш дүн тодорхойгүй (үнэлэгдээгүй зүйл таарсан). */
  amount: number | null;
}

const round4 = (value: number) => Math.round(value * 10000) / 10000;

/**
 * Хөдөлгөөн бүрийн ДАРААХ running утгыг буцаана (movementId → утга).
 * `basis` нь scopeKey::periodCode → C1 ба PWA.
 */
export function computeRunningBalances(
  movements: RunningMovement[],
  basis: Map<string, ScopePeriodBasis>
): Map<string, RunningValue> {
  const out = new Map<string, RunningValue>();
  /** Идэвхтэй scope-периодын явцын төлөв. */
  const state = new Map<string, { qty: number; amount: number | null }>();

  for (const movement of movements) {
    const key = `${scopeKey(movement.itemId, movement.warehouseId)}::${movement.periodCode}`;
    let current = state.get(key);
    if (!current) {
      const start = basis.get(key);
      current = start
        ? { qty: start.openingQty, amount: start.openingAmount }
        : { qty: 0, amount: null }; // период тооцоологдоогүй → дүн тодорхойгүй
      state.set(key, current);
    }

    current.qty = round4(current.qty + movement.quantityDelta);

    if (current.amount !== null) {
      const average = basis.get(key)?.average ?? null;
      switch (movement.kind) {
        case "priced-in":
          current.amount =
            movement.inboundAmount === null
              ? null
              : round2(current.amount + movement.inboundAmount);
          break;
        case "avg-in":
        case "avg-out":
          current.amount =
            average === null
              ? null
              : round2(current.amount + movement.quantityDelta * average);
          break;
        case "transfer":
          // Шилжүүлгийн үнэлгээ батлагдаагүй (OD-014) — дүн үл мэдэгдэнэ.
          current.amount = null;
          break;
      }
    }

    // Нэг хөдөлгөөнд олон мөр (нэмэлт зардлын бичилт) байж болно — сүүлийн
    // бичилт ялна гэхээсээ хөдөлгөөн НЭГ УДАА орж ирнэ гэж үзнэ (дуудагч
    // тал хөдөлгөөн тус бүрийг нэгтгэж өгнө).
    out.set(movement.movementId, {
      qty: current.qty,
      amount: current.amount,
    });
  }

  return out;
}

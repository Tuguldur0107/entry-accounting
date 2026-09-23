// Бараа материалын дэд дэвтэр ↔ GL тулгалтын ЦЭВЭР логик (docs/cost §5).
//
// DB-гүй тул тесттэй: `transaction-detail.ts` өгөгдлөө уншаад энд дамжуулна.
//
// ХАНГАМЖИЙН PO ХААЛТ (§5a ⑥): хаалтын журнал нь түр дансуудыг тэгшитгэдэг
// боловч ӨРТГИЙН бичилт БИШ (costEntryId байхгүй) — тиймээс "гараар бичсэн"
// мөр гэж тоологдвол хаагдсан PO бүр дээр ХУДАЛ зөрүү гарна (дэд дэвтэр
// −2,410,000 vs GL 0). Хаалтын журналыг НЭРЛЭЖ тусад нь харуулаад зөрүүнээс
// хасна — чимээгүй нөхөж тэглэхгүй (§5.6: зөрүү ил гарна).

import type { ReconciliationRow } from "./detail-types";

export interface ReconciliationGlLine {
  /** Үндсэн данс (8 орон) — extractMainAccount-оор гаргасан байна. */
  accountNumber: string;
  /** debit − credit */
  delta: number;
  /** Дэд дэвтрийн (өртгийн бичилтийн) лавлагаатай эсэх. */
  linked: boolean;
  /** PO хаалтын журналын мөр эсэх (purchase_orders.closeVoucherId). */
  poClose: boolean;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function buildInventoryReconciliationRows(input: {
  /** Батлагдсан өртгийн бичилтийн нөлөө данс тус бүрээр. */
  subledger: Iterable<readonly [string, number]>;
  glLines: Iterable<ReconciliationGlLine>;
  accountName?: Map<string, string>;
}): ReconciliationRow[] {
  const subledger = new Map<string, number>();
  for (const [code, amount] of input.subledger)
    subledger.set(code, (subledger.get(code) ?? 0) + amount);

  const gl = new Map<string, number>();
  const poClose = new Map<string, number>();
  const unlinkedLines = new Map<string, number>();
  const unlinkedAmount = new Map<string, number>();

  for (const line of input.glLines) {
    const code = line.accountNumber;
    gl.set(code, (gl.get(code) ?? 0) + line.delta);
    if (line.poClose) {
      poClose.set(code, (poClose.get(code) ?? 0) + line.delta);
      continue;
    }
    if (line.linked) continue;
    unlinkedLines.set(code, (unlinkedLines.get(code) ?? 0) + 1);
    unlinkedAmount.set(code, (unlinkedAmount.get(code) ?? 0) + line.delta);
  }

  // Харьцуулах олонлог: дэд дэвтрийн данснууд (§5.5). GL-ийн бусад данс энэ
  // тайланд хамаарахгүй.
  const codes = new Set(subledger.keys());

  return [...codes]
    .map((code) => {
      const subledgerAmount = round2(subledger.get(code) ?? 0);
      const glAmount = round2(gl.get(code) ?? 0);
      const poCloseAmount = round2(poClose.get(code) ?? 0);
      return {
        accountNumber: code,
        accountName: input.accountName?.get(code) ?? "",
        subledgerAmount,
        glAmount,
        poCloseAmount,
        difference: round2(subledgerAmount + poCloseAmount - glAmount),
        unlinkedGlLines: unlinkedLines.get(code) ?? 0,
        unlinkedGlAmount: round2(unlinkedAmount.get(code) ?? 0),
      };
    })
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
}

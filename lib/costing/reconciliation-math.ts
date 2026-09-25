// Бараа материалын дэд дэвтэр ↔ GL тулгалтын ЦЭВЭР логик (docs/cost §5).
//
// DB-гүй тул тесттэй: `transaction-detail.ts` өгөгдлөө уншаад энд дамжуулна.
//
// ХАНГАМЖИЙН PO ХААЛТ (§5a ⑥): хаалтын журнал нь түр дансуудыг тэгшитгэдэг
// боловч ӨРТГИЙН бичилт БИШ (costEntryId байхгүй) — тиймээс "гараар бичсэн"
// мөр гэж тоологдвол хаагдсан PO бүр дээр ХУДАЛ зөрүү гарна (дэд дэвтэр
// −2,410,000 vs GL 0). Хаалтын журналыг НЭРЛЭЖ тусад нь харуулаад зөрүүнээс
// хасна — чимээгүй нөхөж тэглэхгүй (§5.6: зөрүү ил гарна).
//
// SIM Trade симуляци (ENT-021/025/073):
//   • PO-гүй АП нэхэмжлэх клирингийн данс руу Dr бичдэг (өртгийн бичилт
//     биш) — капитализаци Cr-ийг «гараар бичсэн 47 мөр»-өөр тайлбарлаж
//     −80 сая худал зөрүү гаргадаг байв. КЛИРИНГИЙН дансан дахь АР/АП
//     баримтын мөрийг `sourceDocAmount` баганаар нэрлэж хасна (бараа
//     материалын дансан дээр бол ЖИНХЭНЭ зөрүү хэвээр — давхар бичилт нуухгүй).
//   • Харьцуулах олонлог нь БАЛАНСЫН данс (1–3) — зарлагын төрлийн тогтмол
//     зардлын данс (73100007 «Бичиг хэрэг»), COGS-ийн бусад бичилт, жилийн
//     хаалтын журнал (5–8 ангиллыг хаадаг) тулгалтад хамаарахгүй.

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
  /**
   * КЛИРИНГИЙН дансан дахь АР/АП баримтын журналын мөр (эх баримтын тал —
   * капитализаци/хуваарилалт түүнийг хаадаг). Ачаалагч зөвхөн клиринг
   * рольтой дансанд тавина.
   */
  sourceDoc?: boolean;
}

/** Тулгалтад хамаарах данс — балансын (1–3 ангилал) данс. */
export function isReconciledAccount(accountNumber: string): boolean {
  return /^[123]/.test(accountNumber);
}

/**
 * Батлагдсан өртгийн бичилтийн ДАНСНЫ дүн — хадгалсан Дт/Кт хостой хамт
 * хэрэглэнэ. `cogs_true_up` нь ТЭМДЭГТЭЙ хадгалагддаг; батлахад сөрөг бол
 * Дт/Кт солигдож абсолют дүнгээр GL-д бичигддэг (lib/actions/costing.ts
 * postCostEntry) тул хадгалсан хос чиглэлээ аль хэдийн агуулна. Тэмдэгтэй
 * дүнг тэр хосоор дахин нэмбэл дэд дэвтэр GL-ээс яг 2× зөрнө (2026-09-24:
 * −4,694.36 залруулга → 9,388.72 худал зөрүү). Бусад төрөл эерэг л байна.
 */
export function postedEntryAmount(entry: {
  entryType: string;
  amount: number | string;
}): number {
  const amount = Number(entry.amount);
  return entry.entryType === "cogs_true_up" ? Math.abs(amount) : amount;
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
  const sourceDoc = new Map<string, number>();
  const unlinkedLines = new Map<string, number>();
  const unlinkedAmount = new Map<string, number>();

  for (const line of input.glLines) {
    const code = line.accountNumber;
    gl.set(code, (gl.get(code) ?? 0) + line.delta);
    if (line.poClose) {
      poClose.set(code, (poClose.get(code) ?? 0) + line.delta);
      continue;
    }
    if (line.sourceDoc) {
      sourceDoc.set(code, (sourceDoc.get(code) ?? 0) + line.delta);
      continue;
    }
    if (line.linked) continue;
    unlinkedLines.set(code, (unlinkedLines.get(code) ?? 0) + 1);
    unlinkedAmount.set(code, (unlinkedAmount.get(code) ?? 0) + line.delta);
  }

  // Харьцуулах олонлог: дэд дэвтрийн данснууд (§5.5). GL-ийн бусад данс энэ
  // тайланд хамаарахгүй.
  const codes = new Set([...subledger.keys()].filter(isReconciledAccount));

  return [...codes]
    .map((code) => {
      const subledgerAmount = round2(subledger.get(code) ?? 0);
      const glAmount = round2(gl.get(code) ?? 0);
      const poCloseAmount = round2(poClose.get(code) ?? 0);
      const sourceDocAmount = round2(sourceDoc.get(code) ?? 0);
      return {
        accountNumber: code,
        accountName: input.accountName?.get(code) ?? "",
        subledgerAmount,
        glAmount,
        poCloseAmount,
        sourceDocAmount,
        difference: round2(subledgerAmount + poCloseAmount + sourceDocAmount - glAmount),
        unlinkedGlLines: unlinkedLines.get(code) ?? 0,
        unlinkedGlAmount: round2(unlinkedAmount.get(code) ?? 0),
      };
    })
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
}

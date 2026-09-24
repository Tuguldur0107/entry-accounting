// Өнчин төлөлтийн (orphan settlement) цэвэрлэгээний ЦЭВЭР логик.
//
// `ar_ap_settlements.cash_document_id` нь `on delete set null` тул кассын
// баримт зохих rollback-гүйгээр устсан тохиолдолд төлөлтийн мөр GL-ийн ЯМАР Ч
// холбоосгүй үлдэж, нэхэмжлэх «төлөгдсөн» гэж харагддаг байв. Улмаар хяналтын
// данс (АР/АП) ↔ нээлттэй баримтын зөрүү ТОГТМОЛ үлдэж `reconcile_modules`
// улаанаар заана.
//
// Өнчин = `cash_document_id IS NULL` БА `voucher_id IS NULL`: кассын баримт ч,
// суутган тооцооны журнал ч байхгүй тул төлөлтийн БАРИМТ нь ҮГҮЙ.
//
// Энэ модуль DB-д ХАНДАХГҮЙ — зөвхөн нэхэмжлэх тус бүрийн хасалт ба шинэ
// төлвийг бодно (тесттэй). Бичилтийг scripts/cleanup-orphan-settlements.mjs хийнэ.

const EPS = 0.005;

/** Дүнг 2 орон хүртэл бөөрөнхийлнө (₮). */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Төлөлт хасагдсаны ДАРААХ төлвийг бодно. Нэхэмжлэхийн одоогийн төлөв
 * тооцооны мужид (posted / partially_paid / paid) байхгүй бол ХӨНДӨХГҮЙ
 * (ноорог, буцаагдсан баримтын төлвийг цэвэрлэгээ таамаглахгүй).
 */
export function statusAfterRollback({ status, totalAmount, paidAfter }) {
  if (!["posted", "partially_paid", "paid"].includes(status)) return status;
  if (paidAfter <= EPS) return "posted";
  if (paidAfter >= totalAmount - EPS) return "paid";
  return "partially_paid";
}

/**
 * Өнчин төлөлтийн мөрүүдийг нэхэмжлэхээр нэгтгэж төлөвлөгөө буцаана.
 *
 * rows     — өнчин мөрүүд: id, documentId, amount, baseAmount
 * invoices — нэхэмжлэхүүд: id, totalAmount, paidAmount, basePaidAmount, status
 * буцаалт  — plans (нэхэмжлэх бүрийн шинэ дүн/төлөв), settlementIds (устгах
 *            мөрүүд), missingInvoices (нэхэмжлэх нь олдоогүй мөрийн documentId)
 */
export function planSettlementRollback(rows, invoices) {
  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const sums = new Map();
  const settlementIds = [];
  const missingInvoices = [];

  for (const row of rows) {
    settlementIds.push(row.id);
    const slot = sums.get(row.documentId) ?? { amount: 0, baseAmount: 0, count: 0 };
    slot.amount += Number(row.amount) || 0;
    slot.baseAmount += Number(row.baseAmount ?? row.amount) || 0;
    slot.count += 1;
    sums.set(row.documentId, slot);
  }

  const plans = [];
  for (const [documentId, slot] of sums) {
    const invoice = byId.get(documentId);
    if (!invoice) {
      missingInvoices.push(documentId);
      continue;
    }
    const totalAmount = Number(invoice.totalAmount) || 0;
    const paidBefore = Number(invoice.paidAmount) || 0;
    const basePaidBefore = Number(invoice.basePaidAmount ?? invoice.paidAmount) || 0;
    const paidAfter = Math.max(round2(paidBefore - round2(slot.amount)), 0);
    const basePaidAfter = Math.max(round2(basePaidBefore - round2(slot.baseAmount)), 0);
    plans.push({
      documentId,
      settlementCount: slot.count,
      amount: round2(slot.amount),
      paidBefore: round2(paidBefore),
      paidAfter,
      basePaidAfter,
      status: statusAfterRollback({ status: invoice.status, totalAmount, paidAfter }),
      statusBefore: invoice.status,
    });
  }
  return { plans, settlementIds, missingInvoices };
}

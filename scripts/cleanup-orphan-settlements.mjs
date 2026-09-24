// Өнчин төлөлтийн мөрүүдийг цэвэрлэнэ — нэхэмжлэхийн үлдэгдэл, төлөв сэргэнэ.
//
// АСУУДАЛ: `ar_ap_settlements.cash_document_id` нь `on delete set null` тул
// кассын баримт зохих rollback-гүйгээр устсан үед төлөлтийн мөр GL-ийн ямар ч
// холбоосгүй үлдэж, нэхэмжлэх «төлөгдсөн» гэж харагдана. Хяналтын данс (АР/АП)
// ↔ нээлттэй баримтын зөрүү ТОГТМОЛ үлдэж, reconcile_modules улаанаар заана.
// Одоогийн `deleteCashDocument` / `reverseCashDocument` / `reverseArApOffset`
// гурвуул rollback хийдэг — энэ script нь ТҮҮНЭЭС ӨМНӨ үүссэн мөрүүдийг нөхнө.
//
// ДҮРЭМ:
//   - Өнчин гэж ЗӨВХӨН `cash_document_id IS NULL` БА `voucher_id IS NULL`
//     мөрийг үзнэ — кассын баримт эсвэл суутган тооцооны журнал байгаа
//     төлөлтийг ХЭЗЭЭ Ч хөндөхгүй (тэр нь бодит баримттай).
//   - paidAmount 0-оос доош ОРОХГҮЙ, төлөв нь дүнгээсээ бодогдоно.
//   - Ноорог / буцаагдсан нэхэмжлэхийн төлөв ХӨНДӨГДӨХГҮЙ.
//   - Идемпотент: өнчин мөр байхгүй бол DB-д юу ч бичихгүй.
//   - GL-д ХЭЗЭЭ Ч бичихгүй — өнчин мөрөнд журнал БАЙХГҮЙ тул засах журнал ч
//     байхгүй (дүнг ЗОХИОХГҮЙ).
//
// Шийдвэрийн ЦЭВЭР логик: scripts/lib/settlement-cleanup-plan.mjs (тесттэй).
//
// Ажиллуулах: node scripts/cleanup-orphan-settlements.mjs   (preDeploy дууддаг)

import { config } from "dotenv";
import postgres from "postgres";

import { planSettlementRollback } from "./lib/settlement-cleanup-plan.mjs";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("cleanup-orphan-settlements: DATABASE_URL алга — алгаслаа");
  process.exit(0);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

async function tableExists(name) {
  const [row] = await sql`
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = ${name} limit 1`;
  return Boolean(row);
}

async function main() {
  if (!(await tableExists("ar_ap_settlements"))) {
    console.log("cleanup-orphan-settlements: ar_ap_settlements хүснэгт алга — алгаслаа");
    return;
  }

  const orphans = await sql`
    select id, document_id, amount, base_amount
    from ar_ap_settlements
    where cash_document_id is null and voucher_id is null
    order by settlement_date`;

  if (orphans.length === 0) {
    console.log("cleanup-orphan-settlements: өнчин төлөлт алга — өөрчлөлтгүй");
    return;
  }

  const invoiceIds = [...new Set(orphans.map((row) => row.document_id))];
  const invoices = await sql`
    select id, total_amount, paid_amount, base_paid_amount, status
    from ar_ap_documents where id in ${sql(invoiceIds)}`;

  const { plans, settlementIds, missingInvoices } = planSettlementRollback(
    orphans.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      amount: row.amount,
      baseAmount: row.base_amount,
    })),
    invoices.map((row) => ({
      id: row.id,
      totalAmount: row.total_amount,
      paidAmount: row.paid_amount,
      basePaidAmount: row.base_paid_amount,
      status: row.status,
    }))
  );

  for (const id of missingInvoices)
    console.warn(`cleanup-orphan-settlements: нэхэмжлэх ${id} олдсонгүй — мөр устгагдана`);

  await sql.begin(async (tx) => {
    for (const plan of plans) {
      await tx`
        update ar_ap_documents
        set paid_amount = ${String(plan.paidAfter)},
            base_paid_amount = ${String(plan.basePaidAfter)},
            status = ${plan.status}
        where id = ${plan.documentId}`;
      console.log(
        `cleanup-orphan-settlements: ${plan.documentId} — өнчин ${plan.settlementCount} мөр, ` +
          `${plan.amount.toLocaleString("en-US")}₮ хасагдав (төлөгдсөн ` +
          `${plan.paidBefore.toLocaleString("en-US")} → ${plan.paidAfter.toLocaleString("en-US")}, ` +
          `төлөв ${plan.statusBefore} → ${plan.status})`
      );
    }
    await tx`delete from ar_ap_settlements where id in ${tx(settlementIds)}`;
  });

  console.log(
    `cleanup-orphan-settlements: ${settlementIds.length} өнчин төлөлт устгагдав, ${plans.length} нэхэмжлэх сэргэв`
  );
}

main()
  .catch((error) => {
    console.error("cleanup-orphan-settlements: алдаа —", error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });

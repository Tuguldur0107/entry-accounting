// Дугааргүй журналын бичилтүүдэд дугаар нөхөж олгоно (CLAUDE.md §2a).
//
// `journal_vouchers.document_no` багана нэмэгдэхээс ӨМНӨ бичигдсэн журналууд
// дугааргүй (NULL) байсан. Энэ script тэдгээрт ОГНООНЫ дарааллаар дугаар
// олгоно — шинэ бичилттэй ижил "<МОДУЛЬ>-<YY>-<NNNNNN>" форматаар.
//
// ЭХ МОДУЛИЙГ ТАЙЛБАРЫН ТЕКСТЭЭР ТААХГҮЙ. Дэд дэвтрийн хүснэгтүүд журналдаа
// шууд холбогдсон байдаг (cash_documents.voucher_id, ar_ap_documents.
// voucher_id, fa_depreciation_entries.voucher_id …) тул модулийг ТЭР
// холбоосоор тодорхойлно. Холбоосгүй үлдсэнийг журналын мөрийн дэд дэвтрийн
// түлхүүр, externalRef-ийн угтвар, буцаалтын эх журналаар дарааллан шалгаж,
// эцэст нь "gl" гэж үзнэ.
//
// ДҮРЭМ:
//   - Аль хэдийн дугаартай бичилтийг ХЭЗЭЭ Ч дахин дугаарлахгүй (дугаар нь
//     баримтын мөнхийн танигдахуун).
//   - Scope (жишээ нь "CM-26") дотор хэдийн олгогдсон хамгийн их дугаарын
//     ДАРАА-аас үргэлжилнэ — давхцал үүсэхгүй.
//   - Идемпотент: дахин ажиллуулахад дугааргүй мөр үлдээгүй бол юу ч хийхгүй.
//   - `document_counters` тоолуурыг эцэст нь нөхөж тохируулна — шинэ бичилт
//     нөхөж олгосон дугаарын ДАРААГААС үргэлжилнэ.
//
// Шийдвэрийн ЦЭВЭР логик нь scripts/lib/voucher-number-plan.mjs (тесттэй);
// энэ файл зөвхөн DB-ийн уншилт/бичилт хийнэ.
//
// Ажиллуулах: node scripts/backfill-voucher-numbers.mjs  (preDeploy дууддаг)

import { config } from "dotenv";
import postgres from "postgres";

import {
  MODULE_CODES,
  planVoucherNumbers,
} from "./lib/voucher-number-plan.mjs";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("backfill-voucher-numbers: DATABASE_URL алга — алгаслаа");
  process.exit(0);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

/**
 * Дэд дэвтрийн холбоосоор модулийг тодорхойлно. Хүснэгт/багана байхгүй бол
 * (хуучин fork, дутуу migration) чимээгүй алгасна — нөхөлт зогсохгүй.
 */
const LINK_SOURCES = [
  ["cash_documents", ["voucher_id", "reversal_voucher_id"], () => "cash"],
  ["bank_statement_lines", ["voucher_id"], () => "cash"],
  ["cash_fx_revaluations", ["voucher_id", "reversal_voucher_id"], () => "fx"],
  [
    "ar_ap_documents",
    ["voucher_id", "reversal_voucher_id"],
    (row) => (row.document_type === "ar_invoice" ? "ar" : "ap"),
    "document_type",
  ],
  // АР↔АП суутган — авлагын талаас дугаарлана (шинэ бичилттэй ижил дүрэм).
  ["ar_ap_settlements", ["voucher_id"], () => "ar"],
  ["fa_depreciation_entries", ["voucher_id", "reversal_voucher_id"], () => "fa"],
  ["fixed_assets", ["disposal_voucher_id"], () => "fa"],
  ["cost_entries", ["voucher_id", "reversal_voucher_id"], () => "cost"],
  ["purchase_orders", ["close_voucher_id"], () => "proc"],
  ["goods_receipts", ["voucher_id", "reversal_voucher_id"], () => "proc"],
  ["payroll_runs", ["voucher_id"], () => "payroll"],
];

async function collectLinks() {
  // Next.js-ийн lint дүрэм `module` нэртэй хувьсагч зөвшөөрдөггүй.
  const byVoucher = new Map();
  const mark = (id, key) => {
    if (id && !byVoucher.has(id)) byVoucher.set(id, key);
  };

  for (const [table, columns, pick, extra] of LINK_SOURCES) {
    const selected = [...columns, ...(extra ? [extra] : [])].join(", ");
    const where = columns.map((column) => `${column} is not null`).join(" or ");
    try {
      const rows = await sql.unsafe(
        `select ${selected} from ${table} where ${where}`
      );
      for (const row of rows)
        for (const column of columns) mark(row[column], pick(row));
    } catch (error) {
      console.log(`⚠ ${table} уншигдсангүй: ${error.message}`);
    }
  }

  // Журналын МӨРИЙН дэд дэвтрийн түлхүүр — дээрхээр олдоогүй бичилтэд.
  try {
    const rows = await sql`
      select distinct voucher_id, inventory_movement_id, cost_entry_id,
             business_object_type
      from journal_lines
      where inventory_movement_id is not null
         or cost_entry_id is not null
         or business_object_type is not null
    `;
    for (const row of rows) {
      if (row.business_object_type === "purchase_order")
        mark(row.voucher_id, "proc");
      else if (row.cost_entry_id) mark(row.voucher_id, "cost");
      else if (row.inventory_movement_id) mark(row.voucher_id, "inv");
    }
  } catch (error) {
    console.log(`⚠ journal_lines уншигдсангүй: ${error.message}`);
  }

  return byVoucher;
}

async function main() {
  const pending = await sql`
    select id, organization_id, date, external_ref, reversal_of_voucher_id
    from journal_vouchers
    where document_no is null
    order by date, created_at, id
  `;

  if (pending.length === 0) {
    console.log("backfill-voucher-numbers: дугааргүй бичилт алга — алгаслаа");
    await sql.end();
    return;
  }

  const used = await sql`
    select organization_id, document_no
    from journal_vouchers
    where document_no is not null
  `;

  const { updates, counters, byModule } = planVoucherNumbers({
    vouchers: pending.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      date: row.date,
      externalRef: row.external_ref,
      reversalOfVoucherId: row.reversal_of_voucher_id,
    })),
    moduleById: await collectLinks(),
    usedDocumentNos: used.map((row) => ({
      organizationId: row.organization_id,
      documentNo: row.document_no,
    })),
  });

  // 500 мөрөөр багцлаад нэг UPDATE ... FROM unnest(...)-ээр бичнэ.
  // `document_no is null` нөхцөл нь давхар ажиллуулалтаас хамгаална.
  const CHUNK = 500;
  for (let index = 0; index < updates.length; index += CHUNK) {
    const chunk = updates.slice(index, index + CHUNK);
    await sql`
      update journal_vouchers as v
      set document_no = patch.document_no
      from (
        select
          unnest(${sql.array(chunk.map((row) => row.id))}::uuid[]) as id,
          unnest(${sql.array(chunk.map((row) => row.documentNo))}::text[])
            as document_no
      ) as patch
      where v.id = patch.id and v.document_no is null
    `;
  }

  // Тоолуурыг нөхөж тохируулна — шинэ бичилт нөхсөн дугаарын ДАРААГААС.
  for (const counter of counters) {
    await sql`
      insert into document_counters (organization_id, scope, value, updated_at)
      values (${counter.organizationId}, ${counter.scope}, ${counter.value}, now())
      on conflict (organization_id, scope)
      do update set value = greatest(document_counters.value, ${counter.value}),
                    updated_at = now()
    `;
  }

  const summary = [...byModule.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${MODULE_CODES[key]}×${count}`)
    .join(" ");
  console.log(
    `backfill-voucher-numbers: ${updates.length} бичилт дугаарлагдлаа — ${summary}`
  );
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    // Нөхөлт бүтэлгүйтсэн нь deploy-г зогсоохгүй — апп дугааргүй мөртэй ч
    // ажиллана (UI-д «—»). Шалтгаан нь лог дээр ил.
    console.error("backfill-voucher-numbers:", error);
    process.exit(0);
  });

// Аудит + НӨАТ-ийн schema объектууд live DB-д бүрэн байгааг батлах шалгалт.
// Ажиллуулах: npx tsx scripts/verify-audit-ddl.ts

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  let failures = 0;

  async function expectIndex(name: string) {
    const rows = await sql`select 1 from pg_indexes where indexname = ${name}`;
    console.log(`${rows.length > 0 ? "✓" : "✗ ДУТУУ"} index ${name}`);
    if (rows.length === 0) failures += 1;
  }
  async function expectColumn(table: string, column: string) {
    const rows = await sql`select 1 from information_schema.columns
      where table_name = ${table} and column_name = ${column}`;
    console.log(`${rows.length > 0 ? "✓" : "✗ ДУТУУ"} ${table}.${column}`);
    if (rows.length === 0) failures += 1;
  }
  async function expectTable(table: string) {
    const rows = await sql`select 1 from information_schema.tables
      where table_name = ${table}`;
    console.log(`${rows.length > 0 ? "✓" : "✗ ДУТУУ"} table ${table}`);
    if (rows.length === 0) failures += 1;
  }

  for (const name of [
    "cash_documents_user_id_document_no_unique",
    "journal_vouchers_user_date_ix",
    "journal_vouchers_user_status_ix",
    "journal_lines_voucher_ix",
    "journal_lines_cost_entry_ix",
    "journal_lines_inventory_movement_ix",
    "cash_documents_user_status_ix",
    "cash_documents_user_date_ix",
    "ar_ap_documents_user_status_ix",
    "ar_ap_documents_user_date_ix",
    "ar_ap_settlements_document_ix",
    "ar_ap_settlements_cash_document_ix",
    "inventory_movements_user_status_ix",
    "inventory_movements_user_date_ix",
    "cost_entries_user_status_ix",
    "cost_entries_movement_active_uq",
    "fa_dep_entries_asset_month_active_uq",
    "journal_vouchers_user_external_ref_uq",
    "cash_documents_user_external_ref_uq",
    "ar_ap_documents_user_external_ref_uq",
  ])
    await expectIndex(name);

  await expectColumn("journal_vouchers", "reversal_of_voucher_id");
  await expectColumn("costing_account_settings", "fx_gain_account_number");
  await expectColumn("costing_account_settings", "fx_loss_account_number");
  await expectTable("vat_settings");

  const [def] = await sql`select column_default from information_schema.columns
    where table_name = 'journal_vouchers' and column_name = 'status'`;
  const okDefault = String(def?.column_default ?? "").includes("draft");
  console.log(
    `${okDefault ? "✓" : "✗ ДУТУУ"} journal_vouchers.status default = draft (одоо: ${def?.column_default})`
  );
  if (!okDefault) failures += 1;

  const [fk] = await sql`select 1 as ok from pg_constraint
    where conname = 'journal_vouchers_reversal_of_voucher_id_journal_vouchers_id_fk'`;
  console.log(`${fk ? "✓" : "✗ ДУТУУ"} reversal_of_voucher_id FK`);
  if (!fk) failures += 1;

  console.log(
    failures === 0
      ? "\nБҮГД БАЙНА — DB нь schema-тай нийцтэй."
      : `\n${failures} объект дутуу!`
  );
  await sql.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

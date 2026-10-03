// Өртгийн бичилт (Periodic Weighted Average, NRV, landed cost, COGS true-up) —
// lib/actions/costing.ts, lib/actions/cost-allocation.ts. docs/cost/, docs/dev/costing.md.

import { defineObject } from "../define";

export const costEntry = defineObject({
  key: "cost_entry",
  label: "Өртгийн бичилт",
  layer: "core",
  module: "cost",
  table: "cost_entries",
  statusColumn: "status",
  states: {
    draft: { label: "Ноорог", ledger: "none" },
    posted: { label: "Батлагдсан", ledger: "posted" },
    reversed: { label: "Буцаагдсан", ledger: "reversed", terminal: true },
  },
  initial: ["draft", "posted"],
  transitions: [
    {
      action: "create",
      from: [],
      to: "draft",
      permission: { module: "cost", level: "write" },
      guards: [],
      tool: { name: "run_monthly_costing", aliases: ["create_cost_allocation"] },
      note: "Сарын бодолт (зарлага бүрд, хөдөлгөөн × НЭГ идэвхтэй бичилт), NRV, нэмэлт зардлын хуваарилалт. POS-ийн урьдчилсан COGS борлуулалттай хамт «posted» үүснэ.",
    },
    {
      action: "post",
      from: ["draft"],
      to: "posted",
      permission: { module: "cost", level: "post" },
      guards: ["period_open", "ai_post_mode", "ai_post_limit"],
      effects: ["journal", "voucher_no", "hook:beforeJournalPost"],
      tool: { name: "post_cost_entries" },
      note: "Данс costing_account_settings / costing_item_settings-ээс — кодод хатуу дугааргүй.",
    },
    {
      action: "reverse",
      from: ["posted"],
      to: "reversed",
      permission: { module: "cost", level: "post" },
      guards: ["period_open", "not_source_locked", "ai_post_mode", "ai_post_limit"],
      effects: ["journal", "voucher_no"],
      tool: { name: "reverse_cost_entry", aliases: ["reverse_cost_allocation"] },
      note: "Хуваалцсан журналыг бүхэлд нь НЭГ удаа буцаана (C3).",
    },
    {
      action: "delete",
      from: ["draft"],
      to: null,
      permission: { module: "cost", level: "post" },
      guards: [],
      tool: { name: "delete_cost_entry" },
    },
  ],
  relations: [
    { name: "run", targetTable: "costing_runs", column: "run_id", kind: "fk", cardinality: "one" },
    { name: "movement", targetTable: "inventory_movements", column: "movement_id", kind: "fk", cardinality: "one" },
    { name: "item", targetTable: "inventory_items", column: "item_id", kind: "fk", cardinality: "one" },
    { name: "warehouse", targetTable: "warehouses", column: "warehouse_id", kind: "fk", cardinality: "one" },
    { name: "voucher", targetTable: "journal_vouchers", column: "voucher_id", kind: "fk", cardinality: "one" },
    { name: "reversalVoucher", targetTable: "journal_vouchers", column: "reversal_voucher_id", kind: "fk", cardinality: "one" },
  ],
  note: "ЗӨВХӨН Periodic Weighted Average (бараа × агуулах × компани, сар); үнэ ХЭЗЭЭ Ч зохиохгүй; суурь нь cost_period_results — GL-ээс өртөг бодохгүй.",
});

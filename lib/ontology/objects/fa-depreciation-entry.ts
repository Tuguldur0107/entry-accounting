// Үндсэн хөрөнгийн сарын элэгдлийн бичилт — lib/actions/fa.ts. docs/dev/fixed-assets.md.

import { defineObject } from "../define";

export const faDepreciationEntry = defineObject({
  key: "fa_depreciation_entry",
  label: "Элэгдлийн бичилт",
  layer: "core",
  module: "fa",
  table: "fa_depreciation_entries",
  statusColumn: "status",
  states: {
    draft: { label: "Ноорог", ledger: "none" },
    posted: { label: "Батлагдсан", ledger: "posted" },
    reversed: { label: "Буцаагдсан", ledger: "reversed", terminal: true },
  },
  initial: ["draft"],
  transitions: [
    {
      action: "create",
      from: [],
      to: "draft",
      permission: { module: "fa", level: "write" },
      guards: ["period_open", "ai_post_mode", "ai_post_limit"],
      tool: { name: "run_fa_depreciation" },
      note: "Сарын бодолт (хөрөнгө × сар НЭГ идэвхтэй бичилт). Батлагдсан сарыг дахин бодоход өмнөхийг автоматаар буцаана = батлах үйлдэл (fa:post, AI-д шууд горим + хязгаар).",
    },
    {
      action: "post",
      from: ["draft"],
      to: "posted",
      permission: { module: "fa", level: "post" },
      guards: ["period_open", "ai_post_mode", "ai_post_limit"],
      effects: ["journal", "voucher_no", "hook:beforeJournalPost"],
      tool: { name: "post_fa_depreciation" },
      note: "Сарын бүх элэгдэл НЭГ журнал.",
    },
    {
      action: "reverse",
      from: ["posted"],
      to: "reversed",
      permission: { module: "fa", level: "post" },
      guards: ["period_open", "ai_post_mode", "ai_post_limit"],
      effects: ["journal", "voucher_no"],
      tool: { name: "reverse_fa_depreciation" },
      note: "ЗӨВХӨН журналаар (reverseDepreciationVouchersInTx) — нэгтгэсэн журналын бүх бичилт хамт; буцаагдсан журналыг дахин сторно хийхгүй.",
    },
    {
      action: "delete",
      from: ["draft"],
      to: null,
      permission: { module: "fa", level: "post" },
      guards: [],
      note: "Вэбээс л (MCP tool алга).",
    },
  ],
  relations: [
    { name: "asset", targetTable: "fixed_assets", column: "asset_id", kind: "fk", cardinality: "one" },
    { name: "voucher", targetTable: "journal_vouchers", column: "voucher_id", kind: "fk", cardinality: "one" },
    { name: "reversalVoucher", targetTable: "journal_vouchers", column: "reversal_voucher_id", kind: "fk", cardinality: "one" },
  ],
});

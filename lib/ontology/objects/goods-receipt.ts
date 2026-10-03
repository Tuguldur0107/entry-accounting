// Барааны хүлээн авалт (PO-ийн) — lib/actions/procurement.ts. docs/dev/procurement.md.

import type { GoodsReceiptStatus } from "@/lib/procurement/types";

import { defineObject } from "../define";

export const goodsReceipt = defineObject<GoodsReceiptStatus>({
  key: "goods_receipt",
  label: "Барааны хүлээн авалт",
  layer: "core",
  module: "proc",
  table: "goods_receipts",
  statusColumn: "status",
  states: {
    draft: { label: "Ноорог", ledger: "none", editable: true },
    confirmed: { label: "Баталгаажсан", ledger: "posted" },
    reversed: { label: "Буцаагдсан", ledger: "reversed", terminal: true },
  },
  initial: ["draft", "confirmed"],
  transitions: [
    {
      action: "create",
      from: [],
      to: "draft",
      permission: { module: "proc", level: "write" },
      guards: ["period_open"],
      tool: { name: "create_goods_receipt" },
      note: "Зөвхөн нээлттэй (open) PO-д; үлдэгдлээс хэтрэхгүй ([OVER_RECEIVED]). confirmNow-оор шууд батлагдана (proc:post).",
    },
    {
      action: "update",
      from: ["draft"],
      to: "draft",
      permission: { module: "proc", level: "write" },
      guards: ["period_open"],
      note: "Вэбээс л (MCP tool алга).",
    },
    {
      action: "confirm",
      from: ["draft"],
      to: "confirmed",
      permission: { module: "proc", level: "post" },
      guards: ["period_open", "ai_post_mode", "ai_post_limit"],
      effects: ["journal", "voucher_no", "hook:beforeJournalPost"],
      tool: { name: "confirm_goods_receipt" },
      note: "Хүлээн авсан ӨДРИЙН Монголбанкны ханшаар; po_receipt бараа хөдөлгөөн үүснэ. PO мөрийг түгжиж дахин шалгана (M8).",
    },
    {
      action: "reverse",
      from: ["confirmed"],
      to: "reversed",
      permission: { module: "proc", level: "post" },
      guards: ["period_open", "ai_post_mode", "ai_post_limit"],
      effects: ["journal", "voucher_no"],
      tool: { name: "reverse_goods_receipt" },
      note: "Хаагдсан PO-ийнхыг буцаахгүй; хуваарилсан нэмэлт зардал (landed cost) байвал эхлээд түүнийг буцаана.",
    },
    {
      action: "delete",
      from: ["draft"],
      to: null,
      permission: { module: "proc", level: "write" },
      guards: [],
      tool: { name: "delete_goods_receipt" },
    },
  ],
  relations: [
    { name: "purchaseOrder", targetTable: "purchase_orders", column: "purchase_order_id", kind: "fk", cardinality: "one" },
    { name: "warehouse", targetTable: "warehouses", column: "warehouse_id", kind: "fk", cardinality: "one" },
    { name: "voucher", targetTable: "journal_vouchers", column: "voucher_id", kind: "fk", cardinality: "one" },
    { name: "reversalVoucher", targetTable: "journal_vouchers", column: "reversal_voucher_id", kind: "fk", cardinality: "one" },
    { name: "lines", targetTable: "goods_receipt_lines", column: "receipt_id", kind: "fk", cardinality: "many" },
  ],
  idempotency: { column: "external_ref" },
});

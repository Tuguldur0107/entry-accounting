// Бараа материалын хөдөлгөөн — lib/actions/inventory.ts. docs/dev/costing.md.
// Хөдөлгөөн өөрөө GL журнал үүсгэхгүй — өртгийг сарын Periodic Weighted Average
// (cost_entry) бодно.

import { defineObject } from "../define";

export const inventoryMovement = defineObject({
  key: "inventory_movement",
  label: "Бараа материалын хөдөлгөөн",
  layer: "core",
  module: "inv",
  table: "inventory_movements",
  statusColumn: "status",
  states: {
    draft: { label: "Ноорог", ledger: "none", editable: true },
    confirmed: { label: "Баталгаажсан", ledger: "none" },
    cancelled: { label: "Цуцлагдсан", ledger: "none" },
  },
  initial: ["draft", "confirmed"],
  transitions: [
    {
      action: "create",
      from: [],
      to: "draft",
      permission: { module: "inv", level: "write" },
      guards: [],
      tool: {
        name: "create_inventory_movement",
        aliases: ["record_inventory_count", "create_opening_stock"],
      },
      note: "Төрөл receipt | issue | transfer | adjustment (тооллого = тэмдэгтэй adjustment). «Шууд бичих» горимд шууд «confirmed».",
    },
    {
      action: "update",
      from: ["draft"],
      to: "draft",
      permission: { module: "inv", level: "write" },
      guards: ["not_source_locked"],
      tool: { name: "update_inventory_movement" },
    },
    {
      action: "confirm",
      from: ["draft"],
      to: "confirmed",
      permission: { module: "inv", level: "post" },
      guards: ["period_open", "not_future_period", "ai_post_mode"],
      tool: { name: "confirm_inventory_movement" },
      note: "Бараа, агуулах, тоо заавал; хасах үлдэгдэл тохиргоогоор хориглогдоно.",
    },
    {
      action: "cancel",
      from: ["confirmed"],
      to: "cancelled",
      permission: { module: "inv", level: "post" },
      guards: ["period_open", "not_source_locked"],
      note: "Вэбээс л (MCP tool алга). Өртгийн бичилт (draft / posted) үлдсэн бол татгалзана.",
    },
    {
      action: "delete",
      from: ["draft", "confirmed", "cancelled"],
      to: null,
      permission: { module: "inv", level: "post" },
      guards: ["period_open", "not_source_locked", "ai_post_mode"],
      tool: { name: "delete_inventory_movement" },
      note: "Ноорог — write эрхээр. Хүлээн авалтаас (po_receipt) үүссэнийг эндээс устгахгүй — хүлээн авалтаар; өртгийн бичилттэй бол татгалзана.",
    },
  ],
  relations: [
    { name: "item", targetTable: "inventory_items", column: "item_id", kind: "fk", cardinality: "one" },
    { name: "warehouse", targetTable: "warehouses", column: "warehouse_id", kind: "fk", cardinality: "one" },
    { name: "toWarehouse", targetTable: "warehouses", column: "to_warehouse_id", kind: "fk", cardinality: "one" },
    { name: "issueType", targetTable: "inventory_issue_types", column: "issue_type_id", kind: "fk", cardinality: "one" },
    { name: "source(source_type)", targetTable: "ar_ap_document_lines", column: "source_id", kind: "polymorphic", cardinality: "one" },
    { name: "costEntries", targetTable: "cost_entries", column: "movement_id", kind: "fk", cardinality: "many" },
  ],
  idempotency: { column: "external_ref" },
  note: "Эх сурвалж source_type: manual | arap_line | gl_voucher | cash_document | po_receipt. Үнэ ЗОХИОХГҮЙ — өртөггүй / сөрөг үлдэгдэлд тэр бараа-агуулах-сарын өртөг зогсоно.",
});

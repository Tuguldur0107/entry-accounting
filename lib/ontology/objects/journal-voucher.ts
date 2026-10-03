// Журнал (GL) — lib/actions/gl.ts. docs/dev/gl.md.

import { defineObject } from "../define";

export const journalVoucher = defineObject({
  key: "journal_voucher",
  label: "Журнал",
  layer: "core",
  module: "gl",
  table: "journal_vouchers",
  statusColumn: "status",
  states: {
    draft: { label: "Ноорог", ledger: "none", editable: true },
    posted: { label: "Батлагдсан", ledger: "posted" },
    reversed: { label: "Буцаагдсан", ledger: "reversed", terminal: true },
  },
  initial: ["draft", "posted"],
  transitions: [
    {
      action: "create",
      from: [],
      to: "draft",
      permission: { module: "gl", level: "write" },
      guards: ["period_open"],
      effects: ["voucher_no"],
      tool: { name: "create_journal_voucher", aliases: ["create_journal_vouchers_batch"] },
      note: "«Шууд бичих» горимд тэнцсэн, батлах хязгаар доторх бичилт шууд «posted» үүснэ (gl:post, тэнцэл, хяналтын данс).",
    },
    {
      action: "update",
      from: ["draft"],
      to: "draft",
      permission: { module: "gl", level: "write" },
      guards: ["period_open"],
      tool: { name: "update_journal_voucher" },
      note: "Зөвхөн ноорог засагдана; status=posted-оор хадгалбал батлагдана (gl:post).",
    },
    {
      action: "post",
      from: ["draft"],
      to: "posted",
      permission: { module: "gl", level: "post" },
      guards: ["period_open", "not_future_period", "journal_balanced", "control_account", "ai_post_mode", "ai_post_limit"],
      effects: ["hook:beforeJournalPost"],
      tool: { name: "post_journal_voucher", aliases: ["post_journal_vouchers_batch"] },
    },
    {
      action: "reverse",
      from: ["posted"],
      to: "reversed",
      permission: { module: "gl", level: "post" },
      guards: ["period_open", "not_source_locked", "ai_post_mode", "ai_post_limit"],
      effects: ["journal", "voucher_no"],
      tool: { name: "reverse_journal_voucher" },
      note: "Буцаалт = улаан сторно: эх огноогоор, эх талдаа СӨРӨГ дүн, эхийн валют/ханшаар. Дэд дэвтрийн журналыг эх модулиар нь буцаана.",
    },
    {
      action: "delete",
      from: ["draft"],
      to: null,
      permission: { module: "gl", level: "write" },
      guards: [],
      tool: { name: "delete_journal_voucher" },
      note: "Батлагдсан журнал устгагдахгүй — [USE_REVERSAL]; буцаалтын журналыг дангаар нь устгахгүй.",
    },
  ],
  relations: [
    { name: "lines", targetTable: "journal_lines", column: "voucher_id", kind: "fk", cardinality: "many" },
    { name: "reversalOf", targetTable: "journal_vouchers", column: "reversal_of_voucher_id", kind: "fk", cardinality: "one" },
  ],
  idempotency: { column: "external_ref" },
  invariants: ["V01", "V02", "V03"],
  note: "Мөр бүрд дебет ЭСВЭЛ кредит; ΣДт = ΣКт (±0.01). Дугаар <МОДУЛЬ>-<YY>-<NNNNNN>, буцаалт эх модулиа өвлөнө.",
});

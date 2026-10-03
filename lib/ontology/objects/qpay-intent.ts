// QPay Quick QR intent — lib/qpay/intent.ts (ЦЭВЭР машин), lib/actions/qpay.ts.
// docs/pos/04-qpay-integration-plan.md §3.3, docs/dev/pos.md.
// Шилжилтүүд lib/qpay/intent.ts-ийн TRANSITIONS-тэй ЯГ ИЖИЛ (drift тест).

import { QPAY_INTENT_STATUS_LABELS, type QpayIntentStatus } from "@/lib/qpay/constants";

import { defineObject } from "../define";

const label = (status: QpayIntentStatus) => QPAY_INTENT_STATUS_LABELS[status];

export const qpayIntent = defineObject<QpayIntentStatus>({
  key: "qpay_intent",
  label: "QPay төлбөрийн хүсэлт",
  layer: "core",
  module: "pos",
  table: "pos_qpay_intents",
  statusColumn: "status",
  states: {
    open: { label: label("open"), ledger: "none" },
    paid: { label: label("paid"), ledger: "none" },
    finalized: { label: label("finalized"), ledger: "posted", terminal: true },
    cancelled: { label: label("cancelled"), ledger: "none" },
    expired: { label: label("expired"), ledger: "none" },
    failed: { label: label("failed"), ledger: "none" },
    refunded: { label: label("refunded"), ledger: "posted", terminal: true },
  },
  initial: ["open"],
  transitions: [
    {
      action: "create",
      from: [],
      to: "open",
      permission: { module: "pos", level: "write" },
      guards: [],
      note: "Кассын сагсаас (purpose pos) эсвэл нэхэмжлэхийн нийтийн линкээс (purpose arap — нээлттэй үлдэгдэл БҮТЭН).",
    },
    {
      action: "mark_paid",
      from: ["open", "cancelled", "expired"],
      to: "paid",
      permission: { module: "pos", level: "write" },
      guards: [],
      actor: "system",
      note: "Webhook / шалгалтаар (идемпотент). QR хаагдсаны дараах төлбөр ч «paid» + [QPAY_LATE_PAYMENT] — ХЭЗЭЭ Ч чимээгүй алгасахгүй.",
    },
    {
      action: "fail",
      from: ["open", "cancelled", "expired"],
      to: "failed",
      permission: { module: "pos", level: "write" },
      guards: [],
      actor: "system",
      note: "Дүн зөрсөн эсвэл QR үүсгэж чадаагүй — төлбөр ЗОХИОХГҮЙ.",
    },
    {
      action: "cancel",
      from: ["open"],
      to: "cancelled",
      permission: { module: "pos", level: "write" },
      guards: [],
    },
    {
      action: "expire",
      from: ["open"],
      to: "expired",
      permission: { module: "pos", level: "write" },
      guards: [],
      actor: "system",
    },
    {
      action: "finalize",
      from: ["paid"],
      to: "finalized",
      permission: { module: "pos", level: "write" },
      guards: ["period_open"],
      effects: ["journal", "voucher_no", "hook:beforeJournalPost"],
      note: "«Борлуулалт болгох» — POS борлуулалт (createPosSale) эсвэл нэхэмжлэхийн орлогын баримт (settleArapIntent, externalRef-ээр давхаргүй).",
    },
    {
      action: "refund",
      from: ["paid", "failed"],
      to: "refunded",
      permission: { module: "pos", level: "post" },
      guards: ["period_open"],
      effects: ["journal", "voucher_no", "hook:beforeJournalPost"],
      note: "«Буцаах» (refundQpayIntent): Дт QPay түр данс / Кт касс | банк | кредит. QR үүсээгүй failed-д мөнгө байхгүй тул татгалзана. Журналгүй «шийдсэн» төлөв ХОРИОТОЙ.",
    },
  ],
  relations: [
    { name: "shift", targetTable: "pos_shifts", column: "shift_id", kind: "fk", cardinality: "one" },
    { name: "sale", targetTable: "pos_sales", column: "sale_id", kind: "fk", cardinality: "one" },
    { name: "arapDocument", targetTable: "ar_ap_documents", column: "ar_ap_document_id", kind: "fk", cardinality: "one" },
    { name: "cashDocument", targetTable: "cash_documents", column: "cash_document_id", kind: "fk", cardinality: "one" },
  ],
  note: "Entry QPay-тэй ШУУД харьцахгүй (qpay-dashboard REST), QPay-г polling хийхгүй. Төлөгдсөн ч борлуулалт болоогүй intent «Анхаарах»-д ил.",
});

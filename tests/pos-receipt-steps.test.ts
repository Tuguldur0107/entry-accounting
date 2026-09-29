// Баримтын цонхны алхмууд (lib/pos/receipt-steps.ts) — ЦЭВЭР.

import assert from "node:assert/strict";
import test from "node:test";

import { receiptSteps, type ReceiptStepInput } from "../lib/pos/receipt-steps";

const base: ReceiptStepInput = {
  documentNo: "POS-2609-0007",
  ebarimtStatus: "pending",
  ebarimtId: null,
  ebarimtLottery: null,
  ebarimtError: null,
  sending: false,
  waitingForBrowser: false,
  printed: false,
};
const states = (input: Partial<ReceiptStepInput>) => receiptSteps({ ...base, ...input }).map((step) => step.state);

test("eBarimt олгогдсоны дараа л хэвлэх алхам идэвхжинэ", () => {
  assert.deepEqual(states({ ebarimtStatus: "sent", ebarimtId: "037…", ebarimtLottery: "AB 1" }), ["done", "done", "active"]);
  const ebarimt = receiptSteps({ ...base, ebarimtStatus: "sent", ebarimtId: "037", ebarimtLottery: "AB 1" })[1];
  assert.equal(ebarimt.detail, "ДДТД 037 · Сугалаа AB 1");
  assert.deepEqual(states({ ebarimtStatus: "sent", printed: true }), ["done", "done", "done"]);
});

test("Амжилтгүй / хугацаа хэтэрсэн → алдаа (шалтгаантай), хэвлэх хүлээнэ", () => {
  assert.deepEqual(states({ ebarimtError: "ТТД буруу" }), ["done", "error", "waiting"]);
  assert.equal(receiptSteps({ ...base, ebarimtError: "ТТД буруу" })[1].detail, "ТТД буруу");
  assert.deepEqual(states({ ebarimtStatus: "failed" }), ["done", "error", "waiting"]);
  assert.match(receiptSteps(base)[1].detail ?? "", /Дахин илгээх/);
});

test("Илгээж байхад / browser горимд хариу хүлээхэд идэвхтэй", () => {
  assert.deepEqual(states({ sending: true, ebarimtError: "x" }), ["done", "active", "waiting"]);
  assert.deepEqual(states({ waitingForBrowser: true }), ["done", "active", "waiting"]);
  assert.deepEqual(states({ waitingForBrowser: true, ebarimtError: "x" }), ["done", "error", "waiting"]);
});

test("eBarimt олгохгүй (унтраалттай, НӨАТ-гүй, кассчин алгассан) → шууд хэвлэж болно", () => {
  assert.deepEqual(states({ ebarimtStatus: null }), ["done", "skipped", "active"]);
  assert.deepEqual(states({ ebarimtStatus: "skipped" }), ["done", "skipped", "active"]);
  assert.deepEqual(states({ ebarimtStatus: "manual", ebarimtId: "123" }), ["done", "done", "active"]);
});

import test from "node:test";
import assert from "node:assert/strict";

import { QPAY_CLEARING_ACCOUNT_NAME, QPAY_CLEARING_GL_ACCOUNT, QPAY_METHOD_CODE, planQpaySeed } from "../lib/qpay/seed";

const bank = { id: "b1", name: "QPay түр данс", accountType: "bank", currency: "MNT", isActive: true };
const cashBox = { id: "c1", name: "Касс", accountType: "cash", currency: "MNT", isActive: true };

test("юу ч байхгүй → данс + хэлбэр хоёулаа үүснэ", () => {
  const plan = planQpaySeed({ methods: [{ id: "m0", code: "CASH", kind: "cash", provider: null, cashAccountId: "c1", isActive: true }], cashAccounts: [cashBox] });
  assert.deepEqual(plan.createAccount, { name: QPAY_CLEARING_ACCOUNT_NAME, glAccountNumber: QPAY_CLEARING_GL_ACCOUNT });
  assert.equal(plan.createMethod?.code, QPAY_METHOD_CODE);
  assert.equal(plan.createMethod?.cashAccountId, null);
  assert.equal(plan.updateMethod, null);
  assert.equal(plan.notes.length, 2);
});

test("QPay нэртэй банкны данс байвал дахин үүсгэхгүй, хэлбэрт оноогдоно", () => {
  const plan = planQpaySeed({ methods: [], cashAccounts: [cashBox, { ...bank, name: "Хаан банк — QPay" }] });
  assert.equal(plan.createAccount, null);
  assert.equal(plan.createMethod?.cashAccountId, "b1");
});

test("бүрэн байгаа → өөрчлөлтгүй (идемпотент)", () => {
  const plan = planQpaySeed({
    methods: [{ id: "m1", code: "QPAY", kind: "ewallet", provider: "qpay", cashAccountId: "b1", isActive: true }],
    cashAccounts: [bank],
  });
  assert.equal(plan.createAccount, null);
  assert.equal(plan.createMethod, null);
  assert.equal(plan.updateMethod, null);
  assert.deepEqual(plan.notes, []);
});

test("хэлбэр данстай, харин QPay нэртэй данс алга → данс ЗОХИОХГҮЙ", () => {
  const plan = planQpaySeed({
    methods: [{ id: "m1", code: "QPAY", kind: "ewallet", provider: "qpay", cashAccountId: "other", isActive: true }],
    cashAccounts: [cashBox],
  });
  assert.equal(plan.createAccount, null);
  assert.equal(plan.updateMethod, null);
  assert.deepEqual(plan.notes, []);
});

test("хэлбэр данс­гүй → данс үүсгэж оноох; идэвхгүй бол дахин идэвхжинэ", () => {
  const plan = planQpaySeed({
    methods: [{ id: "m1", code: "QPAY", kind: "ewallet", provider: "qpay", cashAccountId: null, isActive: false }],
    cashAccounts: [cashBox],
  });
  assert.ok(plan.createAccount);
  assert.deepEqual(plan.updateMethod, { id: "m1", cashAccountId: null, isActive: true });
  assert.ok(plan.notes.some((n) => n.includes("дахин идэвхжив")));
});

test("QPAY код өөр хэлбэрт ашиглагдсан бол дагавартай код", () => {
  const plan = planQpaySeed({
    methods: [{ id: "m9", code: "QPAY", kind: "card", provider: null, cashAccountId: "c1", isActive: true }],
    cashAccounts: [bank],
  });
  assert.ok(plan.createMethod);
  assert.notEqual(plan.createMethod.code, "QPAY");
  assert.ok(plan.createMethod.code.startsWith("QPAY-"));
});

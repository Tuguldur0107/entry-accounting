// lib/idempotency.ts — ЦЭВЭР: externalRef цэвэрлэгээ, unique violation таних,
// хэрэглэгчээр нэрийн талбартай түлхүүр. DATABASE_URL ШААРДАХГҮЙ.
import test from "node:test";
import assert from "node:assert/strict";

import {
  EXTERNAL_REF_MAX_LENGTH,
  cleanExternalRef,
  isExternalRefConflict,
  userScopedExternalRef,
} from "../lib/idempotency";

test("cleanExternalRef: хоосон → null, trim, хэт урт бол ил алдаа (таслахгүй)", () => {
  assert.equal(cleanExternalRef(undefined), null);
  assert.equal(cleanExternalRef(null), null);
  assert.equal(cleanExternalRef("   "), null);
  assert.equal(cleanExternalRef("  bank:123 "), "bank:123");
  assert.equal(cleanExternalRef("x".repeat(EXTERNAL_REF_MAX_LENGTH))?.length, EXTERNAL_REF_MAX_LENGTH);
  assert.throws(() => cleanExternalRef("x".repeat(EXTERNAL_REF_MAX_LENGTH + 1)), /\[INVALID_EXTERNAL_REF\]/);
});

test("isExternalRefConflict: зөвхөн external_ref индексийн 23505 (drizzle-ийн cause дотор ч)", () => {
  const pg = { code: "23505", constraint_name: "pos_sales_org_external_ref_uq", message: "duplicate key value" };
  assert.equal(isExternalRefConflict(pg), true);
  // drizzle: "Failed query: insert … external_ref …" + cause = postgres алдаа
  assert.equal(isExternalRefConflict({ message: "Failed query: insert into x (external_ref)", cause: pg }), true);
  // Баримтын дугаарын мөргөлдөөн — SQL текстэд external_ref багана байсан ч ҮГҮЙ
  const docNo = { code: "23505", constraint_name: "pos_sales_org_document_no_ux", message: "duplicate key" };
  assert.equal(isExternalRefConflict({ message: "Failed query: insert into x (document_no, external_ref)", cause: docNo }), false);
  assert.equal(isExternalRefConflict({ code: "23503", constraint_name: "x_external_ref_fk" }), false);
  assert.equal(isExternalRefConflict(new Error("other")), false);
  assert.equal(isExternalRefConflict(null), false);
  // Тойрог cause давталтад гацахгүй
  const loop: { code?: string; cause?: unknown } = { code: "x" };
  loop.cause = loop;
  assert.equal(isExternalRefConflict(loop), false);
});

test("userScopedExternalRef: хэрэглэгч бүр тусдаа нэрийн талбар", () => {
  assert.notEqual(userScopedExternalRef("u1", "ref"), userScopedExternalRef("u2", "ref"));
  assert.equal(userScopedExternalRef("u1", "ref"), "user:u1:ref");
});

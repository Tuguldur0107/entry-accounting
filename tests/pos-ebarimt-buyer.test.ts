import test from "node:test";
import assert from "node:assert/strict";

import { IDLE_LOOKUP, orgNoKind, resolveBuyer, sanitizeOrgNo, needsOrgLookup } from "../lib/pos/ebarimt-buyer";

test("байгууллагын дугаарын хэлбэр: 7 орон = регистр, 11/14 = ТТД", () => {
  assert.equal(orgNoKind(""), "empty");
  assert.equal(orgNoKind("2663503"), "register");
  assert.equal(orgNoKind("37900846788"), "tin");
  assert.equal(orgNoKind("12345678901234"), "tin");
  assert.equal(orgNoKind("266350"), "incomplete");
  assert.equal(sanitizeOrgNo(" 266-35 03abc "), "2663503");
});

test("хувь хүн — дугааргүй ч болно, 8 оронтой бол дамжина", () => {
  const base = { type: "individual" as const, consumerNo: "", orgNo: "", lookup: IDLE_LOOKUP };
  assert.deepEqual(resolveBuyer(base).problem, null);
  assert.equal(resolveBuyer({ ...base, consumerNo: "12345678" }).buyer.ebarimtConsumerNo, "12345678");
  assert.match(resolveBuyer({ ...base, consumerNo: "123" }).problem ?? "", /8 оронтой/);
});

test("ААН — регистр лавлахаар олдсон үед л ТТД + регистртэй төлнө", () => {
  const base = { type: "org" as const, consumerNo: "", orgNo: "2663503", lookup: IDLE_LOOKUP };
  assert.ok(resolveBuyer({ ...base, orgNo: "" }).problem);
  assert.match(resolveBuyer({ ...base, lookup: { ...IDLE_LOOKUP, status: "loading" } }).problem ?? "", /шалгаж/);
  assert.match(
    resolveBuyer({ ...base, lookup: { ...IDLE_LOOKUP, status: "error", error: "олдсонгүй" } }).problem ?? "",
    /олдсонгүй/
  );
  const found = resolveBuyer({ ...base, lookup: { tin: "37900846788", name: "Жишээ ХХК", status: "found", error: "" } });
  assert.equal(found.problem, null);
  assert.equal(found.buyer.ebarimtCustomerTin, "37900846788");
  assert.equal(found.buyer.ebarimtCustomerRegNo, "2663503");
  const tin = resolveBuyer({ ...base, orgNo: "37900846788" });
  assert.equal(tin.buyer.ebarimtCustomerTin, "37900846788");
});

test("needsOrgLookup: регистр ба ТТД → лавлана; хоосон / дутуу → үгүй", () => {
  assert.equal(needsOrgLookup("1234567"), true);
  assert.equal(needsOrgLookup("12345678901"), true);
  assert.equal(needsOrgLookup("12345678901234"), true);
  assert.equal(needsOrgLookup(""), false);
  assert.equal(needsOrgLookup("12345"), false);
});

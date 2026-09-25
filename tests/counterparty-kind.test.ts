import test from "node:test";
import assert from "node:assert/strict";

import {
  effectiveTin,
  normalizeTin,
  entityKindLabel,
  inferEntityKindFromRegisterNo,
  isCounterpartyEntityKind,
  normalizeEntityKind,
  registerNoLabel,
  registerNoMismatch,
} from "../lib/arap/counterparty-kind";

test("normalizeEntityKind — хоосон / буруу утга default байгууллага", () => {
  assert.equal(normalizeEntityKind(undefined), "organization");
  assert.equal(normalizeEntityKind(null), "organization");
  assert.equal(normalizeEntityKind("person"), "organization");
  assert.equal(normalizeEntityKind("individual"), "individual");
  assert.equal(isCounterpartyEntityKind("individual"), true);
  assert.equal(isCounterpartyEntityKind("company"), false);
  assert.equal(entityKindLabel("individual"), "Хувь хүн");
  assert.equal(entityKindLabel("x"), "Байгууллага");
});

test("inferEntityKindFromRegisterNo — иргэний РД / байгууллагын РД / ТТД / бусад", () => {
  assert.equal(inferEntityKindFromRegisterNo("УУ12345678"), "individual");
  assert.equal(inferEntityKindFromRegisterNo(" чс98010112 "), "individual");
  assert.equal(inferEntityKindFromRegisterNo("2693518"), "organization");
  assert.equal(inferEntityKindFromRegisterNo("37900846788"), "organization");
  assert.equal(inferEntityKindFromRegisterNo("12345678901234"), "organization");
  // Таамаглахгүй: хоосон, гадаад дугаар, 8 орон (иргэний eBarimt дугаар).
  assert.equal(inferEntityKindFromRegisterNo(""), null);
  assert.equal(inferEntityKindFromRegisterNo("US-123-45"), null);
  assert.equal(inferEntityKindFromRegisterNo("12345678"), null);
});

test("registerNoMismatch — зөрсөн үед зөвлөмж, таарсан / тодорхойгүй үед null", () => {
  assert.match(registerNoMismatch("organization", "УУ12345678") ?? "", /Хувь хүн/);
  assert.match(registerNoMismatch("individual", "2693518") ?? "", /Байгууллага/);
  assert.equal(registerNoMismatch("individual", "УУ12345678"), null);
  assert.equal(registerNoMismatch("organization", "US-123"), null);
  assert.equal(registerNoMismatch("organization", ""), null);
  assert.equal(registerNoLabel("individual"), "Регистрийн дугаар");
});

import { counterpartyDirectionError } from "../lib/arap/counterparty-kind";

test("ENT-031: харилцагчийн чиглэл ба баримтын төрөл", () => {
  assert.match(counterpartyDirectionError("ap_bill", "customer") ?? "", /COUNTERPARTY_DIRECTION/);
  assert.match(counterpartyDirectionError("ar_invoice", "supplier") ?? "", /COUNTERPARTY_DIRECTION/);
  assert.equal(counterpartyDirectionError("ap_bill", "supplier"), null);
  assert.equal(counterpartyDirectionError("ap_bill", "both"), null);
  assert.equal(counterpartyDirectionError("ar_invoice", "customer"), null);
  assert.equal(counterpartyDirectionError("ar_invoice", null), null);
});

test("normalizeTin — хоосон null, зай/зураас цэвэрлэнэ, 11–14 орон л зөв", () => {
  assert.deepEqual(normalizeTin(undefined), { tin: null });
  assert.deepEqual(normalizeTin("  "), { tin: null });
  assert.deepEqual(normalizeTin(" 379 008 467-88 "), { tin: "37900846788" });
  assert.deepEqual(normalizeTin("12345678901234"), { tin: "12345678901234" });
  assert.ok("error" in normalizeTin("2693518"), "7 оронтой регистр ТТД биш");
  assert.ok("error" in normalizeTin("123456789012345"), "15 орон");
  assert.ok("error" in normalizeTin("УУ12345678"), "иргэний РД");
});

test("effectiveTin — өөрийн багана түрүүлнэ, регистрийн талбарын ТТД өвлөгдөнө, регистр (7) null", () => {
  assert.equal(effectiveTin("37900846788", "2693518"), "37900846788");
  assert.equal(effectiveTin(null, "37900846788"), "37900846788");
  assert.equal(effectiveTin("", " 61200064714 "), "61200064714");
  assert.equal(effectiveTin(null, "2693518"), null);
  assert.equal(effectiveTin(null, "УУ12345678"), null);
  assert.equal(effectiveTin(undefined, undefined), null);
});

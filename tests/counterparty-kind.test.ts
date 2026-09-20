import test from "node:test";
import assert from "node:assert/strict";

import {
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

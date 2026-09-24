// Харилцагчийн ДИНАМИК төрөл — ЦЭВЭР логикийн тест (DATABASE_URL ШААРДАХГҮЙ).

import test from "node:test";
import assert from "node:assert/strict";

import {
  SYSTEM_ENTITY_KINDS,
  baseKindOf,
  entityKindName,
  entityKindNameError,
  nextEntityKindCode,
  resolveEntityKindCode,
  resolveEntityKinds,
} from "../lib/arap/counterparty-kind";

const KINDS = resolveEntityKinds([
  { code: "kind_1", name: "Төрийн байгууллага", baseKind: "organization", isActive: true, sortOrder: 1 },
  { code: "kind_2", name: "Гадаадын иргэн", baseKind: "individual", isActive: true, sortOrder: 2 },
  { code: "kind_3", name: "Хуучин төрөл", baseKind: "organization", isActive: false, sortOrder: 3 },
  // Системийн төрлийн нэрийг засна — суурь/идэвх өөрчлөгдөхгүй
  { code: "individual", name: "Иргэн", baseKind: "organization", isActive: false, sortOrder: 99 },
]);

test("мөргүй бол зөвхөн 2 системийн төрөл (default)", () => {
  const kinds = resolveEntityKinds([]);
  assert.deepEqual(kinds.map((kind) => kind.code), ["organization", "individual"]);
  assert.equal(kinds.every((kind) => kind.isSystem && kind.isActive), true);
  assert.equal(SYSTEM_ENTITY_KINDS.length, 2);
});

test("систем төрлийн нэр засагдана, суурь ба идэвх ХЭВЭЭР", () => {
  const individual = KINDS.find((kind) => kind.code === "individual")!;
  assert.equal(individual.name, "Иргэн");
  assert.equal(individual.baseKind, "individual");
  assert.equal(individual.isActive, true);
  assert.equal(individual.isSystem, true);
});

test("эрэмбэ: систем эхэнд, дараа нь sortOrder", () => {
  assert.deepEqual(
    KINDS.map((kind) => kind.code),
    ["organization", "individual", "kind_1", "kind_2", "kind_3"]
  );
});

test("бизнесийн логик СУУРЬ төрлөөр: шинэ төрөл baseKind-аа авна", () => {
  assert.equal(baseKindOf("kind_1", KINDS), "organization");
  assert.equal(baseKindOf("kind_2", KINDS), "individual");
  assert.equal(baseKindOf("individual", KINDS), "individual");
  // танигдахгүй код → байгууллага (болгоомжтой default)
  assert.equal(baseKindOf("unknown", KINDS), "organization");
  assert.equal(baseKindOf(null), "organization");
});

test("нэр: танигдахгүй кодыг нуухгүй", () => {
  assert.equal(entityKindName("kind_2", KINDS), "Гадаадын иргэн");
  assert.equal(entityKindName("zzz", KINDS), "zzz");
  assert.equal(entityKindName(null, KINDS), "Байгууллага");
});

test("оноох: код эсвэл нэрээр, идэвхгүйг шинээр оноохгүй", () => {
  assert.deepEqual(resolveEntityKindCode("", KINDS), { code: "organization" });
  assert.deepEqual(resolveEntityKindCode("kind_1", KINDS), { code: "kind_1" });
  assert.deepEqual(resolveEntityKindCode("гадаадын иргэн", KINDS), { code: "kind_2" });
  assert.ok("error" in resolveEntityKindCode("kind_3", KINDS));
  // Засахад одоогийн (идэвхгүй болсон) төрлөө хэвээр үлдээж болно
  assert.deepEqual(resolveEntityKindCode("kind_3", KINDS, "kind_3"), { code: "kind_3" });
  const missing = resolveEntityKindCode("kind_9", KINDS);
  assert.ok("error" in missing && /бүртгэлд алга/.test(missing.error));
});

test("шинэ код ба нэрийн шалгалт", () => {
  assert.equal(nextEntityKindCode(KINDS), "kind_4");
  assert.equal(nextEntityKindCode([]), "kind_1");
  assert.match(entityKindNameError(" ", KINDS)!, /нэр оруулна/);
  assert.match(entityKindNameError("төрийн БАЙГУУЛЛАГА", KINDS)!, /бүртгэгдсэн/);
  assert.equal(entityKindNameError("Төрийн байгууллага", KINDS, "kind_1"), null);
  assert.equal(entityKindNameError("ТББ", KINDS), null);
});

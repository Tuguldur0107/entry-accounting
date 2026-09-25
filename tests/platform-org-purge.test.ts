import assert from "node:assert/strict";
import test from "node:test";

import { purgeConfirmationMatches } from "../lib/platform/org-purge";

const org = { id: "11111111-1111-1111-1111-111111111111", name: "AI Flow Test  mt67xp3b" };

test("purgeConfirmationMatches — нэр эсвэл ID яг таарна (зай, том/жижиг үсэг үл харгалзан)", () => {
  assert.equal(purgeConfirmationMatches("AI Flow Test mt67xp3b", org), true);
  assert.equal(purgeConfirmationMatches("  ai flow test   MT67XP3B ", org), true);
  assert.equal(purgeConfirmationMatches(org.id.toUpperCase(), org), true);
});

test("purgeConfirmationMatches — хоосон, дутуу, өөр нэр татгалзана", () => {
  assert.equal(purgeConfirmationMatches("", org), false);
  assert.equal(purgeConfirmationMatches("   ", org), false);
  assert.equal(purgeConfirmationMatches("AI Flow Test", org), false);
  assert.equal(purgeConfirmationMatches("11111111-1111-1111-1111-11111111111", org), false);
  assert.equal(purgeConfirmationMatches("Хос Хас Технологи ХХК", org), false);
});

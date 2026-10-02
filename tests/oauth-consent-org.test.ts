import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultConsentOrg, resolveConsentOrg } from "../lib/oauth/consent-org";

const A = { id: "org-a", name: "А ХХК" };
const B = { id: "org-b", name: "Б ХХК" };

test("resolveConsentOrg — ил сонгосон компани гишүүнчлэлд байвал тэр", () => {
  assert.equal(resolveConsentOrg("org-b", [A, B], "org-a"), "org-b");
  assert.equal(resolveConsentOrg("  org-b  ", [A, B], null), "org-b");
});

test("resolveConsentOrg — гишүүн биш компани → null (идэвхтэй руу далдуур унахгүй)", () => {
  assert.equal(resolveConsentOrg("org-x", [A, B], "org-a"), null);
  // Дэмжлэгийн сесс г.м.-ийн гишүүн биш идэвхтэй байгууллага ч үл тооцогдоно.
  assert.equal(resolveConsentOrg("org-x", [A], "org-x"), null);
});

test("resolveConsentOrg — сонголтгүй үед идэвхтэй эсвэл ганц компани, олон бол таамаглахгүй", () => {
  assert.equal(resolveConsentOrg("", [A, B], "org-b"), "org-b");
  assert.equal(resolveConsentOrg(null, [A], null), "org-a");
  assert.equal(resolveConsentOrg(undefined, [A, B], null), null);
  assert.equal(resolveConsentOrg("", [A, B], "org-x"), null);
  assert.equal(resolveConsentOrg("", [], null), null);
});

test("defaultConsentOrg — идэвхтэй компани, эс бөгөөс эхнийх", () => {
  assert.equal(defaultConsentOrg([A, B], "org-b"), "org-b");
  assert.equal(defaultConsentOrg([A, B], "org-x"), "org-a");
  assert.equal(defaultConsentOrg([A, B], null), "org-a");
  assert.equal(defaultConsentOrg([], "org-a"), null);
});

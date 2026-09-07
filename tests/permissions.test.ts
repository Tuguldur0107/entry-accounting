// Гишүүний модулийн эрхийн цэвэр логик (lib/permissions.ts).
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  defaultLevelForRole,
  effectiveLevel,
  hasModuleLevel,
  hiddenModuleKeys,
  parsePermissions,
  serializePermissions,
} from "../lib/permissions";

test("default түвшин: нягтлан бүрэн, үзэгч унших", () => {
  assert.equal(defaultLevelForRole("accountant"), "post");
  assert.equal(defaultLevelForRole("viewer"), "read");
  assert.equal(defaultLevelForRole("owner"), "post");
});

test("parsePermissions: буруу JSON, танигдахгүй утга fail-safe хаягдана", () => {
  assert.deepEqual(parsePermissions(null), {});
  assert.deepEqual(parsePermissions("{oops"), {});
  assert.deepEqual(parsePermissions('{"gl":"super","cash":"read"}'), {
    cash: "read",
  });
  assert.deepEqual(parsePermissions('["read"]'), {});
});

test("serialize → parse round-trip", () => {
  const raw = serializePermissions({ gl: "write", cash: "none" });
  assert.deepEqual(parsePermissions(raw), { gl: "write", cash: "none" });
});

test("owner/admin-д override үйлчлэхгүй — үргэлж post", () => {
  const raw = serializePermissions({ gl: "none" });
  assert.equal(effectiveLevel("owner", raw, "gl"), "post");
  assert.equal(effectiveLevel("admin", raw, "gl"), "post");
});

test("нягтлан: override модульд нь, бусад нь default post", () => {
  const raw = serializePermissions({ cash: "read", inv: "none" });
  assert.equal(effectiveLevel("accountant", raw, "cash"), "read");
  assert.equal(effectiveLevel("accountant", raw, "inv"), "none");
  assert.equal(effectiveLevel("accountant", raw, "gl"), "post");
});

test("hasModuleLevel: зэрэглэл шатлалтай (write нь read-ийг агуулна)", () => {
  const raw = serializePermissions({ gl: "write" });
  assert.equal(hasModuleLevel("accountant", raw, "gl", "read"), true);
  assert.equal(hasModuleLevel("accountant", raw, "gl", "write"), true);
  assert.equal(hasModuleLevel("accountant", raw, "gl", "post"), false);
});

test("үзэгч default-аар бичиж чадахгүй, олгосон модульд чадна", () => {
  assert.equal(hasModuleLevel("viewer", null, "cash", "write"), false);
  const raw = serializePermissions({ cash: "write" });
  assert.equal(hasModuleLevel("viewer", raw, "cash", "write"), true);
  assert.equal(hasModuleLevel("viewer", raw, "gl", "write"), false);
});

test("hiddenModuleKeys: зөвхөн none модулиуд", () => {
  const raw = serializePermissions({ cash: "none", gl: "read" });
  assert.deepEqual(
    hiddenModuleKeys("accountant", raw, ["gl", "cash", "inv"]),
    ["cash"]
  );
  // owner-д юу ч нуугдахгүй
  assert.deepEqual(hiddenModuleKeys("owner", raw, ["gl", "cash"]), []);
});

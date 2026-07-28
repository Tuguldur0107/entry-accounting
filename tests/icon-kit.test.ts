import assert from "node:assert/strict";
import test from "node:test";

import {
  ICON_CATALOG,
  ICONS,
  type IconCategory,
} from "../components/ui/icon-registry";

test("icon catalog names are unique and resolve to a glyph", () => {
  const names = ICON_CATALOG.map((item) => item.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.equal(typeof ICONS[name], "object");
});

test("icon catalog covers every registry name", () => {
  const catalogNames = new Set(ICON_CATALOG.map((item) => item.name));
  assert.deepEqual(
    [...Object.keys(ICONS)].filter((name) => !catalogNames.has(name as never)),
    []
  );
});

test("icon catalog contains all supported categories", () => {
  const expected: IconCategory[] = [
    "action",
    "navigation",
    "status",
    "data",
    "module",
    "theme",
  ];
  const actual = new Set(ICON_CATALOG.map((item) => item.category));
  expected.forEach((category) => assert(actual.has(category)));
});

test("critical accounting semantics remain available", () => {
  const required = [
    "add",
    "edit",
    "delete",
    "approve",
    "warning",
    "generalLedger",
    "inventory",
    "costing",
    "report",
    "period",
  ] as const;
  required.forEach((name) => assert(ICONS[name]));
});

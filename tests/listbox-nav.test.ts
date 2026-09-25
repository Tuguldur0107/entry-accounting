// SearchableSelect-ийн гарын удирдлага — Enter «— Хоосон»-ыг ХЭЗЭЭ Ч сонгохгүй.

import test from "node:test";
import assert from "node:assert/strict";

import { enterPickValue, initialActiveIndex, moveActiveIndex } from "../lib/ui/listbox-nav";

const values = ["11000001", "11210000", "51100000"];

test("нээхэд сонгосон утга идэвхтэй, хайлттай бол эхний илэрц", () => {
  assert.equal(initialActiveIndex(values, "11210000", false), 1);
  assert.equal(initialActiveIndex(values, "11210000", true), 0);
  assert.equal(initialActiveIndex(values, "", false), 0);
  assert.equal(initialActiveIndex(values, "99999999", false), 0);
  assert.equal(initialActiveIndex([], "x", false), -1);
});

test("↑/↓ хил дээр зогсоно", () => {
  assert.equal(moveActiveIndex(0, 1, 3), 1);
  assert.equal(moveActiveIndex(2, 1, 3), 2);
  assert.equal(moveActiveIndex(0, -1, 3), 0);
  assert.equal(moveActiveIndex(-1, 1, 3), 0);
  assert.equal(moveActiveIndex(-1, -1, 3), 2);
  assert.equal(moveActiveIndex(1, 1, 0), -1);
});

test("Enter: идэвхтэй мөр; илэрцгүй бол null (хоосон утга сонгохгүй)", () => {
  assert.equal(enterPickValue(values, 2), "51100000");
  assert.equal(enterPickValue(values, 9), "51100000");
  assert.equal(enterPickValue(values, -1), "11000001");
  assert.equal(enterPickValue([], 0), null);
});

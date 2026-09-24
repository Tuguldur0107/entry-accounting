import test from "node:test";
import assert from "node:assert/strict";

import { fmtDateTimeUb } from "../lib/format/datetime";

test("ENT-055: огноо-цаг Улаанбаатарын бүсээр", () => {
  assert.equal(fmtDateTimeUb(new Date("2026-09-23T11:53:00Z")), "2026-09-23 19:53");
  assert.equal(fmtDateTimeUb("2026-09-22T17:30:00Z"), "2026-09-23 01:30");
  assert.equal(fmtDateTimeUb(null), null);
  assert.equal(fmtDateTimeUb("garbage"), null);
});

import test from "node:test";
import assert from "node:assert/strict";

import { filterSearchOptions } from "../lib/grid/editors/SearchSelectCellEditor";

const OPTIONS = [
  { value: "1", label: "Lightning кабель", code: "ITM-002" },
  { value: "2", label: "Утасны гэр (силикон)", code: "ITM-013", hint: "12,000₮" },
  { value: "3", label: "Утасны гэр Pro", code: "ITM-014" },
];

test("ENT-040: код, нэр, олон үгээр хайна (эхний үсгээр үсрэхгүй)", () => {
  assert.deepEqual(filterSearchOptions(OPTIONS, "ITM-013").map((o) => o.value), ["2"]);
  assert.deepEqual(filterSearchOptions(OPTIONS, "гэр сил").map((o) => o.value), ["2"]);
  assert.deepEqual(filterSearchOptions(OPTIONS, "утасны").map((o) => o.value), ["2", "3"]);
  assert.equal(filterSearchOptions(OPTIONS, "").length, 3);
});

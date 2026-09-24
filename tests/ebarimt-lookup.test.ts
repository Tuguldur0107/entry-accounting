import test from "node:test";
import assert from "node:assert/strict";

import { describeLookupFailure } from "../lib/ebarimt/lookup";

test("ENT-034: ТЕГ-ийн лавлахын алдаа монгол тайлбартай", () => {
  const abort = new Error("This operation was aborted");
  abort.name = "AbortError";
  assert.match(describeLookupFailure(abort), /timeout/);
  assert.doesNotMatch(describeLookupFailure(abort), /aborted/);
  assert.match(describeLookupFailure(new Error("HTTP 503")), /HTTP 503/);
  assert.match(describeLookupFailure(new TypeError("fetch failed")), /сүлжээ/);
});

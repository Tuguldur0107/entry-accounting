import test from "node:test";
import assert from "node:assert/strict";

import { describeLookupFailure, parseTaxpayerInfoResponse, parseTinInfoResponse } from "../lib/ebarimt/lookup";

test("ENT-034: ТЕГ-ийн лавлахын алдаа монгол тайлбартай", () => {
  const abort = new Error("This operation was aborted");
  abort.name = "AbortError";
  assert.match(describeLookupFailure(abort), /timeout/);
  assert.doesNotMatch(describeLookupFailure(abort), /aborted/);
  assert.match(describeLookupFailure(new Error("HTTP 503")), /HTTP 503/);
  assert.match(describeLookupFailure(new TypeError("fetch failed")), /сүлжээ/);
});

test("getTinInfo: албан хариу data = ТТД тоо (нэргүй) — нэр getInfo-оос", () => {
  assert.equal(parseTinInfoResponse({ msg: "", status: 200, data: 37900846788 }), "37900846788");
  assert.equal(parseTinInfoResponse({ status: 200, data: "37900846788" }), "37900846788");
  assert.equal(parseTinInfoResponse({ data: { tin: "37900846788", name: "X" } }), "37900846788");
  assert.equal(parseTinInfoResponse({ status: 200, data: null }), "");
  assert.equal(parseTinInfoResponse({ status: 200, data: 0 }), "");
  assert.equal(parseTinInfoResponse({ data: "abc" }), "");
});

test("getInfo: нэр, found, vatPayer", () => {
  assert.deepEqual(
    parseTaxpayerInfoResponse({ status: 200, data: { name: "Жишээ ХХК", found: true, vatPayer: true, cityPayer: false } }),
    { name: "Жишээ ХХК", found: true, vatPayer: true }
  );
  assert.deepEqual(parseTaxpayerInfoResponse({ data: { name: "", found: false } }), { name: "", found: false, vatPayer: null });
  assert.deepEqual(parseTaxpayerInfoResponse({}), { name: "", found: false, vatPayer: null });
});

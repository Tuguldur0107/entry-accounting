import test from "node:test";
import assert from "node:assert/strict";

import { describeLookupFailure, lookupTinByRegNo, parseTaxpayerInfoResponse, parseTinInfoResponse, publicApiBase } from "../lib/ebarimt/lookup";
import { EBARIMT_PUBLIC_API_BASE } from "../lib/ebarimt/constants";

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
    { name: "Жишээ ХХК", found: true, vatPayer: true, cityPayer: false, freeProject: null }
  );
  assert.deepEqual(parseTaxpayerInfoResponse({ data: { name: "", found: false } }), { name: "", found: false, vatPayer: null, cityPayer: null, freeProject: null });
  assert.deepEqual(parseTaxpayerInfoResponse({}), { name: "", found: false, vatPayer: null, cityPayer: null, freeProject: null });
  // P2-3/4: НХАТ төлөгч, чөлөөлөгдөх төсөл ил гарна
  assert.deepEqual(
    parseTaxpayerInfoResponse({ data: { name: "Зочид буудал", found: true, vatPayer: true, cityPayer: true, freeProject: true } }),
    { name: "Зочид буудал", found: true, vatPayer: true, cityPayer: true, freeProject: true }
  );
});

test("P1-1: лавлахын суурь хаяг env-ээр солигдоно (Монголын egress), гажиг утга default руу", () => {
  const before = process.env.EBARIMT_PUBLIC_API_BASE;
  try {
    delete process.env.EBARIMT_PUBLIC_API_BASE;
    assert.equal(publicApiBase(), EBARIMT_PUBLIC_API_BASE);
    process.env.EBARIMT_PUBLIC_API_BASE = "https://posapi-proxy.example.mn/ebarimt/";
    assert.equal(publicApiBase(), "https://posapi-proxy.example.mn/ebarimt");
    process.env.EBARIMT_PUBLIC_API_BASE = "not a url";
    assert.equal(publicApiBase(), EBARIMT_PUBLIC_API_BASE);
  } finally {
    if (before === undefined) delete process.env.EBARIMT_PUBLIC_API_BASE;
    else process.env.EBARIMT_PUBLIC_API_BASE = before;
  }
});

test("P1-2: иргэний РД-аар ТТД лавлахгүй — сүлжээ хөндөхгүй ШИДНЭ (ХХМХ 4.1.11)", async () => {
  await assert.rejects(() => lookupTinByRegNo("АА12345678"), /\[EBARIMT_SETTINGS\].*Иргэний регистр/);
  await assert.rejects(() => lookupTinByRegNo("ab12345678"), /Иргэний регистр/);
  await assert.rejects(() => lookupTinByRegNo(""), /хоосон/);
});

import test from "node:test";
import assert from "node:assert/strict";

import { lookupTinPreferBrowser, shouldFallbackToServer } from "../lib/ebarimt/browser-lookup";
import { EBARIMT_ERRORS } from "../lib/ebarimt/constants";
import { EbarimtError } from "../lib/ebarimt/receipt";

test("сүлжээ / CORS / timeout → серверээр дахин; ТЕГ «олдсонгүй» → үгүй", () => {
  assert.equal(shouldFallbackToServer(new TypeError("Failed to fetch")), true);
  assert.equal(shouldFallbackToServer(new EbarimtError(EBARIMT_ERRORS.posApi, "timeout")), true);
  assert.equal(shouldFallbackToServer(new EbarimtError(EBARIMT_ERRORS.settings, "олдсонгүй")), false);
  assert.equal(shouldFallbackToServer("x"), true);
});

test("сервер талд (window байхгүй) шууд серверийн action", async () => {
  const calls: string[] = [];
  const result = await lookupTinPreferBrowser("6596177", async (value) => {
    calls.push(value);
    return { error: "server" };
  });
  assert.deepEqual(calls, ["6596177"]);
  assert.equal(result.error, "server");
});

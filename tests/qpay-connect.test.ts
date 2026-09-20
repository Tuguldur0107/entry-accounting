process.env.AUTH_SECRET ??= "test-secret-for-qpay-connect";

import test from "node:test";
import assert from "node:assert/strict";

import {
  QPAY_CONNECT_STATE_TTL_MS,
  buildConnectState,
  connectUrl,
  parseConnectState,
} from "../lib/qpay/connect";

const input = { orgId: "org-1", userId: "user-1", apiUrl: "https://qpay-dashboard-production.up.railway.app" };

test("state: шифрлэгдэж URL-safe, буцааж тайлагдана", () => {
  const state = buildConnectState(input, 1_000_000);
  assert.match(state, /^[A-Za-z0-9_-]+$/);
  assert.ok(state.length >= 32);
  const parsed = parseConnectState(state, 1_000_000 + 60_000);
  assert.ok(parsed);
  assert.equal(parsed.orgId, "org-1");
  assert.equal(parsed.userId, "user-1");
  assert.equal(parsed.apiUrl, input.apiUrl);
  assert.equal(parsed.expiresAt, 1_000_000 + QPAY_CONNECT_STATE_TTL_MS);
  // Nonce бүр өөр → хоёр state давхцахгүй.
  assert.notEqual(state, buildConnectState(input, 1_000_000));
});

test("state: хугацаа дууссан / засварласан / хог → null (шидэхгүй)", () => {
  const state = buildConnectState(input, 0);
  assert.equal(parseConnectState(state, QPAY_CONNECT_STATE_TTL_MS + 1), null);
  const tampered = state.slice(0, -4) + (state.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.equal(parseConnectState(tampered), null);
  assert.equal(parseConnectState("хог"), null);
  assert.equal(parseConnectState(""), null);
  assert.equal(parseConnectState(Buffer.from("not-encrypted").toString("base64url").padEnd(40, "A")), null);
});

test("connectUrl: app=entry, callback, state, org (80 тэмдэгтээр таслана)", () => {
  const url = new URL(
    connectUrl("https://dash.example/", { callback: "https://entry.example/api/pos/qpay/connect/callback", state: "s".repeat(40), org: "x".repeat(100) })
  );
  assert.equal(url.origin + url.pathname, "https://dash.example/connect");
  assert.equal(url.searchParams.get("app"), "entry");
  assert.equal(url.searchParams.get("callback"), "https://entry.example/api/pos/qpay/connect/callback");
  assert.equal(url.searchParams.get("state"), "s".repeat(40));
  assert.equal(url.searchParams.get("org")?.length, 80);
});

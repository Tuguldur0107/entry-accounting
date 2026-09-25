import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ItcError,
  bearerHeader,
  describeToken,
  isAccessTokenUsable,
  isItcEnvironment,
  isRefreshUsable,
  itcTokenUrl,
  parseItcTokenResponse,
  passwordGrantBody,
  refreshGrantBody,
} from "../lib/itc/auth";
import { ITC_CLIENT_IDS, ITC_TOKEN_SKEW_MS } from "../lib/itc/constants";

// ITC Keycloak нэвтрэлтийн ЦЭВЭР хэсэг (docs/integrations/00 §2): URL, grant body,
// хариуны parse, хүчинтэй эсэх — token-ийн утга лог руу орохгүй.

test("itcTokenUrl — орчин бүрийн realm-тэй Keycloak зам", () => {
  assert.equal(itcTokenUrl("staging"), "https://st.auth.itc.gov.mn/auth/realms/Staging/protocol/openid-connect/token");
  assert.equal(itcTokenUrl("production"), "https://auth.itc.gov.mn/auth/realms/ITC/protocol/openid-connect/token");
  assert.equal(isItcEnvironment("staging"), true);
  assert.equal(isItcEnvironment("prod"), false);
});

test("passwordGrantBody — албан form параметрүүд, хоосон утга шиднэ", () => {
  const body = new URLSearchParams(
    passwordGrantBody({ clientId: ITC_CLIENT_IDS.ebarimtTpi, username: " АА10010110 ", password: "Test@123" })
  );
  assert.equal(body.get("grant_type"), "password");
  assert.equal(body.get("client_id"), "vatps");
  assert.equal(body.get("username"), "АА10010110");
  assert.equal(body.get("password"), "Test@123");
  assert.throws(() => passwordGrantBody({ clientId: "vatps", username: "", password: "x" }), ItcError);
  assert.throws(() => passwordGrantBody({ clientId: "", username: "u", password: "x" }), /ITC_CONFIG/);
  const refresh = new URLSearchParams(refreshGrantBody({ clientId: "vatps", refreshToken: "r1" }));
  assert.equal(refresh.get("grant_type"), "refresh_token");
  assert.equal(refresh.get("refresh_token"), "r1");
  assert.throws(() => refreshGrantBody({ clientId: "vatps", refreshToken: " " }), /ITC_AUTH/);
});

test("parseItcTokenResponse — expires_in-ээс дуусах мөч, refresh сонголтоор; алдааны хариу шиднэ", () => {
  const now = Date.UTC(2026, 8, 25, 12, 0, 0);
  const token = parseItcTokenResponse(
    {
      access_token: "a.b.c",
      expires_in: 300,
      refresh_expires_in: 1800,
      refresh_token: "r.t",
      token_type: "Bearer",
      session_state: "s",
      scope: "profile email",
    },
    now
  );
  assert.equal(token.accessToken, "a.b.c");
  assert.equal(token.expiresAt, now + 300_000);
  assert.equal(token.refreshToken, "r.t");
  assert.equal(token.refreshExpiresAt, now + 1_800_000);
  assert.equal(token.scope, "profile email");
  // refresh байхгүй → null
  const bare = parseItcTokenResponse({ access_token: "x", expires_in: "60" }, now);
  assert.equal(bare.refreshToken, null);
  assert.equal(bare.refreshExpiresAt, null);
  assert.equal(bare.tokenType, "Bearer");
  assert.throws(
    () => parseItcTokenResponse({ error: "invalid_grant", error_description: "Invalid user credentials" }, now),
    /\[ITC_AUTH\] Нэвтрэлт амжилтгүй: invalid_grant — Invalid user credentials/
  );
  assert.throws(() => parseItcTokenResponse({ access_token: "x" }, now), /expires_in/);
  assert.throws(() => parseItcTokenResponse(null, now), /access_token алга/);
});

test("isAccessTokenUsable / isRefreshUsable — skew-ээс өмнө хуучирна", () => {
  const now = 1_000_000_000;
  const token = { accessToken: "a", expiresAt: now + ITC_TOKEN_SKEW_MS + 1, refreshToken: "r", refreshExpiresAt: now + 60_000 };
  assert.equal(isAccessTokenUsable(token, now), true);
  assert.equal(isAccessTokenUsable({ ...token, expiresAt: now + ITC_TOKEN_SKEW_MS }, now), false);
  assert.equal(isAccessTokenUsable({ accessToken: "", expiresAt: now + 10_000_000 }, now), false);
  assert.equal(isRefreshUsable(token, now), true);
  assert.equal(isRefreshUsable({ refreshToken: "r", refreshExpiresAt: null }, now), true);
  assert.equal(isRefreshUsable({ refreshToken: null, refreshExpiresAt: null }, now), false);
  assert.equal(isRefreshUsable({ refreshToken: "r", refreshExpiresAt: now + 1000 }, now), false);
});

test("bearerHeader / describeToken — утга лог руу орохгүй", () => {
  assert.deepEqual(bearerHeader({ accessToken: "abc" }), { Authorization: "Bearer abc" });
  const described = describeToken({
    accessToken: "secret-token-value",
    expiresAt: Date.UTC(2026, 0, 1),
    refreshToken: "r",
    refreshExpiresAt: null,
    tokenType: "Bearer",
    scope: "",
  });
  assert.deepEqual(described, { accessLength: 18, expiresAt: "2026-01-01T00:00:00.000Z", hasRefresh: true });
  assert.ok(!JSON.stringify(described).includes("secret-token-value"));
});

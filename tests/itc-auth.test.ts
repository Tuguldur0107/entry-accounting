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
import { itcAuthTokenUrl, itcCustomsBase, itcProxyEnvName, itcProxyOverride, itcTpiBase } from "../lib/itc/client";
import { ITC_CLIENT_IDS, ITC_TOKEN_SKEW_MS } from "../lib/itc/constants";

// ITC Keycloak нэвтрэлтийн ЦЭВЭР хэсэг (docs/integrations/00 §2): URL, grant body,
// хариуны parse, хүчинтэй эсэх — token-ийн утга лог руу орохгүй.

test("itcTokenUrl — орчин бүрийн realm-тэй Keycloak зам", () => {
  assert.equal(itcTokenUrl("staging"), "https://st.auth.itc.gov.mn/auth/realms/Staging/protocol/openid-connect/token");
  assert.equal(itcTokenUrl("production"), "https://auth.itc.gov.mn/auth/realms/ITC/protocol/openid-connect/token");
  // Монголд байрлах прокси (ITC_AUTH_BASE) — realm орчноосоо хэвээр, төгсгөлийн / хасагдана
  assert.equal(
    itcTokenUrl("production", "https://ebarimt.chipmo.mn/itc-auth/"),
    "https://ebarimt.chipmo.mn/itc-auth/auth/realms/ITC/protocol/openid-connect/token"
  );
  assert.equal(itcTokenUrl("staging", "  "), "https://st.auth.itc.gov.mn/auth/realms/Staging/protocol/openid-connect/token");
  assert.throws(() => itcTokenUrl("production", "ftp://x"), /ITC_AUTH_BASE/);
  assert.equal(isItcEnvironment("staging"), true);
  assert.equal(isItcEnvironment("prod"), false);
});

test("прокси override орчин бүрд ТУСДАА — бодитын прокси staging-д хэрэглэгдэхгүй (realm/хост зөрж 404)", () => {
  const vars = { ITC_AUTH_BASE: "https://ebarimt.chipmo.mn/itc-auth", ITC_TPI_BASE: "https://ebarimt.chipmo.mn/tpi", ITC_CUSTOMS_BASE: "https://ebarimt.chipmo.mn/customs" };
  assert.equal(itcProxyEnvName("ITC_AUTH_BASE", "staging"), "ITC_AUTH_BASE_STAGING");
  assert.equal(itcProxyOverride("ITC_AUTH_BASE", "production", vars), "https://ebarimt.chipmo.mn/itc-auth");
  assert.equal(itcProxyOverride("ITC_AUTH_BASE", "staging", vars), undefined);
  assert.equal(itcProxyOverride("ITC_TPI_BASE", "staging", { ...vars, ITC_TPI_BASE_STAGING: "https://ebarimt.chipmo.mn/tpi-st" }), "https://ebarimt.chipmo.mn/tpi-st");
  // Гаалийн хост хоёр орчинд ижил — staging нь ITC_CUSTOMS_BASE-ийг ч хэрэглэнэ.
  assert.equal(itcProxyOverride("ITC_CUSTOMS_BASE", "staging", vars), "https://ebarimt.chipmo.mn/customs");
  assert.equal(itcTpiBase("staging", itcProxyOverride("ITC_TPI_BASE", "staging", vars)), "https://st-api.ebarimt.mn");
  assert.equal(itcTpiBase("production", itcProxyOverride("ITC_TPI_BASE", "production", vars)), "https://ebarimt.chipmo.mn/tpi");
  assert.equal(itcAuthTokenUrl("staging", itcProxyOverride("ITC_AUTH_BASE", "staging", vars)), "https://st.auth.itc.gov.mn/auth/realms/Staging/protocol/openid-connect/token");
  assert.equal(itcCustomsBase("production", itcProxyOverride("ITC_CUSTOMS_BASE", "production", vars)), "https://ebarimt.chipmo.mn/customs");
  assert.throws(() => itcTpiBase("staging", "ftp://x"), /ITC_TPI_BASE_STAGING/);
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEFAULT_LOGOUT_REDIRECT, isSameOriginLogout, safeLogoutRedirect } from "../lib/auth-logout";

test("safeLogoutRedirect — зөвхөн дотоод зам", () => {
  assert.equal(safeLogoutRedirect("/register?plan=skills"), "/register?plan=skills");
  assert.equal(safeLogoutRedirect("/login"), "/login");
  for (const bad of [null, undefined, 42, "", "login", "https://evil.mn", "//evil.mn", "/\\evil.mn", "/a\nb"]) {
    assert.equal(safeLogoutRedirect(bad), DEFAULT_LOGOUT_REDIRECT, String(bad));
  }
});

test("isSameOriginLogout — өөр сайтын POST-ыг татгалзана", () => {
  const h = (secFetchSite: string | null, origin: string | null, host: string | null = "app.entry.mn") => ({
    secFetchSite,
    origin,
    host,
  });
  assert.equal(isSameOriginLogout(h("same-origin", null)), true);
  assert.equal(isSameOriginLogout(h("cross-site", "https://app.entry.mn")), false);
  assert.equal(isSameOriginLogout(h("same-site", null)), false);
  assert.equal(isSameOriginLogout(h(null, "https://app.entry.mn")), true);
  assert.equal(isSameOriginLogout(h(null, "https://evil.mn")), false);
  assert.equal(isSameOriginLogout(h(null, "null")), false);
  assert.equal(isSameOriginLogout(h(null, null)), true);
});

test("Гарах нь server action биш — deploy-оос өмнөх табаас ч ажиллана", () => {
  for (const file of ["components/layout/user-menu.tsx", "components/skills/skills-signed-in.tsx"]) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /action=\{LOGOUT_PATH\} method="post"/, file);
  }
  for (const file of ["app/(dashboard)/layout.tsx", "app/(auth)/register/page.tsx"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /signOut\(/, file);
  }
});

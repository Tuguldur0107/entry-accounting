// Deployment горим (lib/deployment-mode.ts) — SaaS ба тусдаа сервисийн
// бүртгэлийн зан төлөв хоорондоо холилдохгүй.
import assert from "node:assert/strict";
import test from "node:test";

import { deploymentMode, resolveRegistrationMode } from "../lib/deployment-mode";

test("env байхгүй / гажиг → dedicated (одоогийн харилцагчийн deploy өөрчлөгдөхгүй)", () => {
  assert.equal(deploymentMode({}), "dedicated");
  assert.equal(deploymentMode({ ENTRY_DEPLOYMENT_MODE: "" }), "dedicated");
  assert.equal(deploymentMode({ ENTRY_DEPLOYMENT_MODE: "builder" }), "dedicated");
  assert.equal(deploymentMode({ ENTRY_DEPLOYMENT_MODE: " SaaS " }), "saas");
});

test("saas — хэрэглэгч байсан ч бүртгэл нээлттэй", () => {
  assert.equal(resolveRegistrationMode({ mode: "saas", forcedOpen: false, userCount: 0 }), "open");
  assert.equal(resolveRegistrationMode({ mode: "saas", forcedOpen: false, userCount: 500 }), "open");
});

test("dedicated — эхний хэрэглэгч чөлөөтэй, дараа нь урилгаар; ENTRY_OPEN_REGISTRATION дардаг", () => {
  assert.equal(resolveRegistrationMode({ mode: "dedicated", forcedOpen: false, userCount: 0 }), "open");
  assert.equal(resolveRegistrationMode({ mode: "dedicated", forcedOpen: false, userCount: 1 }), "invite");
  assert.equal(resolveRegistrationMode({ mode: "dedicated", forcedOpen: true, userCount: 1 }), "open");
});

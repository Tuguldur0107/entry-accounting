// QPay интеграцийн key-ийн автомат сэргээлтийн ЦЭВЭР дүрэм (lib/qpay/recovery.ts).
import assert from "node:assert/strict";
import test from "node:test";

import { QpayError } from "../lib/qpay/client";
import { QPAY_ERRORS } from "../lib/qpay/constants";
import {
  QPAY_RECOVERY_COOLDOWN_MS,
  clientHostOf,
  isQpayKeyRejected,
  takeRecoverySlot,
} from "../lib/qpay/recovery";

test("зөвхөн dashboard-ын 401 сэргээлт өдөөнө", () => {
  assert.equal(isQpayKeyRejected(new QpayError(QPAY_ERRORS.dashboard, "API key буруу", 401)), true);
  // 403 = API хандалт хаагдсан / акаунт түдгэлзсэн — key сэргээх нь буруу зам
  assert.equal(isQpayKeyRejected(new QpayError(QPAY_ERRORS.dashboard, "идэвхгүй", 403)), false);
  assert.equal(isQpayKeyRejected(new QpayError(QPAY_ERRORS.dashboard, "данс", 409)), false);
  assert.equal(isQpayKeyRejected(new QpayError(QPAY_ERRORS.disabled, "x", 401)), false);
  assert.equal(isQpayKeyRejected(new Error("[QPAY_DASHBOARD] 401")), false);
  assert.equal(isQpayKeyRejected(null), false);
});

test("cooldown: байгууллага бүрд минутад нэг оролдлого", () => {
  const attempts = new Map<string, number>();
  assert.equal(takeRecoverySlot(attempts, "org-a", 1_000), true);
  assert.equal(takeRecoverySlot(attempts, "org-a", 1_000 + QPAY_RECOVERY_COOLDOWN_MS - 1), false);
  assert.equal(takeRecoverySlot(attempts, "org-b", 1_500), true, "өөр байгууллага саадгүй");
  assert.equal(takeRecoverySlot(attempts, "org-a", 1_000 + QPAY_RECOVERY_COOLDOWN_MS), true);
});

test("client_host: нийтийн URL-ийн хост (dashboard-ын consent-ийн ID-тай таарна)", () => {
  assert.equal(clientHostOf("https://App.Entry.mn"), "app.entry.mn");
  assert.equal(clientHostOf("https://entry-staging.up.railway.app/"), "entry-staging.up.railway.app");
  assert.equal(clientHostOf(null), null);
  assert.equal(clientHostOf("not a url"), null);
});

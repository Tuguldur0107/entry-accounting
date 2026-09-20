import test from "node:test";
import assert from "node:assert/strict";

import { qpayReadiness } from "../lib/qpay/readiness";

const QPAY = { name: "QPay", kind: "ewallet", provider: "qpay", cashAccountId: "acc", isActive: true };

test("бүрэн тохиргоо → бэлэн; нийтийн URL алга бол зөвхөн анхааруулга", () => {
  const ok = qpayReadiness({
    apiUrl: "https://qpay-dashboard-production.up.railway.app",
    apiKeySet: true,
    webhookSecretSet: true,
    publicUrl: "https://entry.example",
    paymentMethods: [QPAY],
  });
  assert.equal(ok.ready, true);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.warnings, []);
  const noUrl = qpayReadiness({ ...ok, apiUrl: "https://x", apiKeySet: true, webhookSecretSet: true, publicUrl: null, paymentMethods: [QPAY] });
  assert.equal(noUrl.ready, true);
  assert.equal(noUrl.warnings.length, 1);
});

test("дутуу — key, secret, хэлбэр, данс, төрөл, URL бүгд нэрлэгдэнэ", () => {
  const bad = qpayReadiness({
    apiUrl: "ftp://x",
    apiKeySet: false,
    webhookSecretSet: false,
    publicUrl: "https://entry.example",
    paymentMethods: [
      { name: "QPay карт", kind: "card", provider: "qpay", cashAccountId: null, isActive: true },
      { name: "Хуучин QPay", kind: "ewallet", provider: "qpay", cashAccountId: "acc", isActive: false },
    ],
  });
  assert.equal(bad.ready, false);
  assert.ok(bad.problems.some((p) => p.includes("URL")));
  assert.ok(bad.problems.some((p) => p.includes("API key")));
  assert.ok(bad.problems.some((p) => p.includes("secret")));
  assert.ok(bad.problems.some((p) => p.includes("зөвхөн ewallet")));
  assert.ok(bad.problems.some((p) => p.includes("түр данс")));
  // Идэвхгүй хэлбэр тоологдохгүй → идэвхтэй QPay хэлбэр «алга» гэж хэлэхгүй (нэг идэвхтэй буруу байгаа).
  assert.equal(bad.problems.some((p) => p.includes("алга")), false);
});

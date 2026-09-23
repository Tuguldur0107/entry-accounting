import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyToolError,
  internalErrorText,
  isInternalDbError,
} from "../lib/ai/error-sanitize";

const ORG = "4a643581-9e1a-4cc5-8027-518975789024";

test("ENT-070: DrizzleQueryError (SQL + org UUID параметр) дотоод гэж танигдана", () => {
  const pg = Object.assign(new Error('column "x" does not exist'), { code: "42703" });
  const drizzle = Object.assign(
    new Error(`Failed query: select "id" from "ar_ap_documents" where "organization_id" = $1\nparams: ${ORG}`),
    { name: "DrizzleQueryError", cause: pg }
  );
  const result = classifyToolError(drizzle, () => 0.5);
  assert.equal(result.internal, true);
  const text = result.internal ? internalErrorText(result.logId) : "";
  assert.ok(!text.includes(ORG), "UUID хэрэглэгчид гарахгүй");
  assert.ok(!/select|from|params/i.test(text), "SQL хэрэглэгчид гарахгүй");
  assert.match(text, /лавлах код: [0-9A-F]{8}/);
});

test("cause гинжинд л SQLSTATE байвал ч дотоод", () => {
  const wrapped = new Error("Алдаа", { cause: Object.assign(new Error("x"), { code: "23505" }) });
  assert.equal(isInternalDbError(wrapped), true);
});

test("«Failed query» мессеж code-гүй байсан ч дотоод", () => {
  assert.equal(isInternalDbError(new Error("Failed query: update t set a = $1")), true);
});

test("монгол validation болон [CODE] алдаа хэвээр дамжина", () => {
  const plain = classifyToolError(new Error("[ACCOUNT_NOT_FOUND] 1311 данс олдсонгүй"));
  assert.deepEqual(plain, { internal: false, message: "[ACCOUNT_NOT_FOUND] 1311 данс олдсонгүй" });
  const entitlement = Object.assign(new Error("Багцад байхгүй"), { code: "FEATURE_NOT_IN_PLAN" });
  assert.equal(classifyToolError(entitlement).internal, false);
});

test("алдаа биш утга — «Тодорхойгүй алдаа»", () => {
  assert.deepEqual(classifyToolError(undefined), { internal: false, message: "Тодорхойгүй алдаа" });
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCashAccountCodeRules,
  validateCashAccountCode,
} from "../lib/cash/account-code-validation";
import { parseBankStatementFile } from "../lib/cash/bank-statement-parser";

function bytes(value: string) {
  return new TextEncoder().encode(value).buffer;
}

test("detects a semicolon-delimited statement below a title row", async () => {
  const statement = [
    "Example bank",
    "Value Date;Transaction Date;Description;Credit;Debit",
    "2026-06-02;2026-06-01;Customer receipt;1250;0",
  ].join("\n");

  const parsed = await parseBankStatementFile(
    "statement.csv",
    bytes(statement)
  );

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].transactionDate, "2026-06-01");
  assert.equal(parsed.rows[0].valueDate, "2026-06-02");
  assert.equal(parsed.rows[0].income, 1250);
});

test("validates every active Cash segment and inactive defaults", () => {
  const rules = buildCashAccountCodeRules(
    [],
    [
      {
        segmentId: 1,
        code: "ENT",
        isEnabled: true,
        modules: "gl,cash",
      },
      {
        segmentId: 8,
        code: "OPER",
        isEnabled: true,
        modules: "gl,cash",
      },
      {
        segmentId: 9,
        code: "CA",
        isEnabled: true,
        modules: "cash",
      },
    ],
    [
      {
        number: "11000001",
        isEnabled: true,
        modules: "gl,cash",
      },
    ]
  );
  const valid = "ENT..11000001...000.0000.OPER.CA.0";

  assert.equal(validateCashAccountCode(valid, rules), "11000001");
  assert.throws(
    () =>
      validateCashAccountCode(
        "ENT.CC01.11000001...000.0000.OPER.CA.0",
        rules
      ),
    /S2 сегмент Cash-д идэвхгүй/
  );
  assert.throws(
    () =>
      validateCashAccountCode(
        "ENT..11000001...000.0000.INVL.CA.0",
        rules
      ),
    /S8 сегментийн утга Cash-д идэвхгүй/
  );
});

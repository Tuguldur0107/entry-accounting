import test from "node:test";
import assert from "node:assert/strict";

import { planNonVatSale } from "../lib/pos/non-vat";

const accounts = { nonVatRevenueAccountNumber: "51100009", nonVatReceivableAccountNumber: "13110009" };

test("НӨАТ асаалттай (анхдагч) — ердийн борлуулалт", () => {
  assert.deepEqual(planNonVatSale({}, accounts, true), { nonVat: false });
  assert.deepEqual(planNonVatSale({ nonVat: false, nonVatReason: "x" }, accounts, true), { nonVat: false });
});

test("НӨАТ төлөгч бус байгууллагад туг нөлөөгүй (бүх борлуулалт аль хэдийн НӨАТ-гүй)", () => {
  assert.deepEqual(planNonVatSale({ nonVat: true }, { nonVatRevenueAccountNumber: null, nonVatReceivableAccountNumber: null }, false), {
    nonVat: false,
  });
});

test("НӨАТ-гүй: тусдаа данс + шалтгаан", () => {
  assert.deepEqual(planNonVatSale({ nonVat: true, nonVatReason: "  Нөхөж оруулсан борлуулалт " }, accounts, true), {
    nonVat: true,
    reason: "Нөхөж оруулсан борлуулалт",
    revenueAccountNumber: "51100009",
    receivableAccountNumber: "13110009",
  });
});

test("НӨАТ-гүй: шалтгаангүй / данс тохируулаагүй / eBarimt мэдээлэлтэй бол татгалзана", () => {
  assert.throws(() => planNonVatSale({ nonVat: true, nonVatReason: "" }, accounts, true), /NON_VAT_REASON_REQUIRED/);
  assert.throws(
    () => planNonVatSale({ nonVat: true, nonVatReason: "Залруулга" }, { ...accounts, nonVatReceivableAccountNumber: " " }, true),
    /NON_VAT_ACCOUNTS_REQUIRED/
  );
  assert.throws(
    () => planNonVatSale({ nonVat: true, nonVatReason: "Залруулга", hasEbarimtData: true }, accounts, true),
    /NON_VAT_EBARIMT_CONFLICT/
  );
});

test("НӨАТ-гүй борлуулалтын данс default-тай, стандарт дансны төлөвлөгөөнд нэртэй", async () => {
  const { readFileSync } = await import("node:fs");
  const { STANDARD_ACCOUNTS } = await import("../lib/constants/standard-accounts");
  const schema = readFileSync("lib/db/schema.ts", "utf8");
  const ddl = readFileSync("scripts/apply-pending-ddl.mjs", "utf8");
  for (const number of ["51100002", "13110002"]) {
    assert.ok(STANDARD_ACCOUNTS.some((account) => account.number === number), `${number} STANDARD_ACCOUNTS-д`);
    assert.match(schema, new RegExp(`notNull\\(\\)\\.default\\("${number}"\\)`));
    assert.match(ddl, new RegExp(`'${number}'`), `${number} preDeploy нөхөлтөд`);
  }
});

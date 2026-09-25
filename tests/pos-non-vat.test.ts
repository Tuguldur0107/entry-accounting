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

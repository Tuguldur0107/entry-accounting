import test from "node:test";
import assert from "node:assert/strict";

import {
  bankAccountsEqualForQpay,
  buildQpayProvisionPlan,
  mapQpayBankAccounts,
  normalizeQpayPhone,
  payoutAccountsFromCashAccounts,
  qpayMerchantTypeOf,
  type CashAccountForQpay,
} from "../lib/qpay/provision";
import { guessQpayBankCode } from "../lib/qpay/reference";

const COMPANY = {
  name: "Хос Хас Технологи ХХК",
  registerNo: "6596177",
  mccCode: "5411",
  cityCode: "11000",
  districtCode: "17000",
  address: "Хан-Уул, 15-р хороо",
  phone: "+976 8811 2233",
  email: "info@example.mn",
  bankAccounts: [
    { bankName: "Хаан банк", accountNo: "5001234567", accountName: "Хос Хас Технологи ХХК", bankCode: "050000" },
    { bankName: "Голомт банк", accountNo: "1105001234", accountName: "Хос Хас Технологи ХХК", isDefault: true, iban: "MN12150011050012340000" },
  ],
};
const OWNER = { email: "owner@example.mn", name: "Тугулдур" };

test("бүрэн компани → company мерчант, данс default тэмдэглэснээр, утас 8 орон, webhook", () => {
  const plan = buildQpayProvisionPlan({ orgId: "org-1", company: COMPANY, owner: OWNER, webhookUrl: "https://app.entry.mn/api/pos/qpay/webhook" });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.type, "company");
  assert.equal(plan.body.external_id, "org-1");
  assert.equal(plan.body.merchant.name, COMPANY.name);
  assert.equal(plan.body.merchant.phone, "88112233");
  assert.equal(plan.body.merchant.email, "info@example.mn");
  assert.equal(plan.body.webhook_url, "https://app.entry.mn/api/pos/qpay/webhook");
  assert.equal(plan.body.bank_accounts.length, 2);
  assert.deepEqual(plan.body.bank_accounts.map((a) => a.is_default), [false, true]);
  assert.equal(plan.body.bank_accounts[1].iban, "MN12150011050012340000");
  assert.equal(plan.body.bank_accounts[0].bank_name, "Хаан банк");
  assert.equal(plan.body.rotate_credentials, undefined);
  assert.equal(plan.body.partner_label, "Entry");
});

test("дутуу талбар бүр НЭРЛЭГДЭНЭ — MCC, хот, дүүрэг, хаяг, утас, данс, регистр", () => {
  const plan = buildQpayProvisionPlan({
    orgId: "org-1",
    company: { name: "X", registerNo: "12", mccCode: null, cityCode: null, districtCode: "", address: "", phone: "", email: "", bankAccounts: [] },
    owner: { email: "", name: null },
    webhookUrl: null,
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  const text = plan.problems.join("\n");
  for (const needle of ["Регистр", "MCC", "Утас", "И-мэйл", "Хот", "Дүүрэг", "Хаяг", "Банкны данс"]) {
    assert.ok(text.includes(needle), `дутуу: ${needle}`);
  }
});

test("иргэний регистр → person, «Овог Нэр» задарна; нэг үгтэй бол асуудал", () => {
  const person = { ...COMPANY, name: "Батаа Дорж", registerNo: "УБ12345678" };
  const plan = buildQpayProvisionPlan({ orgId: "o", company: person, owner: OWNER, webhookUrl: null, rotateCredentials: true });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.type, "person");
  assert.equal(plan.body.merchant.last_name, "Батаа");
  assert.equal(plan.body.merchant.first_name, "Дорж");
  assert.equal(plan.body.merchant.name, undefined);
  assert.equal(plan.body.rotate_credentials, true);
  assert.equal(plan.body.webhook_url, undefined);
  const bad = buildQpayProvisionPlan({ orgId: "o", company: { ...person, name: "Дорж" }, owner: OWNER, webhookUrl: null });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.problems.some((p) => p.includes("Овог Нэр")));
});

test("компанийн и-мэйл хоосон бол эзний и-мэйл; регистрийн төрөл таамаглагдахгүй", () => {
  const plan = buildQpayProvisionPlan({ orgId: "o", company: { ...COMPANY, email: null }, owner: OWNER, webhookUrl: null });
  assert.equal(plan.ok, true);
  if (plan.ok) assert.equal(plan.body.merchant.email, OWNER.email);
  assert.equal(qpayMerchantTypeOf("6596177"), "company");
  assert.equal(qpayMerchantTypeOf("уб12345678"), "person");
  assert.equal(qpayMerchantTypeOf("12345678901"), null);
  assert.equal(qpayMerchantTypeOf(""), null);
});

test("данс: код нэрээс таагдана, танигдахгүй банк → асуудал, default тэмдэггүй бол эхнийх", () => {
  const mapped = mapQpayBankAccounts([
    { bankName: "Голомт", accountNo: "1", accountName: "A" },
    { bankName: "Хаан банк", accountNo: "2", accountName: "B" },
    { bankName: "Тодорхойгүй банк", accountNo: "3", accountName: "C" },
    { bankName: "", accountNo: "", accountName: "" },
  ]);
  assert.equal(mapped.accounts.length, 2);
  assert.equal(mapped.accounts[0].account_bank_code, "150000");
  assert.equal(mapped.accounts[0].is_default, true);
  assert.equal(mapped.accounts[1].account_bank_code, "050000");
  assert.equal(mapped.accounts[1].is_default, false);
  assert.equal(mapped.problems.length, 1);
  assert.ok(mapped.problems[0].includes("3"));
  assert.equal(guessQpayBankCode("Худалдаа хөгжлийн банк"), "040000");
  assert.equal(guessQpayBankCode("ХХБ"), null);
});

test("утасны normalize + дансны тэнцэл (sync хэрэгтэй эсэх)", () => {
  assert.equal(normalizeQpayPhone("+976 8811-2233"), "88112233");
  assert.equal(normalizeQpayPhone("0097688112233"), "88112233");
  assert.equal(normalizeQpayPhone(null), "");
  const a = COMPANY.bankAccounts;
  assert.equal(bankAccountsEqualForQpay(a, [...a]), true);
  assert.equal(bankAccountsEqualForQpay(a, [a[0], { ...a[1], accountName: "Өөр" }]), false);
  assert.equal(bankAccountsEqualForQpay(a, [a[0]]), false);
  // Хоосон дугаартай мөр тооцогдохгүй
  assert.equal(bankAccountsEqualForQpay(a, [...a, { bankName: "", accountNo: "", accountName: "" }]), true);
});

const cashRow = (over: Partial<CashAccountForQpay>): CashAccountForQpay => ({
  id: "a",
  name: "Голомт MNT",
  accountType: "bank",
  bankName: "Голомт банк",
  bankCode: "150000",
  accountNumber: "1105001234",
  accountHolder: null,
  iban: null,
  currency: "MNT",
  qpayPayout: true,
  qpayDefault: false,
  isActive: true,
  ...over,
});

test("кассын данс → QPay данс: зөвхөн тэмдэглэсэн/идэвхтэй/банкны; эзэмшигч хоосон бол компанийн нэр; үндсэн нэг л", () => {
  const out = payoutAccountsFromCashAccounts(
    [
      cashRow({ id: "1", qpayDefault: true }),
      cashRow({ id: "2", name: "Хаан", bankCode: "050000", accountNumber: "5001234567", accountHolder: "Салбар 2", qpayDefault: true }),
      cashRow({ id: "3", name: "Тэмдэглээгүй", qpayPayout: false }),
      cashRow({ id: "4", name: "Идэвхгүй", isActive: false }),
      cashRow({ id: "5", name: "Касс", accountType: "cash" }),
    ],
    "Хос Хас ХХК"
  );
  assert.equal(out.problems.length, 0);
  assert.deepEqual(
    out.accounts.map((a) => [a.accountNo, a.accountName, a.bankCode, a.isDefault]),
    [
      ["1105001234", "Хос Хас ХХК", "150000", true],
      ["5001234567", "Салбар 2", "050000", false],
    ]
  );
  // mapQpayBankAccounts-тай нийлж Partner API-ийн хэлбэрт
  const mapped = mapQpayBankAccounts(out.accounts);
  assert.equal(mapped.problems.length, 0);
  assert.deepEqual(mapped.accounts.map((a) => a.is_default), [true, false]);
  assert.equal(mapped.accounts[0].bank_name, "Голомт банк");
});

test("кассын данс: дугааргүй / валютын данс жагсаалтад ОРОХГҮЙ, асуудал нэрлэгдэнэ; тэмдэглэсэн данс байхгүй → mapQpayBankAccounts асуудал", () => {
  const out = payoutAccountsFromCashAccounts(
    [cashRow({ id: "1", name: "Дугааргүй", accountNumber: " " }), cashRow({ id: "2", name: "USD данс", currency: "USD" })],
    "X"
  );
  assert.equal(out.accounts.length, 0);
  assert.equal(out.problems.length, 2);
  assert.ok(out.problems[0].includes("Дугааргүй"));
  assert.ok(out.problems[1].includes("MNT"));
  const mapped = mapQpayBankAccounts(out.accounts);
  assert.ok(mapped.problems[0].includes("QPay төлбөр хүлээн авах"));
  // Банкны код байхгүй бол нэрээс таагдана; танигдахгүй бол асуудал
  const noCode = payoutAccountsFromCashAccounts([cashRow({ bankCode: null, bankName: "Хаан банк" })], "X");
  assert.equal(mapQpayBankAccounts(noCode.accounts).accounts[0]?.account_bank_code, "050000");
  const unknown = payoutAccountsFromCashAccounts([cashRow({ bankCode: null, bankName: "Гадаад банк" })], "X");
  assert.equal(mapQpayBankAccounts(unknown.accounts).problems.length, 1);
});

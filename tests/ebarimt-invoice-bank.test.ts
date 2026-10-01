import test from "node:test";
import assert from "node:assert/strict";

import { pickInvoiceBank } from "../lib/ebarimt/invoice-bank";
import { normalizeIban } from "../lib/ebarimt/receipt";

const empty = { ebarimtArapBankAccountNo: "", ebarimtArapIban: "" };
const account = (bankAccountNo: string, iBan: string | null = null) => ({ bankAccountNo, bankAccountName: null, bankName: null, iBan });

test("тохиргоонд сонгосон данс давамгайлна (олон данстай байгууллага)", () => {
  assert.deepEqual(
    pickInvoiceBank({ ebarimtArapBankAccountNo: "1415 140704", ebarimtArapIban: "MN08001500" }, [account("1"), account("2")]),
    { ok: true, bankAccountNo: "1415140704", iBan: "MN08001500", source: "settings" }
  );
});

test("тохиргоо хоосон: ТЕГ-д ГАНЦ данс бол автоматаар, IBAN-ийг ТЕГ-ээс", () => {
  assert.deepEqual(pickInvoiceBank(empty, [account("1415140704", "MN08001500")]), {
    ok: true,
    bankAccountNo: "1415140704",
    iBan: "MN08001500",
    source: "teg",
  });
});

test("олон данс / данс алга / PosAPI-д хүрэхгүй — ил шалтгаан, данс зохиохгүй", () => {
  const many = pickInvoiceBank(empty, [account("1415140704"), account("5000123456")]);
  assert.equal(many.ok, false);
  assert.match(many.ok ? "" : many.reason, /2 данс.*сонгоно/);
  const none = pickInvoiceBank(empty, []);
  assert.match(none.ok ? "" : none.reason, /бүртгэлтэй банкны данс алга/);
  const unreachable = pickInvoiceBank(empty, null, "браузер горимд сервер PosAPI-д хүрэхгүй");
  assert.match(unreachable.ok ? "" : unreachable.reason, /браузер горимд/);
});

test("IBAN: ТЕГ-ийн бүртгэлийн угтвар (MN + 8 цифр) хүлээн авагдана, үсэг холилдсон нь үгүй", () => {
  assert.equal(normalizeIban("MN08001500"), "MN08001500");
  assert.equal(normalizeIban(" mn08 0015 0014 1514 0704 "), "MN080015001415140704");
  assert.equal(normalizeIban("MN0800"), null);
  assert.equal(normalizeIban("MNAB001500"), null);
});

test("олон ТЕГ данс: Компанийн мэдээллийн үндсэн данс түрүүлнэ, эс бөгөөс ганц давхцал; ТЕГ-д бүртгэлгүйг хэзээ ч сонгохгүй", () => {
  const teg = [account("1415140704", "MN08001500"), account("5000123456")];
  assert.deepEqual(pickInvoiceBank(empty, teg, null, [{ accountNo: "5000123456", isDefault: true }, { accountNo: "1415140704" }]), {
    ok: true,
    bankAccountNo: "5000123456",
    iBan: null,
    source: "company",
  });
  assert.equal((pickInvoiceBank(empty, teg, null, [{ accountNo: "1415-140704" }]) as { bankAccountNo: string }).bankAccountNo, "1415140704");
  // Компанийн данс ТЕГ-д бүртгэлгүй → сонгохгүй, ил шалтгаан
  assert.equal(pickInvoiceBank(empty, teg, null, [{ accountNo: "9999999999", isDefault: true }]).ok, false);
});

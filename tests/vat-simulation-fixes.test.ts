import test from "node:test";
import assert from "node:assert/strict";

import {
  carriedInputVat,
  computeVatReturn,
  isVatSettlementVoucher,
  type VatJournalLine,
} from "../lib/vat/return";

const OUT = "31410000";
const IN = "13620000";
const opts = { periodCode: "2025-01", outputVatAccount: OUT, inputVatAccount: IN };

const line = (
  voucherId: string,
  mainAccount: string,
  debit: number,
  credit: number,
  date = "2025-01-15"
): VatJournalLine => ({ voucherId, mainAccount, debit, credit, date, status: "posted" });

test("isVatSettlementVoucher — зөвхөн НӨАТ + мөнгөн данс", () => {
  assert.equal(isVatSettlementVoucher([OUT, IN, "11000001"], OUT, IN), true);
  assert.equal(isVatSettlementVoucher([OUT, "10000001"], OUT, IN), true);
  // Бэлэн борлуулалт (орлоготой) — эргэлт, тооцоо БИШ
  assert.equal(isVatSettlementVoucher(["10000001", "51100000", OUT], OUT, IN), false);
  assert.equal(isVatSettlementVoucher(["11000001", "72100000"], OUT, IN), false);
  // Гаралтыг хөндөөгүй оролт + мөнгө (гаалийн НӨАТ, буцаан авалт) — эргэлт
  assert.equal(isVatSettlementVoucher([IN, "11000001"], OUT, IN), false);
});

test("Аудит M: гаалид бэлнээр төлсөн импортын НӨАТ оролтод тооцогдоно", () => {
  const lines = [
    line("sale", "13110000", 1_100_000, 0),
    line("sale", "51100000", 0, 1_000_000),
    line("sale", OUT, 0, 100_000),
    // Гаалийн байгууллагад банкаар: Dr 13620000 / Cr банк
    line("customs", IN, 40_000, 0),
    line("customs", "11000001", 0, 40_000),
  ];
  const summary = computeVatReturn(lines, opts);
  assert.equal(summary.inputVat, 40_000);
  assert.equal(summary.payableVat, 60_000);
});

test("Аудит M: татварын албанаас буцаан авсан илүү оролт шилжсэн кредитийг хэрэглэнэ", () => {
  // 12-р сараас 50,000 илүү оролт шилжсэн; 1-р сард бүгдийг буцаан авав.
  const lines = [
    line("sale", OUT, 0, 100_000),
    line("sale", "13110000", 100_000, 0),
    line("refund", "11000001", 50_000, 0),
    line("refund", IN, 0, 50_000),
  ];
  const summary = computeVatReturn(lines, { ...opts, carriedInVat: 50_000 });
  // Кредит мөнгөөр авагдсан тул энэ сарын гаралтыг бууруулахгүй.
  assert.equal(summary.payableVat, 100_000);
});

test("ENT-024: өмнөх сарын НӨАТ төлөлт энэ сарын гаралтаас хасагдахгүй", () => {
  const lines = [
    // Энэ сарын борлуулалт: гаралт 868,590
    line("sale", "13110000", 9_554_490, 0),
    line("sale", "51100000", 0, 8_685_900),
    line("sale", OUT, 0, 868_590),
    // Худалдан авалт: оролт 2,897,905
    line("buy", "73100001", 28_979_050, 0),
    line("buy", IN, 2_897_905, 0),
    line("buy", "31000001", 0, 31_877_955),
    // Өмнөх (12-р) сарын НӨАТ-ыг 1-р сард төлсөн: Dr 3141 / Cr банк
    line("pay", OUT, 3_100_000, 0),
    line("pay", "11000001", 0, 3_100_000),
  ];
  const summary = computeVatReturn(lines, opts);
  assert.equal(summary.outputVat, 868_590);
  assert.equal(summary.inputVat, 2_897_905);
  assert.equal(summary.payableVat, 0);
  assert.equal(summary.refundableVat, 2_029_315); // симуляцийн зөв дүн
});

test("ENT-035: сарын сүүлийн өдрөөр бичигдсэн тооцооны журнал тайланг өөрчлөхгүй", () => {
  const base = [line("sale", "51100000", 0, 1_000_000), line("sale", OUT, 0, 100_000), line("sale", "13110000", 1_100_000, 0)];
  const settlement = [
    line("set", OUT, 100_000, 0, "2025-01-31"),
    line("set", IN, 0, 30_000, "2025-01-31"),
    line("set", "11000001", 0, 70_000, "2025-01-31"),
  ];
  const withoutSettlement = computeVatReturn(base, opts);
  const withSettlement = computeVatReturn([...base, ...settlement], opts);
  assert.deepEqual(withSettlement, withoutSettlement);
});

test("ENT-052: өмнөх саруудын илүү оролтын НӨАТ төлөх дүнгээс хасагдана", () => {
  const carried = carriedInputVat({ inputDebitBalance: 5_800_000, outputCreditBalance: 0 });
  assert.equal(carried, 5_800_000);
  const summary = computeVatReturn(
    [line("sale", OUT, 0, 900_000), line("sale", "51100000", 0, 9_000_000), line("sale", "13110000", 9_900_000, 0),
     line("buy", IN, 683_473, 0), line("buy", "31000001", 0, 683_473)],
    { ...opts, carriedInVat: carried }
  );
  assert.equal(summary.carriedInVat, 5_800_000);
  assert.equal(summary.payableVat, 0); // урьд «ТӨЛӨХ 216,527₮» гэдэг байв
  assert.equal(summary.refundableVat, 5_583_473);
  // Төлөх үлдэгдэлтэй (гаралт > оролт) бол кредит тэглэгдэнэ
  assert.equal(carriedInputVat({ inputDebitBalance: 300, outputCreditBalance: 1_000 }), 0);
});

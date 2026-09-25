import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertTpiStatus,
  normalizeDdtd,
  parseSaleListErp,
  parseSalesTotalData,
  reconcileDdtd,
  saleListErpBody,
  salesTotalDataBody,
} from "../lib/itc/tpi";
import { TPI_SALES_STATUS } from "../lib/itc/constants";

// eBarimt TPI-ийн ЦЭВЭР хэсэг: хүсэлтийн шалгалт, хариуны parser (танигдахгүй
// мөр алгасаж ТООЛНО — дүн зохиохгүй), ДДТД-ийн тулгалт.

test("salesTotalDataBody — жил/сар/өдөр/status шалгалт", () => {
  assert.deepEqual(salesTotalDataBody({ year: 2026 }), { year: 2026, status: 0 });
  assert.deepEqual(salesTotalDataBody({ year: 2026, month: 9, day: 25, status: TPI_SALES_STATUS.b2b, startCount: 0, endCount: 500 }), {
    year: 2026,
    status: 1,
    month: 9,
    day: 25,
    startCount: 0,
    endCount: 500,
  });
  assert.throws(() => salesTotalDataBody({ year: 1999 }), /Жил/);
  assert.throws(() => salesTotalDataBody({ year: 2026, month: 13 }), /Сар/);
  assert.throws(() => salesTotalDataBody({ year: 2026, day: 5 }), /сар заавал/);
  assert.throws(() => salesTotalDataBody({ year: 2026, status: 9 as never }), /status/);
});

test("saleListErpBody — албан талбарын нэр Pin/subPin/StartDate/EndDate, ТТД ба огнооны шалгалт", () => {
  assert.deepEqual(
    saleListErpBody({ pin: " 37900846788 ", subPins: ["61200064714", " "], startDate: "2026-09-01", endDate: "2026-09-30" }),
    { Pin: "37900846788", subPin: ["61200064714"], StartDate: "2026-09-01", EndDate: "2026-09-30" }
  );
  assert.throws(() => saleListErpBody({ pin: "2693518", startDate: "2026-09-01", endDate: "2026-09-30" }), /Pin/);
  assert.throws(() => saleListErpBody({ pin: "37900846788", startDate: "2026-10-01", endDate: "2026-09-30" }), /Эхлэх огноо/);
  assert.throws(() => saleListErpBody({ pin: "37900846788", startDate: "20260901", endDate: "2026-09-30" }), /YYYY-MM-DD/);
  assert.throws(() => saleListErpBody({ pin: "37900846788", subPins: ["abc"], startDate: "2026-09-01", endDate: "2026-09-30" }), /subPin/);
});

test("parseSalesTotalData — албан талбарууд, дүн стринг ч танина, ДДТД-гүй мөр алгасаж тоолно", () => {
  const result = parseSalesTotalData({
    status: 200,
    msg: "Амжилттай",
    data: [
      {
        posRno: "0000123456789012345678901234567890123",
        posRdate: "2026-09-25 10:15:00",
        posRamt: "11,000.00",
        posVamt: 1000,
        cityTax: 0,
        netAmt: 10000,
        csmrRegNo: "37900846788",
        csmrName: "ТЕСТ ХХК",
        posNo: "10001",
        districtCode: "3403",
        prParentRno: null,
      },
      { posRdate: "2026-09-25", posRamt: 5 }, // ДДТД алга → алгасна
      { posRno: "999", posRdate: "2026-09-25" }, // дүн алга → алгасна
    ],
  });
  assert.equal(result.skipped, 2);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    ddtd: "0000123456789012345678901234567890123",
    date: "2026-09-25 10:15:00",
    total: 11000,
    vat: 1000,
    cityTax: 0,
    net: 10000,
    buyerRegNo: "37900846788",
    buyerName: "ТЕСТ ХХК",
    posNo: "10001",
    districtCode: "3403",
    parentDdtd: null,
  });
  // Массив шууд ирсэн ч уншина; хоосон → мөргүй
  assert.equal(parseSalesTotalData([{ posRno: "1", posRamt: 1 }]).rows.length, 1);
  assert.deepEqual(parseSalesTotalData({}), { rows: [], skipped: 0 });
});

test("parseSaleListErp — receiptBuyModelList, receiptType 2025-09-01-ээс сонголтоор", () => {
  const result = parseSaleListErp({
    status: 200,
    data: {
      receiptBuyModelList: [
        { prPosRno: "1234", regNo: "2693518", name: "Хаан банк", amountVat: 100, amountCityTax: 0, amountTotal: 1100, amountNet: 1000, fromType: "1", receiptType: "B2B_RECEIPT" },
        { prPosRno: "5678", regNo: "2094878", name: "Мобиком", amountVat: 0, amountTotal: 500, amountNet: 500, fromType: "2" },
      ],
    },
  });
  assert.equal(result.skipped, 0);
  assert.equal(result.rows[0].receiptType, "B2B_RECEIPT");
  assert.equal(result.rows[1].receiptType, null);
  assert.equal(result.rows[1].cityTax, 0);
  assert.equal(result.rows[0].sellerName, "Хаан банк");
});

test("assertTpiStatus — ТЕГ-ийн алдааны хариу шиднэ (мөр байхгүй ч чимээгүй өнгөрөхгүй)", () => {
  assert.doesNotThrow(() => assertTpiStatus({ status: 200, data: [] }));
  assert.doesNotThrow(() => assertTpiStatus({ status: "SUCCESS" }));
  assert.doesNotThrow(() => assertTpiStatus([]));
  assert.throws(() => assertTpiStatus({ status: 500, msg: "Хугацаа хэтэрсэн" }), /\[ITC_TPI\] ТЕГ хариу: Хугацаа хэтэрсэн/);
  assert.throws(() => parseSalesTotalData({ status: 401, message: "Unauthorized" }), /Unauthorized/);
});

test("reconcileDdtd — ТЕГ ↔ Entry олонлогийн тулгалт (зай цэвэрлэнэ, эрэмбэлнэ)", () => {
  const result = reconcileDdtd(["A1", " B2 ", "C3", ""], ["B2", "D4", "A1"]);
  assert.deepEqual(result, { matched: ["A1", "B2"], onlyTax: ["C3"], onlyEntry: ["D4"] });
  assert.equal(normalizeDdtd(" 12 34 "), "1234");
});

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

test("salesTotalDataBody — албан хуудас: year/month/day STRING, status/startCount/endCount number, сар заавал", () => {
  assert.deepEqual(salesTotalDataBody({ year: 2026, month: 9, day: 25, status: TPI_SALES_STATUS.b2b, startCount: 0, endCount: 500 }), {
    year: "2026",
    month: "9",
    day: "25",
    status: 1,
    startCount: 0,
    endCount: 500,
  });
  // startCount/endCount заавал — өгөөгүй бол эхний хуудас
  assert.deepEqual(salesTotalDataBody({ year: 2026, month: 10 }), { year: "2026", month: "10", status: 0, startCount: 0, endCount: 500 });
  assert.throws(() => salesTotalDataBody({ year: 2026 }), /Сар заавал/);
  assert.throws(() => salesTotalDataBody({ year: 1999, month: 1 }), /Жил/);
  assert.throws(() => salesTotalDataBody({ year: 2026, month: 13 }), /Сар/);
  assert.throws(() => salesTotalDataBody({ year: 2026, day: 5 }), /сар заавал/);
  assert.throws(() => salesTotalDataBody({ year: 2026, month: 1, status: 9 as never }), /status/);
});

test("saleListErpBody — албан хуудас: pin (регистр), subPin, startDate, endDate жижиг үсгээр", () => {
  assert.deepEqual(
    saleListErpBody({ pin: " 5574387 ", subPins: ["2693518", " "], startDate: "2026-09-01", endDate: "2026-09-30" }),
    { pin: "5574387", subPin: ["2693518"], startDate: "2026-09-01 00:00:00", endDate: "2026-09-30 23:59:59" }
  );
  // staging-ийн тест регистр 8 орон
  assert.equal(saleListErpBody({ pin: "99119911", startDate: "2026-09-01", endDate: "2026-09-01" }).pin, "99119911");
  assert.throws(() => saleListErpBody({ pin: "37900846788", startDate: "2026-09-01", endDate: "2026-09-30" }), /регистр/);
  assert.throws(() => saleListErpBody({ pin: "5574387", startDate: "2026-10-01", endDate: "2026-09-30" }), /Эхлэх огноо/);
  assert.throws(() => saleListErpBody({ pin: "5574387", startDate: "20260901", endDate: "2026-09-30" }), /YYYY-MM-DD/);
  assert.throws(() => saleListErpBody({ pin: "5574387", subPins: ["abc"], startDate: "2026-09-01", endDate: "2026-09-30" }), /subPin/);
});

test("parseSalesTotalData — албан хариу: data.content[], citytax (жижиг үсэг), pageModel.totalElements", () => {
  const result = parseSalesTotalData({
    msg: "Амжилттай",
    status: 200,
    code: null,
    data: {
      content: [
        {
          posSid: "32***73",
          posRno: "000005435500000907000001014141",
          posRdate: "2023-09-07 22:50:46",
          posRamt: 3000,
          citytax: 20,
          posVamt: 272.727273,
          netAmt: 2727.272727,
          fromType: "ebarimt",
          csmrRegNo: "20***25",
          csmrName: "МОНГ**** *** **К",
          posNo: "001",
          operatorName: "TEST OPERATOR 1",
          districtCode: "Архангай",
          prParentRno: "000005435500000901000001000001",
        },
      ],
      pageModel: { totalElements: 10 },
    },
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].cityTax, 20);
  assert.equal(result.rows[0].parentDdtd, "000005435500000901000001000001");
  assert.equal(result.totalElements, 10);
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
  assert.deepEqual(parseSalesTotalData({}), { rows: [], skipped: 0, totalElements: null });
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

test("parseSaleListErp — албан хариу: data[] → receiptBuyModelList[], amountCitytax, date, далдлагдсан борлуулагч", () => {
  const result = parseSaleListErp({
    msg: "Амжилттай",
    status: 200,
    code: null,
    data: [
      {
        startDate: "2024-01-01 00:00:00",
        endDate: "2024-04-30 23:59:59",
        regNo: "99119911",
        receiptBuyModelList: [
          {
            prPosRno: "000005743087000240101000001411087",
            name: "ГУР*****МБА",
            regNo: "57***85",
            buyerRegNo: "57***87",
            date: "2024-01-01 03:34:36",
            amountVat: 252.272727,
            amountCitytax: 25,
            amountTotal: 2775,
            amountNet: 2522.727273,
            fromType: "INVOICE",
            receiptType: "ТӨЛБӨРИЙН БАРИМТ",
          },
        ],
      },
    ],
  });
  assert.equal(result.skipped, 0, "wrapper объектыг мөр гэж үзэхгүй");
  assert.equal(result.rows.length, 1);
  assert.deepEqual(
    { ...result.rows[0] },
    {
      ddtd: "000005743087000240101000001411087",
      date: "2024-01-01 03:34:36",
      sellerRegNo: "57***85",
      sellerName: "ГУР*****МБА",
      buyerRegNo: "57***87",
      vat: 252.272727,
      cityTax: 25,
      total: 2775,
      net: 2522.727273,
      fromType: "INVOICE",
      receiptType: "ТӨЛБӨРИЙН БАРИМТ",
    }
  );
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

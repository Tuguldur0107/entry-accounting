import test from "node:test";
import assert from "node:assert/strict";

import { hoursSince, isMerchantRegistered, parsePosApiInfo } from "../lib/ebarimt/posapi-info";

test("parsePosApiInfo: албан спек §6-ийн талбарууд, leftLoteries бичиглэлийг ч уншина", () => {
  const info = parsePosApiInfo({
    operatorName: "Хос Хас Технологи",
    operatorTIN: 37900846788,
    posId: 12,
    posNo: "10001234",
    lastSentDate: "2026-09-20 11:30:00",
    leftLoteries: "1500",
    merchants: [
      { name: "Мерчант А", tin: "11111111111", customers: [] },
      { name: "нэргүй", tin: "" },
      "гажиг",
    ],
  });
  assert.equal(info.operatorTin, "37900846788");
  assert.equal(info.posNo, "10001234");
  assert.equal(info.leftLotteries, 1500);
  assert.deepEqual(info.merchants, [{ name: "Мерчант А", tin: "11111111111" }]);
});

test("parsePosApiInfo: хоосон хариу → бүх талбар null/хоосон, шидэхгүй", () => {
  const info = parsePosApiInfo({});
  assert.equal(info.leftLotteries, null);
  assert.equal(info.lastSentDate, null);
  assert.deepEqual(info.merchants, []);
});

test("isMerchantRegistered: жагсаалт өгөөгүй бол null (мэдэхгүй), өгсөн бол ТТД-ээр", () => {
  const info = parsePosApiInfo({ merchants: [{ name: "А", tin: "11111111111" }] });
  assert.equal(isMerchantRegistered(info, "11111111111"), true);
  assert.equal(isMerchantRegistered(info, " 22222222222 "), false);
  assert.equal(isMerchantRegistered(parsePosApiInfo({}), "11111111111"), null);
});

test("hoursSince: PosAPI-ийн 'yyyy-MM-dd HH:mm:ss' → цаг; гажиг огноо null; ирээдүй 0", () => {
  assert.equal(hoursSince("2026-09-18 12:00:00", "2026-09-20 12:00"), 48);
  assert.equal(hoursSince("2026-09-20 10:30:00", "2026-09-20T12:00"), 1.5);
  assert.equal(hoursSince("2026-09-21 00:00:00", "2026-09-20 12:00"), 0);
  assert.equal(hoursSince("сая", "2026-09-20 12:00"), null);
  assert.equal(hoursSince(null, "2026-09-20 12:00"), null);
});

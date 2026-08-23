import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aggregateBalances,
  buildCashFlow,
  buildCashFlowFromParts,
  cashNetsFromRows,
  computeCumulativeNetIncome,
  computeNetIncome,
} from "../lib/reports/balances";

// П28 үргэлжлэл — тайлангийн хуудсуудыг сервер талын нэгтгэлд шилжүүлэхэд
// ашигласан гурван identity:
//   1. Баланс: computeCumulativeNetIncome нь [from,to] мөрүүдээс EPOCH
//      ачаалалттай ИЖИЛ хуримтлагдсан ЦА өгнө (close = нээлт + период).
//   2. Баланс: close үлдэгдэл from-оос үл хамаарна.
//   3. CF: buildCashFlowFromParts([from,to] ваучерууд + мөрүүдээс бодсон
//      кассын нээлт/хаалт) нь бүх ваучертай buildCashFlow-той ЯГ ижил.

type Line = { accountNumber: string; debit: string; credit: string };
type Voucher = { date: string; lines: Line[] };

function voucher(date: string, lines: [string, number, number][]): Voucher {
  return {
    date,
    lines: lines.map(([accountNumber, debit, credit]) => ({
      accountNumber,
      debit: String(debit),
      credit: String(credit),
    })),
  };
}

// Кассын (11*), авлага, орлого, зардал, өр төлбөр, өмч холилдсон
// олон сарын бичилтүүд — CF-ийн гурван секц бүгд идэвхжинэ.
const VOUCHERS: Voucher[] = [
  voucher("2026-05-10", [
    ["11000001", 900000, 0],
    ["41100000", 0, 900000],
  ]),
  voucher("2026-05-20", [
    ["61100000", 150000, 0],
    ["11210000", 0, 150000],
  ]),
  voucher("2026-06-05", [
    ["11000001", 330000, 0],
    ["51100000", 0, 330000],
  ]),
  voucher("2026-06-18", [
    ["21010000", 400000, 0],
    ["11000001", 0, 400000],
  ]),
  voucher("2026-07-03", [
    ["61100000", 80000, 0],
    ["11000001", 0, 80000],
  ]),
  voucher("2026-07-12", [
    ["11210000", 250000, 0],
    ["51100000", 0, 250000],
  ]),
  voucher("2026-07-15", [
    ["11000001", 120000, 0],
    ["31000001", 0, 120000],
  ]),
  // Кассын нөлөөгүй журнал — CF-ийн секцэд орох ёсгүй.
  voucher("2026-07-20", [
    ["61100000", 45000, 0],
    ["31000001", 0, 45000],
  ]),
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asVouchers = VOUCHERS as any;

const FROM = "2026-07-01";
const TO = "2026-07-31";
const EPOCH = "1900-01-01";

test("хуримтлагдсан ЦА: close-суурьтай тооцоо EPOCH ачаалалттай ижил", () => {
  const rowsFromTo = aggregateBalances(asVouchers, [], [3], FROM, TO);
  const rowsEpoch = aggregateBalances(asVouchers, [], [3], EPOCH, TO);
  assert.deepEqual(
    computeCumulativeNetIncome(rowsFromTo),
    computeNetIncome(rowsEpoch)
  );
});

test("close үлдэгдэл from-оос үл хамаарна (Балансын мөрийн суурь)", () => {
  const rowsFromTo = aggregateBalances(asVouchers, [], [3], FROM, TO);
  const rowsEpoch = aggregateBalances(asVouchers, [], [3], EPOCH, TO);
  const closes = (rows: typeof rowsFromTo) =>
    rows.map((r) => ({
      key: r.activeKey,
      net: r.totals.closeDebit - r.totals.closeCredit,
    }));
  assert.deepEqual(closes(rowsFromTo), closes(rowsEpoch));
});

test("CF: периодын ваучер + мөрүүдээс бодсон касс = бүх ваучертай buildCashFlow", () => {
  const expected = buildCashFlow(asVouchers, [], [3], FROM, TO);

  const periodVouchers = VOUCHERS.filter((v) => v.date >= FROM && v.date <= TO);
  const mainRows = aggregateBalances(asVouchers, [], [3], FROM, TO);
  const actual = buildCashFlowFromParts(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    periodVouchers as any,
    [],
    [3],
    FROM,
    TO,
    cashNetsFromRows(mainRows)
  );

  assert.deepEqual(actual, expected);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregateBalances } from "../lib/reports/balances";
import { mergeBalanceSources } from "../lib/reports/period-balances";

// П28-ын гол баталгаа: snapshot + delta замын үр дүн ваучераас шууд
// нэгтгэдэг aggregateBalances-тай ЯГ ижил байх ёстой.

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

// 2026-05 (хаагдсан period гэж үзнэ), 2026-06, 2026-07 бичилтүүд.
const VOUCHERS: Voucher[] = [
  voucher("2026-05-10", [
    ["11000001", 500000, 0],
    ["41100000", 0, 500000],
  ]),
  voucher("2026-05-20", [
    ["61100000", 120000, 0],
    ["11000001", 0, 120000],
  ]),
  voucher("2026-06-05", [
    ["11000001", 300000, 0],
    ["51100000", 0, 300000],
  ]),
  voucher("2026-07-03", [
    ["61100000", 80000, 0],
    ["11000001", 0, 80000],
  ]),
];

// aggregateBalances-ийн хүлээж авдаг хэлбэр рүү (шаардлагатай талбарууд л).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asVouchers = VOUCHERS as any;

function sumsFor(
  filter: (date: string) => boolean
): Map<string, { debit: number; credit: number }> {
  const map = new Map<string, { debit: number; credit: number }>();
  for (const v of VOUCHERS) {
    if (!filter(v.date)) continue;
    for (const line of v.lines) {
      const entry = map.get(line.accountNumber) ?? { debit: 0, credit: 0 };
      entry.debit += Number(line.debit);
      entry.credit += Number(line.credit);
      map.set(line.accountNumber, entry);
    }
  }
  return map;
}

function deltas(filter: (date: string) => boolean) {
  return [...sumsFor(filter).entries()].map(([accountNumber, sums]) => ({
    accountNumber,
    ...sums,
  }));
}

test("snapshot + delta = aggregateBalances (2026-07 период, 05 snapshot-той)", () => {
  const expected = aggregateBalances(
    asVouchers,
    [],
    [3],
    "2026-07-01",
    "2026-07-31"
  );

  // 2026-05-ийн snapshot: нээлт (< 05-01) + период (05 дотор).
  const may = sumsFor((d) => d >= "2026-05-01" && d <= "2026-05-31");
  const snapshotRows = [...may.entries()].map(([accountNumber, sums]) => ({
    accountNumber,
    openingDebit: 0,
    openingCredit: 0,
    periodDebit: sums.debit,
    periodCredit: sums.credit,
  }));

  const actual = mergeBalanceSources(
    {
      snapshotRows,
      // Нээлтийн delta: snapshot дууссанаас (05-31) периодын эхэн хүртэл.
      openDelta: deltas((d) => d > "2026-05-31" && d < "2026-07-01"),
      periodSums: deltas((d) => d >= "2026-07-01" && d <= "2026-07-31"),
    },
    [],
    [3]
  );

  assert.deepEqual(actual, expected);
});

test("snapshot-гүй үед (шинэ байгууллага) мөн ижил", () => {
  const expected = aggregateBalances(
    asVouchers,
    [],
    [3],
    "2026-06-01",
    "2026-06-30"
  );
  const actual = mergeBalanceSources(
    {
      snapshotRows: [],
      openDelta: deltas((d) => d < "2026-06-01"),
      periodSums: deltas((d) => d >= "2026-06-01" && d <= "2026-06-30"),
    },
    [],
    [3]
  );
  assert.deepEqual(actual, expected);
});

test("кумулятив уншилт (from=1900) — БТ-ийн asOf семантик хадгалагдана", () => {
  const expected = aggregateBalances(
    asVouchers,
    [],
    [3],
    "1900-01-01",
    "2026-06-30"
  );
  const actual = mergeBalanceSources(
    {
      snapshotRows: [],
      openDelta: [],
      periodSums: deltas((d) => d <= "2026-06-30"),
    },
    [],
    [3]
  );
  assert.deepEqual(actual, expected);
});

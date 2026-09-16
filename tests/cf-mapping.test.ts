import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CF_LINES,
  buildMappedCashFlow,
  computeContraFlows,
  extractCfCode,
  resolveCfLines,
  type CfMappingInput,
} from "../lib/reports/cf-lines";
import { buildCashFlow } from "../lib/reports/balances";

// Мөнгөн гүйлгээний mapping-ийн цэвэр логик:
//   1. extractCfCode — 10 хэсэгт кодын S8 (parts[7]), "0000" = кодгүй
//   2. resolveCfLines — default prefix / override / custom / хоосон ≠ override
//   3. buildMappedCashFlow — S8 код > данс > "Ангилагдаагүй" дараалал,
//      default байдлаараа хуучин buildCashFlow-той ИЖИЛ дүн,
//      урсгал бүр яг нэг мөрөнд ордог тул нийт тулгалт хадгалагдана

/** Бүтэн 10 хэсэгт код: S3 = main, S8 = cf код. */
const acct = (main: string, cf = "0000") =>
  `000.000000.${main}.00.0000.000.0000.${cf}.GL.0`;

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

function mapping(
  lineKey: string,
  patch: Partial<Omit<CfMappingInput, "lineKey">> = {}
): CfMappingInput {
  return {
    lineKey,
    accountNumbers: "",
    cfCodes: null,
    isHidden: false,
    customLabel: null,
    customGroup: null,
    sortOrder: 0,
    ...patch,
  };
}

const ACCOUNTS = [
  "11000001",
  "11210000",
  "21010000",
  "31000001",
  "41100000",
  "51100000",
  "61100000",
  "72100000",
].map((number) => ({ number }));

const FROM = "2026-07-01";
const TO = "2026-07-31";

// Кассын орлого/зарлага бүх секцээр + S8 кодтой мөр + кассын нөлөөгүй журнал.
const VOUCHERS: Voucher[] = [
  // Борлуулалтын орлого касст: op-sales +900,000
  voucher("2026-07-02", [
    [acct("11000001"), 900000, 0],
    [acct("51100000"), 0, 900000],
  ]),
  // Өртөгт төлсөн: op-goods −150,000
  voucher("2026-07-05", [
    [acct("61100000"), 150000, 0],
    [acct("11210000"), 0, 150000],
  ]),
  // Үндсэн хөрөнгө авсан: inv-noncurrent −400,000
  voucher("2026-07-10", [
    [acct("21010000"), 400000, 0],
    [acct("11000001"), 0, 400000],
  ]),
  // Зээл авсан: fin-debt +120,000
  voucher("2026-07-15", [
    [acct("11000001"), 120000, 0],
    [acct("31000001"), 0, 120000],
  ]),
  // Цалин төлсөн, контра мөр S8 "2110" кодтой: op-payroll −50,000
  voucher("2026-07-20", [
    [acct("72100000", "2110"), 50000, 0],
    [acct("11000001"), 0, 50000],
  ]),
  // Кассын нөлөөгүй журнал — CF-д огт орох ёсгүй.
  voucher("2026-07-25", [
    [acct("61100000"), 45000, 0],
    [acct("31000001"), 0, 45000],
  ]),
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asVouchers = VOUCHERS as any;

test("extractCfCode: S8 код, '0000' болон 10 хэсэгт биш код", () => {
  assert.equal(extractCfCode(acct("11000001", "2110")), "2110");
  assert.equal(extractCfCode(acct("11000001", "0000")), "");
  assert.equal(extractCfCode(acct("11000001")), "");
  // Хуучин зөвхөн-үндсэн-данс формат — S8 байхгүй тул кодгүй.
  assert.equal(extractCfCode("11000001"), "");
});

test("resolveCfLines: default prefix, override, хоосон ≠ override, custom", () => {
  const resolved = resolveCfLines(
    [
      // op-goods-ыг тодорхой данс руу override.
      mapping("op-goods", { accountNumbers: "61100000" }),
      // Нуусан мөр — accountNumbers хоосон тул default-даа үлдэнэ.
      mapping("op-sales", { isHidden: true }),
      // Custom мөр investing секцэд.
      mapping("custom-abc", {
        accountNumbers: "13110000",
        customLabel: "Тест мөр",
        customGroup: "investing",
        sortOrder: 10,
      }),
      // S8 кодын заавар.
      mapping("fin-equity", { cfCodes: "2110, 2120" }),
    ],
    ACCOUNTS
  );

  const byKey = new Map(resolved.map((l) => [l.key, l]));
  assert.deepEqual(byKey.get("op-goods")!.accountNumbers, ["61100000"]);
  // Хоосон accountNumbers → default prefix "5"-ийн данснууд хэвээр.
  assert.deepEqual(byKey.get("op-sales")!.accountNumbers, ["51100000"]);
  assert.equal(byKey.get("op-sales")!.isHidden, true);
  assert.deepEqual(byKey.get("fin-equity")!.cfCodes, ["2110", "2120"]);

  const custom = byKey.get("custom-abc")!;
  assert.equal(custom.section, "investing");
  assert.equal(custom.label, "Тест мөр");
  assert.equal(custom.isCustom, true);
  assert.equal(custom.sortOrder, CF_LINES.length + 10);
});

test("default mapping = хуучин buildCashFlow-той ИЖИЛ секцийн дүнгүүд", () => {
  const resolved = resolveCfLines([], ACCOUNTS);
  const mapped = buildMappedCashFlow(asVouchers, FROM, TO, resolved);
  const legacy = buildCashFlow(asVouchers, [], [3], FROM, TO);

  assert.equal(mapped.totals.operating, legacy.totals.operating);
  assert.equal(mapped.totals.investing, legacy.totals.investing);
  assert.equal(mapped.totals.financing, legacy.totals.financing);
  assert.equal(mapped.totals.net, legacy.totals.net);

  // Default-аар нэг ч урсгал ангилагдахгүй үлдэхгүй.
  assert.equal(mapped.sections.operating.unmapped, 0);
  assert.equal(mapped.sections.investing.unmapped, 0);
  assert.equal(mapped.sections.financing.unmapped, 0);
});

test("мөр бүрийн дүн зөв мөрөндөө хуваарилагдана", () => {
  const mapped = buildMappedCashFlow(
    asVouchers,
    FROM,
    TO,
    resolveCfLines([], ACCOUNTS)
  );
  const amountOf = (key: string) => {
    for (const sec of Object.values(mapped.sections)) {
      const line = sec.lines.find((l) => l.key === key);
      if (line) return line.amount;
    }
    return undefined;
  };
  assert.equal(amountOf("op-sales"), 900000);
  assert.equal(amountOf("op-goods"), -150000);
  assert.equal(amountOf("op-payroll"), -50000);
  assert.equal(amountOf("inv-noncurrent"), -400000);
  assert.equal(amountOf("fin-debt"), 120000);
  assert.equal(mapped.totals.net, 420000);
});

test("S8 код дансны таарцаас ТҮРҮҮЛЖ шалгагдана", () => {
  // 72100000 нь op-payroll-ийн default данс, гэхдээ S8 "2110" код нь
  // fin-equity-д зааж өгсөн тул урсгал fin-equity рүү шилжинэ.
  const resolved = resolveCfLines(
    [mapping("fin-equity", { cfCodes: "2110" })],
    ACCOUNTS
  );
  const mapped = buildMappedCashFlow(asVouchers, FROM, TO, resolved);

  const payroll = mapped.sections.operating.lines.find(
    (l) => l.key === "op-payroll"
  )!;
  const equity = mapped.sections.financing.lines.find(
    (l) => l.key === "fin-equity"
  )!;
  assert.equal(payroll.amount, 0);
  assert.equal(equity.amount, -50000);
  // Секц хооронд шилжсэн ч нийт цэвэр урсгал хэвээр.
  assert.equal(mapped.totals.net, 420000);
});

test("аль ч мөрөнд таараагүй урсгал секцийнхээ 'Ангилагдаагүй'-д ИЛ үлдэнэ", () => {
  // op-sales-ыг өөр данс руу override → 51100000 хаана ч таарахгүй болно.
  const resolved = resolveCfLines(
    [mapping("op-sales", { accountNumbers: "59999999" })],
    ACCOUNTS
  );
  const mapped = buildMappedCashFlow(asVouchers, FROM, TO, resolved);

  // classifyCashFlow("51100000") → operating тул тэнд бүртгэгдэнэ.
  assert.equal(mapped.sections.operating.unmapped, 900000);
  // Subtotal-д ангилагдаагүй дүн орсон тул нийт тулгалт хадгалагдана.
  assert.equal(mapped.totals.net, 420000);
});

test("custom мөр + тулгалт: урсгал бүр яг нэг мөрөнд ордог", () => {
  // 13110000 accounts жагсаалтад байхгүй тул default мөрүүд авахгүй —
  // custom мөр explicit mapping-аараа авна.
  const extraVouchers = [
    ...VOUCHERS,
    voucher("2026-07-28", [
      [acct("13110000"), 0, 70000],
      [acct("11000001"), 70000, 0],
    ]),
  ];
  const resolved = resolveCfLines(
    [
      mapping("custom-avl", {
        accountNumbers: "13110000",
        customLabel: "Авлага барагдуулалт",
        customGroup: "operating",
        sortOrder: 10,
      }),
    ],
    ACCOUNTS
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapped = buildMappedCashFlow(extraVouchers as any, FROM, TO, resolved);

  const custom = mapped.sections.operating.lines.find(
    (l) => l.key === "custom-avl"
  )!;
  assert.equal(custom.amount, 70000);
  assert.equal(mapped.sections.operating.unmapped, 0);

  // Тулгалт: Σ секцийн subtotal = кассын периодын цэвэр өөрчлөлт.
  assert.equal(mapped.totals.net, 420000 + 70000);
});

test("нуусан мөрийн дүн subtotal-аас хасагдахгүй (тулгалт хадгалагдана)", () => {
  const visible = buildMappedCashFlow(
    asVouchers,
    FROM,
    TO,
    resolveCfLines([], ACCOUNTS)
  );
  const hidden = buildMappedCashFlow(
    asVouchers,
    FROM,
    TO,
    resolveCfLines([mapping("op-goods", { isHidden: true })], ACCOUNTS)
  );
  assert.equal(
    hidden.sections.operating.subtotal,
    visible.sections.operating.subtotal
  );
  assert.equal(hidden.totals.net, visible.totals.net);
});

test("computeContraFlows: данс болон S8 кодын урсгалын нэгтгэл", () => {
  const { byAccount, byCfCode } = computeContraFlows(asVouchers, FROM, TO);
  assert.equal(byAccount.get("51100000"), 900000);
  assert.equal(byAccount.get("61100000"), -150000);
  assert.equal(byAccount.get("72100000"), -50000);
  assert.equal(byAccount.get("21010000"), -400000);
  assert.equal(byAccount.get("31000001"), 120000);
  assert.equal(byCfCode.get("2110"), -50000);
  // Кассын нөлөөгүй журналын 61100000 мөр (45,000) нэгтгэлд ОРООГҮЙ.
  assert.equal(byCfCode.size, 1);
});

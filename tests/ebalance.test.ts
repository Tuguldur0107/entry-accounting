import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EBALANCE_BS_FORM,
  EBALANCE_CF_FORM,
  EBALANCE_IS_FORM,
  computeEbalanceStatements,
  ebalanceCfRowOf,
  formatEbalanceReport,
  type EbalanceInput,
  type EbalanceRow,
} from "../lib/reports/ebalance";
import type { BalanceRow } from "../lib/reports/balances";
import { BS_LINES } from "../lib/reports/bs-lines";
import { IS_LINES } from "../lib/reports/is-lines";
import { CF_LINES } from "../lib/reports/cf-lines";

// e-Balance маягтын ЦЭВЭР mapper: Entry-ийн БС/ОДТ/МГТ мөр + S8 код → СТ-1…СТ-4.
// Дүн ЗОХИОХГҮЙ: Entry-ийн мөр бүр яг нэг маягтын мөрөнд, дэд дүн/дүн нь
// маягтын томьёогоор, тэнцэл алдагдвал ИЛ тэмдэглэл.

const acct = (main: string, cf = "0000") => `000.000000.${main}.00.0000.000.0000.${cf}.GL.0`;

function row(
  mainAccount: string,
  cls: BalanceRow["cls"],
  totals: Partial<BalanceRow["totals"]>
): BalanceRow {
  return {
    activeKey: mainAccount,
    segmentParts: { 3: mainAccount },
    mainAccount,
    name: mainAccount,
    cls,
    totals: {
      openDebit: 0,
      openCredit: 0,
      periodDebit: 0,
      periodCredit: 0,
      closeDebit: 0,
      closeCredit: 0,
      ...totals,
    },
  };
}

/** Нээлт + эргэлт = хаалт гэсэн ХАТУУ тэнцэлтэй мөр. */
function balanced(
  mainAccount: string,
  cls: BalanceRow["cls"],
  open: number,
  periodDebit: number,
  periodCredit: number
): BalanceRow {
  const closeNet = open + periodDebit - periodCredit;
  return row(mainAccount, cls, {
    openDebit: open > 0 ? open : 0,
    openCredit: open < 0 ? -open : 0,
    periodDebit,
    periodCredit,
    closeDebit: closeNet > 0 ? closeNet : 0,
    closeCredit: closeNet < 0 ? -closeNet : 0,
  });
}

const ACCOUNTS = [
  "10000001", // касс
  "11000001", // банк
  "13110000", // авлага
  "14100000", // бараа
  "20000001", // ҮХ
  "31000001", // өглөг
  "31410000", // НӨАТ өглөг
  "32000001", // богино хугацаат зээл
  "41100000", // өмч
  "44000001", // хуримтлагдсан ашиг
  "51100000", // орлого
  "61100000", // COGS
  "72100000", // цалингийн зардал
  "87000001", // хүүгийн зардал
].map((number) => ({ number }));

// Тайлант үе: нээлт — касс 1000, банк 4000, авлага 2000, бараа 3000, ҮХ 10000;
// өглөг 3000, зээл 5000, өмч 10000, ХА 2000 (актив 20000 = пассив 20000).
// Эргэлт: борлуулалт 6000 (авлага), COGS 2500 (бараа), цалин 1000 (банк),
// хүү 200 (банк), авлагаас 5000 банкинд, өглөгт 1500 банкнаас, зээл 2000
// авсан (банк), ҮХ 1500 (банк), НӨАТ өглөг 600 (авлага).
const ROWS: BalanceRow[] = [
  balanced("10000001", "asset", 1000, 0, 0),
  balanced("11000001", "asset", 4000, 5000 + 2000, 1000 + 200 + 1500 + 1500),
  balanced("13110000", "asset", 2000, 6600, 5000),
  balanced("14100000", "asset", 3000, 0, 2500),
  balanced("20000001", "asset", 10000, 1500, 0),
  balanced("31000001", "liability", -3000, 1500, 0),
  balanced("31410000", "liability", 0, 0, 600),
  balanced("32000001", "liability", -5000, 0, 2000),
  balanced("41100000", "equity", -10000, 0, 0),
  balanced("44000001", "equity", -2000, 0, 0),
  balanced("51100000", "revenue", 0, 0, 6000),
  balanced("61100000", "expense", 0, 2500, 0),
  balanced("72100000", "expense", 0, 1000, 0),
  balanced("87000001", "expense", 0, 200, 0),
];

type Voucher = EbalanceInput["vouchers"][number];
function voucher(id: string, date: string, lines: [string, number, number][], documentNo = "GL-26-000001"): Voucher {
  return {
    id,
    date,
    documentNo,
    lines: lines.map(([accountNumber, debit, credit]) => ({ accountNumber, debit: String(debit), credit: String(credit) })),
  } as unknown as Voucher;
}

const VOUCHERS: Voucher[] = [
  voucher("v1", "2026-03-05", [[acct("11000001"), 5000, 0], [acct("13110000"), 0, 5000]]), // авлага орлого (кодгүй → op-sales)
  voucher("v2", "2026-03-10", [[acct("72100000", "1103"), 1000, 0], [acct("11000001"), 0, 1000]]), // цалин S8 1103
  voucher("v3", "2026-03-12", [[acct("87000001", "3103"), 200, 0], [acct("11000001"), 0, 200]]), // хүү S8 3103 → 1.2.6
  voucher("v4", "2026-03-15", [[acct("31000001"), 1500, 0], [acct("11000001"), 0, 1500]]), // өглөг төлөлт (кодгүй → op-goods → 1.2.3)
  voucher("v5", "2026-03-20", [[acct("11000001"), 2000, 0], [acct("32000001", "3101"), 0, 2000]]), // зээл авсан
  voucher("v6", "2026-03-25", [[acct("20000001", "2101"), 1500, 0], [acct("11000001"), 0, 1500]]), // ҮХ худалдан авалт
];

function input(overrides: Partial<EbalanceInput> = {}): EbalanceInput {
  return {
    rows: ROWS,
    accounts: ACCOUNTS,
    bsMappings: [],
    isMappings: [],
    cfMappings: [],
    vouchers: VOUCHERS,
    voucherCfCodes: new Map(),
    from: "2026-03-01",
    to: "2026-03-31",
    cashOpenNet: 5000,
    cashCloseNet: 5000 + 5000 + 2000 - 1000 - 200 - 1500 - 1500,
    ...overrides,
  };
}

const amountOf = (statement: { rows: EbalanceRow[] }, code: string): EbalanceRow =>
  statement.rows.find((r) => r.code === code)!;

test("маягтын мөрийн дугаар давхардахгүй, дэд дүнгийн хамаарал зөвхөн тодорхойлогдсон мөрд", () => {
  for (const form of [EBALANCE_BS_FORM, EBALANCE_IS_FORM, EBALANCE_CF_FORM]) {
    const codes = form.map((r) => r.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const def of form) {
      const deps = "sum" in def ? def.sum : "plus" in def ? [...def.plus, ...def.minus] : [];
      for (const dep of deps) assert.ok(codes.includes(dep), `${def.code} → ${dep}`);
    }
  }
});

test("Entry-ийн стандарт мөр бүр маягтын аль нэг мөрөнд орно (БС ил нэр эсвэл бүлгийн «бусад»; ОДТ ил нэр эсвэл бүлэг; МГТ чиглэлээр)", () => {
  const report = computeEbalanceStatements(input());
  const bs = report.statements[0];
  const bsSources = new Set(bs.rows.flatMap((r) => r.sources));
  for (const line of BS_LINES) assert.ok(bsSources.has(line.label), `БС: ${line.key}`);
  const is = report.statements[1];
  const isSources = new Set(is.rows.flatMap((r) => r.sources.map((s) => s.replace(/^− /, ""))));
  for (const line of IS_LINES) assert.ok(isSources.has(line.label), `ОДТ: ${line.key}`);
  for (const line of CF_LINES) {
    const inflow = ebalanceCfRowOf({ cfCode: "", lineKey: line.key, section: line.section, amount: 10 });
    const outflow = ebalanceCfRowOf({ cfCode: "", lineKey: line.key, section: line.section, amount: -10 });
    assert.ok(EBALANCE_CF_FORM.some((r) => r.code === inflow && "direction" in r && r.direction === "in"), `${line.key} орлого ${inflow}`);
    assert.ok(EBALANCE_CF_FORM.some((r) => r.code === outflow && "direction" in r && r.direction === "out"), `${line.key} зарлага ${outflow}`);
  }
});

test("СТ-1: эхний / эцсийн үлдэгдэл, хаагдаагүй ашиг хуримтлагдсан ашигт, тэнцэл 3 = 6", () => {
  const bs = computeEbalanceStatements(input()).statements[0];
  assert.equal(bs.form, "СТ-1");
  assert.equal(amountOf(bs, "1.1").opening, 5000);
  assert.equal(amountOf(bs, "1.1").amount, 7800);
  assert.equal(amountOf(bs, "1.2").amount, 3600);
  assert.equal(amountOf(bs, "1.6").amount, 500);
  assert.equal(amountOf(bs, "2.1").amount, 11500);
  assert.equal(amountOf(bs, "3").opening, 20000);
  assert.equal(amountOf(bs, "3").amount, 7800 + 3600 + 500 + 11500);
  assert.equal(amountOf(bs, "4.1.1").amount, 1500);
  assert.equal(amountOf(bs, "4.1.3").amount, 600);
  assert.equal(amountOf(bs, "4.1.5").amount, 7000);
  // Хуримтлагдсан ашиг 2000 + тайлант үеийн ашиг (6000 − 2500 − 1000 − 200 = 2300)
  assert.equal(amountOf(bs, "5.7").opening, 2000);
  assert.equal(amountOf(bs, "5.7").amount, 4300);
  assert.equal(amountOf(bs, "6").amount, amountOf(bs, "3").amount);
  assert.deepEqual(bs.notes, []);
  // Entry-д мөргүй маягтын мөр 0 + тэмдэглэл, ил нэрлэсэн мөрийн эх харагдана
  assert.equal(amountOf(bs, "2.3").amount, 0);
  assert.match(amountOf(bs, "2.3").note ?? "", /гараар/);
  assert.deepEqual(amountOf(bs, "1.1").sources, ["Мөнгөн хөрөнгө"]);
});

test("СТ-1: тэнцэл алдагдвал маягтын тэмдэглэлд ил", () => {
  const rows = ROWS.map((r) => (r.mainAccount === "10000001" ? balanced("10000001", "asset", 1000, 100, 0) : r));
  const bs = computeEbalanceStatements(input({ rows })).statements[0];
  assert.equal(bs.notes.length, 1);
  assert.match(bs.notes[0], /зөрүү 100\.00/);
});

test("СТ-2: маягтын мөр, дэд дүн = Entry-ийн цэвэр ашиг; ханшийн олз − гарз нэг мөрөнд", () => {
  const rows = [
    ...ROWS,
    balanced("51800001", "revenue", 0, 0, 300), // ханшийн олз
    balanced("87000003", "expense", 0, 120, 0), // ханшийн гарз
  ];
  const accounts = [...ACCOUNTS, { number: "51800001" }, { number: "87000003" }];
  const is = computeEbalanceStatements(input({ rows, accounts })).statements[1];
  assert.equal(is.form, "СТ-2");
  assert.equal(amountOf(is, "1").amount, 6000);
  assert.equal(amountOf(is, "2").amount, 2500);
  assert.equal(amountOf(is, "3").amount, 3500);
  assert.equal(amountOf(is, "10").amount, 1000);
  assert.equal(amountOf(is, "11").amount, 200);
  assert.equal(amountOf(is, "13").amount, 180);
  // 22 = Entry-ийн орлогын тайлангийн цэвэр ашиг (mapping бүрэн бол тэмдэглэлгүй)
  const net = 6000 + 300 - 2500 - 1000 - 200 - 120;
  assert.equal(amountOf(is, "22").amount, net);
  assert.deepEqual(is.notes, []);
  assert.deepEqual(amountOf(is, "13").sources, ["Ханшийн олз", "− Ханшийн гарз"]);
});

test("СТ-2: mapping-д ороогүй 5–8 данс байвал цэвэр ашгийн зөрүү тэмдэглэгдэнэ", () => {
  const rows = [...ROWS, balanced("99000001", "expense", 0, 50, 0)];
  const is = computeEbalanceStatements(input({ rows, accounts: [...ACCOUNTS, { number: "99000001" }] })).statements[1];
  assert.equal(amountOf(is, "22").amount, 2300);
  assert.equal(is.notes.length, 1);
  assert.match(is.notes[0], /2250\.00/);
});

test("СТ-3: эхний + ашиг + бусад = эцсийн, багана бүрд; хуримтлагдсан ашиг хаагдаагүй ашгийг агуулна", () => {
  const equity = computeEbalanceStatements(input()).statements[2];
  assert.equal(equity.form, "СТ-3");
  const re = equity.columns.indexOf("Хуримтлагдсан ашиг");
  const total = equity.columns.length - 1;
  const opening = equity.rows.find((r) => r.code === "1")!.cells!;
  const profit = equity.rows.find((r) => r.code === "3")!.cells!;
  const closing = equity.rows.find((r) => r.code === "5")!.cells!;
  assert.equal(opening[0], 10000);
  assert.equal(opening[re], 2000);
  assert.equal(opening[total], 12000);
  assert.equal(profit[re], 2300);
  assert.equal(profit[total], 2300);
  assert.equal(closing[re], 4300);
  assert.equal(closing[total], 14300);
  assert.deepEqual(equity.notes, []);
});

test("СТ-4: S8 код → маягтын мөр, кодгүй урсгал Entry-ийн мөрийн чиглэлээр, эхний + цэвэр = эцсийн", () => {
  const cf = computeEbalanceStatements(input()).statements[3];
  assert.equal(cf.form, "СТ-4");
  assert.equal(amountOf(cf, "1.1.1").amount, 5000); // авлагаас (op-sales, кодгүй)
  assert.equal(amountOf(cf, "1.2.1").amount, 1000); // S8 1103
  assert.equal(amountOf(cf, "1.2.3").amount, 1500); // өглөг (op-goods, кодгүй)
  assert.equal(amountOf(cf, "1.2.6").amount, 200); // S8 3103 → үйл ажиллагаа
  assert.equal(amountOf(cf, "1.1").amount, 5000);
  assert.equal(amountOf(cf, "1.2").amount, 2700);
  assert.equal(amountOf(cf, "1.3").amount, 2300);
  assert.equal(amountOf(cf, "2.2.1").amount, 1500);
  assert.equal(amountOf(cf, "2.3").amount, -1500);
  assert.equal(amountOf(cf, "3.1.1").amount, 2000);
  assert.equal(amountOf(cf, "3.3").amount, 2000);
  assert.equal(amountOf(cf, "4").amount, 2800);
  assert.equal(amountOf(cf, "5").amount, 5000);
  assert.equal(amountOf(cf, "7").amount, 7800);
  assert.deepEqual(amountOf(cf, "1.2.1").sources, ["S8 1103"]);
  // Тэнцэл таарсан; кодгүй 2 урсгал тэмдэглэгдэнэ
  assert.equal(cf.notes.length, 1);
  assert.match(cf.notes[0], /2 урсгал S8 кодгүй/);
});

test("СТ-4: эцсийн үлдэгдэл таарахгүй бол ил тэмдэглэл; чиглэлээр байрлах S8 код (2109/3109)", () => {
  const cf = computeEbalanceStatements(input({ cashCloseNet: 7000 })).statements[3];
  assert.ok(cf.notes.some((n) => /≠ эцсийн 7000\.00/.test(n)));
  assert.equal(ebalanceCfRowOf({ cfCode: "2109", lineKey: "inv-noncurrent", section: "investing", amount: 5 }), "2.1.4");
  assert.equal(ebalanceCfRowOf({ cfCode: "2109", lineKey: "inv-noncurrent", section: "investing", amount: -5 }), "2.2.4");
  assert.equal(ebalanceCfRowOf({ cfCode: "3105", lineKey: null, section: "financing", amount: -5 }), "3.2.4");
  assert.equal(ebalanceCfRowOf({ cfCode: "", lineKey: null, section: "financing", amount: -5 }), "3.2.1");
});

test("хэрэглэгчийн mapping (custom мөр, override) маягтын бүлгийн «бусад» мөрөнд орно", () => {
  const rows = [...ROWS, balanced("15900001", "asset", 700, 0, 0)];
  const accounts = [...ACCOUNTS, { number: "15900001" }];
  const bsMappings = [
    {
      lineKey: "custom-1",
      accountNumbers: "15900001",
      isHidden: false,
      customLabel: "Барьцаа",
      customGroup: "current-assets",
      sortOrder: 1,
    },
  ];
  const bs = computeEbalanceStatements(input({ rows, accounts, bsMappings })).statements[0];
  assert.equal(amountOf(bs, "1.8").amount, 700);
  assert.deepEqual(amountOf(bs, "1.8").sources, ["Бусад эргэлтийн хөрөнгө", "Барьцаа"]);
  // Custom данс ангилагдаагүй байсан бол ч мөн «бусад»-д (ENT-072 unclassified)
  const bs2 = computeEbalanceStatements(input({ rows, accounts })).statements[0];
  assert.equal(amountOf(bs2, "1.8").amount, 700);
  assert.ok(amountOf(bs2, "1.8").sources.includes("Ангилагдаагүй данс"));
});

test("formatEbalanceReport — 4 маягт, мөрийн код, эх, тэмдэглэл текстээр", () => {
  const text = formatEbalanceReport(computeEbalanceStatements(input()), (n) => n.toFixed(0));
  assert.match(text, /СТ-1 САНХҮҮГИЙН БАЙДЛЫН ТАЙЛАН/);
  assert.match(text, /1\.1 Мөнгө, түүнтэй адилтгах хөрөнгө — 5000 \| 7800 ← Мөнгөн хөрөнгө/);
  assert.match(text, /СТ-3 ӨМЧИЙН ӨӨРЧЛӨЛТИЙН ТАЙЛАН/);
  assert.match(text, /1\.2\.6 Хүүний төлбөрт төлсөн — 200 ← S8 3103/);
  assert.match(text, /⚠ Entry-д харгалзах мөр байхгүй/);
});

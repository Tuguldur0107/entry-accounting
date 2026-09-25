// QPay / э-хэтэвчийн settlement — банкны хуулгын импортоор түр данс → банк
// шилжүүлэг + шимтгэлийн зарлага үүсэж касс модуль ба GL тулах DB урсгал.
// DATABASE_URL байхгүй бол алгасна (CI-ийн DB алхамд ажиллана).

import "./helpers/load-env";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд алгасна
}

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { loadEwalletSettlementContext } from "../lib/cash/ewallet-settlement-data";
import { db } from "../lib/db";
import {
  cashAccounts,
  cashDocuments,
  journalLines,
  memberships,
  organizationProfile,
  organizations,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, input: unknown, mode: "draft" | "post" = "draft") =>
  asOrg(() => executeAiTool(userId, name, input, mode));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result;
}
const main = (code: string) => (code.split(".").length === 10 ? code.split(".")[2] : code);

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `ews-${STAMP}`, email: `ews-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `QPay settlement ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId: user.id, organizationId: org.id, name: `QPay settlement ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
  ok(await tool("create_cash_account", { name: "Голомт банк", accountType: "bank", currency: "MNT", glAccount: "11000001" }));
  ok(await tool("create_cash_account", { name: "QPay түр данс", accountType: "bank", currency: "MNT", glAccount: "11000099" }));
  ok(
    await tool("save_pos_payment_method", {
      code: "QPAY",
      name: "QPay",
      kind: "ewallet",
      cashAccount: "QPay түр данс",
      provider: "qpay",
      feePercent: 1,
    })
  );
  // Түр данс руу орсон QPay төлбөрүүд (POS-ийн орлоготой ижил: posted receipt → түр данс).
  for (const [date, amount, ref] of [
    ["2026-09-23", 3_780, "qpay-1"],
    ["2026-09-24", 30_240, "qpay-2"],
    ["2026-09-25", 100_000, "qpay-3"],
  ] as const)
    ok(
      await tool(
        "create_cash_transaction",
        {
          documentType: "receipt", date, cashAccount: "QPay түр данс", counterAccount: "51100000",
          amount, description: `QPay төлбөр ${ref}`, externalRef: `sim-${STAMP}-${ref}`,
        },
        "post"
      )
    );
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function qpayAccountId() {
  const account = await db.query.cashAccounts.findFirst({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.name, "QPay түр данс")),
    columns: { id: true },
  });
  assert.ok(account);
  return account.id;
}

test("тулгагдаагүй орлого: context + get_pos_status", { skip: !DB_READY }, async () => {
  await setupOrg();
  const context = await asOrg(() => loadEwalletSettlementContext(orgId));
  assert.equal(context.feeAccountNumber, "73100008");
  assert.equal(context.methods.length, 1);
  assert.equal(context.methods[0].methodCode, "QPAY");
  assert.equal(context.methods[0].feePercent, 1);
  assert.deepEqual(
    context.methods[0].openReceipts.map((receipt) => [receipt.date, receipt.amount]),
    [["2026-09-23", 3_780], ["2026-09-24", 30_240], ["2026-09-25", 100_000]]
  );
  const status = ok(await tool("get_pos_status", {})).resultText;
  assert.match(status, /Э-хэтэвчийн түр данс тулгагдаагүй: QPay → «QPay түр данс» 134,020₮ \(3 орлого, шимтгэл 1%\)/);
});

test("import_bank_statement ewalletSettlement → түр данс → банк шилжүүлэг + шимтгэл, reconcile OK", { skip: !DB_READY }, async () => {
  await setupOrg();
  // 23–24-ний хоёр орлого: 34,020 − 1% (37.8 + 302.4 = 340.2) → ККТТ бүхэл ₮-өөр 340 суутгав.
  const imported = ok(
    await tool(
      "import_bank_statement",
      {
        cashAccount: "Голомт банк",
        statementRef: `ews-${STAMP}-1`,
        rows: [
          { date: "2026-09-25", description: "ККТТ ХХК QPay settlement 09/24", income: 33_680, ewalletSettlement: true },
          { date: "2026-09-25", description: "Түрээсийн орлого", counterparty: "Болор Трейд", income: 500_000, counterGlAccount: "51100000" },
        ],
      },
      "post"
    )
  ).resultText;
  assert.match(imported, /1 э-хэтэвчийн settlement — түр данс → банк шилжүүлэг нийт 34,020₮, шимтгэл 340₮/);

  const qpayId = await qpayAccountId();
  const docs = await db.query.cashDocuments.findMany({
    where: and(eq(cashDocuments.organizationId, orgId), eq(cashDocuments.fromCashAccountId, qpayId)),
  });
  const transfer = docs.find((doc) => doc.documentType === "transfer");
  const fee = docs.find((doc) => doc.documentType === "payment");
  assert.ok(transfer, "шилжүүлэг үүссэн");
  assert.ok(fee, "шимтгэлийн зарлага үүссэн");
  assert.equal(Number(transfer.amount), 33_680);
  assert.equal(transfer.status, "posted");
  assert.equal(transfer.counterAccountNumber, null);
  assert.equal(Number(fee.amount), 340);
  assert.equal(fee.counterAccountNumber, "73100008");
  assert.match(fee.documentNo, /-F$/);
  assert.match(fee.description, /QPay settlement шимтгэл/);

  // GL: Dr банк 33,680 / Cr түр данс 33,680 (хоёулаа кассын данстай), Dr шимтгэл 340 / Cr түр данс 340.
  const lines = await db.query.journalLines.findMany({
    where: inArray(journalLines.voucherId, [transfer.voucherId!, fee.voucherId!]),
  });
  const byVoucher = (voucherId: string) => lines.filter((line) => line.voucherId === voucherId);
  const transferLines = byVoucher(transfer.voucherId!);
  assert.deepEqual(
    transferLines.map((line) => [main(line.accountNumber), Number(line.debit), Number(line.credit), !!line.cashAccountId]).sort(),
    [["11000001", 33_680, 0, true], ["11000099", 0, 33_680, true]]
  );
  const feeLines = byVoucher(fee.voucherId!);
  assert.deepEqual(
    feeLines.map((line) => [main(line.accountNumber), Number(line.debit), Number(line.credit)]).sort(),
    [["11000099", 0, 340], ["73100008", 340, 0]]
  );

  // Түр дансанд зөвхөн 25-ны 100,000 тулгагдаагүй үлдэнэ; касс ↔ GL зөрүүгүй.
  const context = await asOrg(() => loadEwalletSettlementContext(orgId));
  assert.deepEqual(context.methods[0].openReceipts.map((receipt) => receipt.amount), [100_000]);
  const reconcile = ok(await tool("reconcile_modules", { from: "2026-09-01", to: "2026-09-30" })).resultText;
  assert.match(reconcile, /OK QPay түр данс: 100,000/);
  assert.match(reconcile, /OK Голомт банк: 533,680/);
  assert.match(reconcile, /Модуль хоорондын зөрүү илрээгүй/);
});

test("таарахгүй settlement мөр → [EWALLET_SETTLEMENT_UNMATCHED], юу ч бичигдэхгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const before = await db.query.cashDocuments.findMany({ where: eq(cashDocuments.organizationId, orgId), columns: { id: true } });
  const result = await tool(
    "import_bank_statement",
    {
      cashAccount: "Голомт банк",
      statementRef: `ews-${STAMP}-2`,
      rows: [{ date: "2026-09-26", description: "QPay settlement", income: 77_777, ewalletSettlement: true }],
    },
    "post"
  );
  assert.match(result.resultText, /EWALLET_SETTLEMENT_UNMATCHED/);
  assert.match(result.resultText, /QPay: 100,000₮ \(1 орлого, шимтгэл 1%\)/);
  const after = await db.query.cashDocuments.findMany({ where: eq(cashDocuments.organizationId, orgId), columns: { id: true } });
  assert.equal(after.length, before.length);

  // counterGlAccount-гүй энгийн мөр татгалзана (settlement биш бол заавал).
  const missing = await tool(
    "import_bank_statement",
    { cashAccount: "Голомт банк", rows: [{ date: "2026-09-26", income: 10 }] },
    "post"
  );
  assert.match(missing.resultText, /counterGlAccount заавал/);
});

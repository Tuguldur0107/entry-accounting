// Банкны хуулгын мөрийн бүртгэлийн төрөл (docs/dev/arap.md §5l) — DB урсгал:
// урьдчилж орсон орлого / урьдчилж төлсөн / өглөг үүсгэж зардалд (НӨАТ-тэй),
// урьдчилгааг нэхэмжлэхтэй суутгах + буцаах, тооцооны акт.
// DATABASE_URL байхгүй бол алгасна (CI-ийн DB алхамд ажиллана).

import "./helpers/load-env";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { and, eq } from "drizzle-orm";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд алгасна
}

import { reverseArApOffset } from "../lib/actions/arap";
import { executeAiTool } from "../lib/ai/tools";
import { loadAdvanceBalances } from "../lib/arap/advances";
import { loadCounterpartyStatement } from "../lib/arap/statement-db";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { db } from "../lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  arapAdvanceApplications,
  counterparties,
  journalLines,
  memberships,
  organizationProfile,
  organizations,
  users,
  vatSettings,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, input: unknown, mode: "draft" | "post" = "post") =>
  asOrg(() => executeAiTool(userId, name, input, mode));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result;
}
const main = (code: string) => (code.split(".").length === 10 ? code.split(".")[2] : code);

async function counterpartyId(name: string) {
  const row = await db.query.counterparties.findFirst({
    where: and(eq(counterparties.organizationId, orgId), eq(counterparties.name, name)),
    columns: { id: true },
  });
  assert.ok(row, name);
  return row.id;
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `bra-${STAMP}`, email: `bra-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `Bank row actions ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId: user.id, organizationId: org.id, name: `Bank row actions ${STAMP}` });
  // НӨАТ төлөгч — өглөг үүсгэхэд 10/110 салгана.
  await db.insert(vatSettings).values({ userId: user.id, organizationId: org.id, isVatPayer: true });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
  ok(await tool("create_cash_account", { name: "Голомт банк", accountType: "bank", currency: "MNT", glAccount: "11000001" }, "draft"));
  ok(await tool("create_counterparty", { name: "Номин Худалдан авагч", counterpartyType: "customer" }, "draft"));
  ok(await tool("create_counterparty", { name: "Түрээслүүлэгч ХХК", counterpartyType: "supplier" }, "draft"));
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

test("import_bank_statement: урьдчилж орсон, урьдчилж төлсөн, өглөг үүсгэж зардалд (НӨАТ)", { skip: !DB_READY }, async () => {
  await setupOrg();
  const text = ok(
    await tool("import_bank_statement", {
      cashAccount: "Голомт банк",
      statementRef: `bra-${STAMP}-1`,
      rows: [
        { date: "2026-09-02", description: "Захиалгын урьдчилгаа", counterparty: "Номин Худалдан авагч", income: 1_100_000, rowAction: "advance_received" },
        { date: "2026-09-03", description: "3 сарын түрээс урьдчилж", counterparty: "Түрээслүүлэгч ХХК", expense: 600_000, rowAction: "prepaid_paid" },
        { date: "2026-09-04", description: "Засвар үйлчилгээ", counterparty: "Түрээслүүлэгч ХХК", expense: 110_000, counterGlAccount: "73100001", rowAction: "create_ap_bill" },
      ],
    })
  ).resultText;
  assert.match(text, /1 өглөгийн нэхэмжлэх үүсэж тэр даруй хаагдсан/);
  assert.match(text, /2 урьдчилгаа бүртгэгдсэн/);

  const balances = await asOrg(() => loadAdvanceBalances(orgId));
  const customer = balances.find((row) => row.side === "customer");
  const supplier = balances.find((row) => row.side === "supplier");
  assert.equal(customer?.balance, 1_100_000);
  assert.equal(customer?.accountNumber, "31300001");
  assert.equal(supplier?.balance, 600_000);
  assert.equal(supplier?.accountNumber, "18000001");

  // Өглөгийн нэхэмжлэх: батлагдсан, бүтэн төлөгдсөн, Dr зардал 100,000 + Dr НӨАТ 10,000 / Cr өглөг 110,000.
  const bill = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.documentType, "ap_bill")),
  });
  assert.ok(bill);
  assert.equal(bill.status, "paid");
  assert.equal(Number(bill.totalAmount), 110_000);
  assert.equal(Number(bill.paidAmount), 110_000);
  assert.equal(bill.counterpartyId, await counterpartyId("Түрээслүүлэгч ХХК"));
  const billLines = await db.query.arApDocumentLines.findMany({ where: eq(arApDocumentLines.documentId, bill.id) });
  assert.deepEqual(billLines.map((line) => [main(line.accountNumber), Number(line.amount)]).sort(), [
    ["13620000", 10_000],
    ["73100001", 100_000],
  ]);
  const voucherLines = await db.query.journalLines.findMany({ where: eq(journalLines.voucherId, bill.voucherId!) });
  assert.deepEqual(
    voucherLines.map((line) => [main(line.accountNumber), Number(line.debit), Number(line.credit)]).sort(),
    [["13620000", 10_000, 0], ["31000001", 0, 110_000], ["73100001", 100_000, 0]]
  );

  const reconcile = ok(await tool("reconcile_modules", { from: "2026-09-01", to: "2026-09-30" })).resultText;
  assert.match(reconcile, /OK Голомт банк: 390,000/);
});

test("rowAction-ийн буруу хэрэглээ — харилцагчгүй, буруу чиглэл", { skip: !DB_READY }, async () => {
  await setupOrg();
  const missing = await tool("import_bank_statement", {
    cashAccount: "Голомт банк",
    statementRef: `bra-${STAMP}-bad1`,
    rows: [{ date: "2026-09-05", income: 1_000, rowAction: "advance_received" }],
  });
  assert.match(missing.resultText, /counterparty заавал/);
  const wrongDirection = await tool("import_bank_statement", {
    cashAccount: "Голомт банк",
    statementRef: `bra-${STAMP}-bad2`,
    rows: [{ date: "2026-09-05", counterparty: "Номин Худалдан авагч", expense: 1_000, rowAction: "advance_received" }],
  });
  assert.match(wrongDirection.resultText, /орлогын мөрөнд л/);
});

test("apply_advance_to_invoice → нэхэмжлэх хаагдана; буцаахад урьдчилгаа сэргэнэ; акт давхардахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(
    await tool("create_arap_invoice", {
      documentType: "ar_invoice",
      counterparty: "Номин Худалдан авагч",
      date: "2026-09-10",
      description: "Бараа нийлүүлэлт",
      lines: [{ account: "51100000", amount: 1_000_000, description: "Борлуулалт" }],
    })
  );
  const invoice = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.documentType, "ar_invoice")),
  });
  assert.ok(invoice);
  assert.equal(invoice.status, "posted");

  const applied = ok(await tool("apply_advance_to_invoice", { invoice: invoice.documentNo, date: "2026-09-10" })).resultText;
  assert.match(applied, /1,000,000₮/);
  const after = await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, invoice.id) });
  assert.equal(after?.status, "paid");
  const advances = ok(await tool("get_counterparty_advances", { counterparty: "Номин" }, "draft")).resultText;
  assert.match(advances, /Урьдчилж орсон орлого: үлдэгдэл 100,000₮/);

  const application = await db.query.arapAdvanceApplications.findFirst({
    where: eq(arapAdvanceApplications.documentId, invoice.id),
  });
  assert.ok(application);
  const lines = await db.query.journalLines.findMany({ where: eq(journalLines.voucherId, application.voucherId) });
  assert.deepEqual(
    lines.map((line) => [main(line.accountNumber), Number(line.debit), Number(line.credit)]).sort(),
    [["13110000", 0, 1_000_000], ["31300001", 1_000_000, 0]]
  );

  // Акт: урьдчилгаа −1,100,000 + нэхэмжлэх +1,000,000 = −100,000 (суутгал давхар хасагдахгүй).
  const statement = await asOrg(() =>
    loadCounterpartyStatement(orgId, invoice.counterpartyId, "2026-09-01", "2026-09-30")
  );
  assert.equal(statement?.closing, -100_000);

  // Хэтрүүлж суутгахгүй.
  ok(
    await tool("create_arap_invoice", {
      documentType: "ar_invoice",
      counterparty: "Номин Худалдан авагч",
      date: "2026-09-11",
      description: "Нэмэлт",
      lines: [{ account: "51100000", amount: 300_000, description: "Борлуулалт" }],
    })
  );
  const second = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.description, "Нэмэлт")),
  });
  const over = await tool("apply_advance_to_invoice", { invoice: second!.documentNo, amount: 200_000, date: "2026-09-11" });
  assert.match(over.resultText, /урьдчилгааны үлдэгдлээс/);

  // Буцаалт: суутгал устаж урьдчилгаа 1,100,000 болно, нэхэмжлэх нээлттэй.
  const reversed = await asOrg(() => reverseArApOffset(application.voucherId));
  assert.ok(!reversed.error, reversed.error);
  const reopened = await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, invoice.id) });
  assert.equal(reopened?.status, "posted");
  const restored = await asOrg(() => loadAdvanceBalances(orgId, { side: "customer" }));
  assert.equal(restored[0]?.balance, 1_100_000);
});

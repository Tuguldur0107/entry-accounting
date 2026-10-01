// Банкны хуулгын мөрийн бүртгэлийн төрөл (docs/dev/arap.md §5l) — DB урсгал:
// урьдчилж орсон орлого / урьдчилж төлсөн / авлага үүсгэж борлуулалтад /
// өглөг үүсгэж зардалд (НӨАТ-тэй),
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
  arApSettlements,
  arapAdvanceApplications,
  bankStatements,
  cashDocuments,
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

test("import_bank_statement: авлага үүсгэж борлуулалтад (НӨАТ) — нэхэмжлэх үүсэж тэр даруй хаагдана", { skip: !DB_READY }, async () => {
  await setupOrg();
  const text = ok(
    await tool("import_bank_statement", {
      cashAccount: "Голомт банк",
      statementRef: `bra-${STAMP}-sale`,
      rows: [
        { date: "2026-09-06", description: "Бэлэн борлуулалт", counterparty: "Номин Худалдан авагч", income: 220_000, counterGlAccount: "51100000", rowAction: "create_ar_invoice" },
      ],
    })
  ).resultText;
  assert.match(text, /1 борлуулалтын нэхэмжлэх үүсэж тэр даруй хаагдсан/);

  // Нэхэмжлэх: батлагдсан, бүтэн хаагдсан; Dr авлага 220,000 / Cr орлого 200,000 + Cr НӨАТ 20,000.
  const sale = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.description, "Бэлэн борлуулалт")),
  });
  assert.ok(sale);
  assert.equal(sale.documentType, "ar_invoice");
  assert.equal(sale.status, "paid");
  assert.equal(Number(sale.paidAmount), 220_000);
  assert.equal(sale.counterpartyId, await counterpartyId("Номин Худалдан авагч"));
  const saleLines = await db.query.arApDocumentLines.findMany({ where: eq(arApDocumentLines.documentId, sale.id) });
  assert.deepEqual(saleLines.map((line) => [main(line.accountNumber), Number(line.amount)]).sort(), [
    ["31410000", 20_000],
    ["51100000", 200_000],
  ]);
  const invoiceLines = await db.query.journalLines.findMany({ where: eq(journalLines.voucherId, sale.voucherId!) });
  assert.deepEqual(
    invoiceLines.map((line) => [main(line.accountNumber), Number(line.debit), Number(line.credit)]).sort(),
    [[sale.controlAccountNumber, 220_000, 0], ["31410000", 0, 20_000], ["51100000", 0, 200_000]].sort()
  );

  // Банкны мөр нэхэмжлэхийг хаана: Dr банк / Cr авлага — авлагын үлдэгдэл 0.
  const settlement = await db.query.arApSettlements.findFirst({
    where: and(eq(arApSettlements.organizationId, orgId), eq(arApSettlements.documentId, sale.id)),
  });
  assert.ok(settlement);
  const receipt = await db.query.cashDocuments.findFirst({ where: eq(cashDocuments.id, settlement.cashDocumentId!) });
  assert.equal(receipt?.arApDocumentId, sale.id);
  const receiptLines = await db.query.journalLines.findMany({ where: eq(journalLines.voucherId, receipt!.voucherId!) });
  assert.deepEqual(
    receiptLines.map((line) => [main(line.accountNumber), Number(line.debit), Number(line.credit)]).sort(),
    [["11000001", 220_000, 0], [sale.controlAccountNumber, 0, 220_000]].sort()
  );

  // Харьцах дансны санал (suggestions endpoint) = энэ харилцагчийн сүүлийн орлогын данс.
  const { GET } = await import("../app/api/cash/statements/suggestions/route");
  const contextData = await asOrg(async () => (await GET()).json());
  assert.equal(contextData.invoiceAccountHints.ar[await counterpartyId("Номин Худалдан авагч")], "51100000");

  // Нийлүүлэгч төрлийн харилцагчид борлуулалт бичигдэхгүй.
  const wrongParty = await tool("import_bank_statement", {
    cashAccount: "Голомт банк",
    statementRef: `bra-${STAMP}-sale-bad`,
    rows: [{ date: "2026-09-06", counterparty: "Түрээслүүлэгч ХХК", income: 1_000, counterGlAccount: "51100000", rowAction: "create_ar_invoice" }],
  });
  assert.match(wrongParty.resultText, /^Алдаа/);
  // Харьцах тал нь авлага өөрөө байж болохгүй (орлогын данс заавал).
  const controlCounter = await tool("import_bank_statement", {
    cashAccount: "Голомт банк",
    statementRef: `bra-${STAMP}-sale-bad2`,
    rows: [{ date: "2026-09-06", counterparty: "Номин Худалдан авагч", income: 1_000, counterGlAccount: sale.controlAccountNumber, rowAction: "create_ar_invoice" }],
  });
  assert.match(controlCounter.resultText, /орлогын данс байх ёстой/);
});

test("өглөг үүсгэх: харилцагчийн картын данс бүтэн сегмент кодоор хадгалагдсан ч хяналтын данс танигдана", { skip: !DB_READY }, async () => {
  await setupOrg();
  // Вэбийн CounterpartyDialog данс сонгогч нь бүтэн 10 хэсэгт код хадгалдаг.
  ok(await tool("create_counterparty", { name: "Сегмент Нийлүүлэгч", counterpartyType: "supplier" }, "draft"));
  await db
    .update(counterparties)
    .set({ defaultPayableAccountNumber: "000.000000.31000001.00.0000" })
    .where(and(eq(counterparties.organizationId, orgId), eq(counterparties.name, "Сегмент Нийлүүлэгч")));
  ok(
    await tool("import_bank_statement", {
      cashAccount: "Голомт банк",
      statementRef: `bra-${STAMP}-segment-control`,
      rows: [{ date: "2026-09-07", description: "Шимтгэл", counterparty: "Сегмент Нийлүүлэгч", expense: 1_100, counterGlAccount: "73100001", rowAction: "create_ap_bill" }],
    })
  );
  const bill = await db.query.arApDocuments.findFirst({
    where: and(
      eq(arApDocuments.organizationId, orgId),
      eq(arApDocuments.counterpartyId, await counterpartyId("Сегмент Нийлүүлэгч"))
    ),
  });
  assert.ok(bill);
  assert.equal(main(bill.controlAccountNumber), "31000001");
  assert.equal(bill.status, "paid");
});

test("preview: батлахаас өмнөх бичилт — ноорог горимд ч ажиллаж, ЮУ Ч бичихгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const countOf = async () => ({
    statements: (await db.query.bankStatements.findMany({ where: eq(bankStatements.organizationId, orgId) })).length,
    invoices: (await db.query.arApDocuments.findMany({ where: eq(arApDocuments.organizationId, orgId) })).length,
    cash: (await db.query.cashDocuments.findMany({ where: eq(cashDocuments.organizationId, orgId) })).length,
  });
  const before = await countOf();
  const preview = ok(
    await tool(
      "import_bank_statement",
      {
        cashAccount: "Голомт банк",
        statementRef: `bra-${STAMP}-preview`,
        preview: true,
        rows: [
          { date: "2026-09-08", description: "Түрээс", counterparty: "Түрээслүүлэгч ХХК", expense: 220, counterGlAccount: "73100001", rowAction: "create_ap_bill" },
          { date: "2026-09-08", description: "Хүү", income: 30, counterGlAccount: "51100000" },
        ],
      },
      "draft"
    )
  ).resultText;
  assert.match(preview, /УРЬДЧИЛЖ ХАРАХ — юу ч бичигдээгүй\. 2 мөр → 3 журнал/);
  assert.match(preview, /тэнцсэн/);
  assert.match(preview, /Давхар бичилттэй мөр \(1\)/);
  assert.match(preview, /31000001 .* Дт 220 \/ Кт 220$/m);
  assert.match(preview, /13620000 .* Дт 20 \/ Кт 0$/m);
  assert.deepEqual(await countOf(), before);
  // Урьдчилж харсны дараа жинхэнэ импорт ердийнхөөрөө (дугаарын тоолуур, hash хөндөгдөөгүй).
  ok(
    await tool("import_bank_statement", {
      cashAccount: "Голомт банк",
      statementRef: `bra-${STAMP}-preview`,
      rows: [
        { date: "2026-09-08", description: "Түрээс", counterparty: "Түрээслүүлэгч ХХК", expense: 220, counterGlAccount: "73100001", rowAction: "create_ap_bill" },
        { date: "2026-09-08", description: "Хүү", income: 30, counterGlAccount: "51100000" },
      ],
    })
  );
  const after = await countOf();
  assert.deepEqual([after.statements - before.statements, after.invoices - before.invoices, after.cash - before.cash], [1, 1, 2]);
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
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.description, "Бараа нийлүүлэлт")),
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

test("хадгалаагүй хуулгын ноорог: хэрэглэгч бүрд НЭГ, upsert, устгал; өөр байгууллагын данс хориотой", { skip: !DB_READY }, async () => {
  await setupOrg();
  const { deleteStatementDraft, loadStatementDraft, saveStatementDraft } = await import("../lib/cash/statement-draft");
  const account = await db.query.cashAccounts.findFirst({
    where: (table, { and: both, eq: equals }) => both(equals(table.organizationId, orgId), equals(table.name, "Голомт банк")),
    columns: { id: true },
  });
  assert.ok(account);
  const row = {
    id: "r1", rowNumber: 1, transactionDate: "2026-09-20", description: "Түрээс", counterparty: "Түрээслүүлэгч ХХК",
    counterAccount: "", income: 0, expense: 50_000, exchangeRate: 1, baseAmount: 50_000,
    debitAccountNumber: "", creditAccountNumber: "", rowAction: "prepaid_paid" as const, rawData: {},
  };
  const statement = { fileName: "test.csv", fileHash: "h", bankName: "Голомт", periodStart: "2026-09-20", periodEnd: "2026-09-20", rows: [row] };
  await saveStatementDraft({ orgId, userId, cashAccountId: account.id, statement, rows: [row] });
  await saveStatementDraft({ orgId, userId, cashAccountId: account.id, statement, rows: [{ ...row, description: "Түрээс (засвар)" }] });
  const loaded = await loadStatementDraft(orgId, userId);
  assert.equal(loaded?.rows.length, 1);
  assert.equal(loaded?.rows[0].description, "Түрээс (засвар)");
  assert.equal(loaded?.rows[0].rowAction, "prepaid_paid");
  assert.deepEqual(loaded?.statement.rows, []); // эх мөрүүдийг давхар хадгалахгүй
  await assert.rejects(
    saveStatementDraft({ orgId, userId, cashAccountId: "00000000-0000-0000-0000-000000000000", statement, rows: [row] }),
    /банкны данс олдсонгүй/
  );
  await deleteStatementDraft(orgId, userId);
  assert.equal(await loadStatementDraft(orgId, userId), null);
});

// Тооцоо нийлсэн акт + цуглуулалтын самбар (lib/arap/statement-db.ts,
// collections-db.ts) — DB урсгал: АР + АП нэг харилцагчаар, эхний үлдэгдэл,
// төлбөр, урьдчилгаа (нэхэмжлэхгүй мөнгө), PDF; DSO, цуглуулалт, хүлээгдэж буй
// орлого. DATABASE_URL байхгүй бол алгасна.

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

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { loadCollectionsOverview } from "../lib/arap/collections-db";
import { loadCounterpartyStatement } from "../lib/arap/statement-db";
import { db } from "../lib/db";
import { arApDocuments, counterparties, memberships, organizationProfile, organizations, users } from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";
import { renderStatementPdf } from "../lib/pdf/statement-pdf";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, input: unknown) => asOrg(() => executeAiTool(userId, name, input, "post"));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result;
}
const partner = `Түнш ${STAMP}`;

async function document(ref: string, documentType: "ar_invoice" | "ap_bill", date: string, dueDate: string, amount: number) {
  ok(
    await tool("create_arap_invoice", {
      documentType,
      counterparty: partner,
      date,
      dueDate,
      description: ref,
      externalRef: `${ref}-${STAMP}`,
      lines: [{ account: documentType === "ar_invoice" ? "51100000" : "70000001", amount }],
    })
  );
  const doc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `${ref}-${STAMP}`)),
  });
  assert.equal(doc?.status, "posted", ref);
  return doc!;
}

test("Тооцоо нийлсэн акт ба цуглуулалтын самбар", { skip: !DB_READY }, async () => {
  const [user] = await db
    .insert(users)
    .values({ name: `st-${STAMP}`, email: `st-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `Statement ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  userId = user.id;
  orgId = org.id;
  try {
    await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `Statement ${STAMP}` });
    const sync = await asOrg(() => syncStandardAccounts());
    assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
    ok(await tool("create_cash_account", { name: "Голомт", accountType: "bank", currency: "MNT", glAccount: "11000001" }));
    ok(await tool("create_counterparty", { name: partner, counterpartyType: "both" }));
    const counterparty = await db.query.counterparties.findFirst({
      where: and(eq(counterparties.organizationId, orgId), eq(counterparties.name, partner)),
    });
    assert.ok(counterparty);

    // 8-р сар: 1,000,000 нэхэмжлэх, 400,000 төлбөр → 9-р сарын эхний үлдэгдэл 600,000.
    const first = await document("inv-aug", "ar_invoice", "2026-08-10", "2026-08-31", 1_000_000);
    ok(await tool("pay_arap_document", { documentId: first.documentNo, cashAccount: "Голомт", date: "2026-08-20", amount: 400_000 }));
    // 9-р сар: 500,000 нэхэмжлэх, эхнийхийн үлдэгдэл 600,000 төлөгдөнө, 150,000 худалдан авалт.
    const second = await document("inv-sep", "ar_invoice", "2026-09-05", "2026-10-01", 500_000);
    ok(await tool("pay_arap_document", { documentId: first.documentNo, cashAccount: "Голомт", date: "2026-09-05", amount: 600_000 }));
    await document("bill-sep", "ap_bill", "2026-09-12", "2026-09-30", 150_000);
    // Нэхэмжлэхгүй урьдчилгаа (хяналтын дансанд, харилцагчтай) — 9-р сарын 25.
    ok(
      await tool("create_cash_transaction", {
        documentType: "receipt",
        cashAccount: "Голомт",
        date: "2026-09-25",
        amount: 50_000,
        counterAccount: first.controlAccountNumber,
        counterparty: partner,
        description: "Урьдчилгаа",
      })
    );

    const statement = await loadCounterpartyStatement(orgId, counterparty.id, "2026-09-01", "2026-09-30");
    assert.ok(statement);
    assert.equal(statement.opening, 600_000);
    assert.deepEqual(
      statement.rows.map((row) => [row.date, row.debit, row.credit, row.balance]),
      [
        ["2026-09-05", 500_000, 0, 1_100_000],
        ["2026-09-05", 0, 600_000, 500_000],
        ["2026-09-12", 0, 150_000, 350_000],
        ["2026-09-25", 0, 50_000, 300_000],
      ]
    );
    assert.deepEqual([statement.totalDebit, statement.totalCredit, statement.closing], [500_000, 800_000, 300_000]);
    assert.match(statement.conclusion, new RegExp(`${partner} нь .* 300,000\\.00₮ төлөх`));
    const pdf = await renderStatementPdf(statement);
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");

    // Самбар: авлага 500,000 (2-р нэхэмжлэх), 90 хоногт 1.5 сая борлуулалт → DSO 30.
    const overview = await loadCollectionsOverview(orgId, "2026-09-28");
    assert.equal(overview.receivable, 500_000);
    assert.equal(overview.dso, 30);
    assert.deepEqual([overview.collectedThisMonth, overview.collectedLastMonth], [600_000, 400_000]);
    assert.deepEqual([overview.expected.next7, overview.expected.overdue], [500_000, 0]);
    assert.deepEqual(overview.topOverdue, []);
    assert.equal(second.status, "posted");
  } finally {
    await purgeOrganization(orgId);
    await db.delete(users).where(eq(users.id, userId));
  }
});

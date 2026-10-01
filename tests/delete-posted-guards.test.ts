// Батлагдсан баримтын устгалт (product owner 2026-10-01): тайлант үе НЭЭЛТТЭЙ үед
// батлагдсан АР/АП нэхэмжлэх, кассын баримтыг GL журналтай нь устгаж БОЛНО
// (аудитын мөр үлдэнэ), хаалттай үед ҮГҮЙ. Хоёр үл хамаарал:
//   • eBarimt-д (ТЕГ) бүртгэгдсэн / илгээгдэж буй нэхэмжлэх — ТЕГ-д баримт үлдэж
//     НӨАТ чимээгүй зөрнө → кредит нэхэмжлэлээр буцаана
//   • QPay-ээр орсон төлбөрийн кассын баримт — мөнгө баримтгүй үлдэнэ
// DATABASE_URL шаарддаг; түр байгууллага бодит устгалтын замаар устгагдана.

import "./helpers/load-env";

import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд okOrRevalidate fallback ажиллана
}

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { deleteArApDocument } from "../lib/actions/arap";
import { deleteCashDocument } from "../lib/actions/cash";
import { deleteOrganizationForUser } from "../lib/actions/org";
import { db } from "../lib/db";
import {
  accountingPeriods,
  arApDocuments,
  auditEvents,
  cashDocuments,
  journalVouchers,
  memberships,
  organizations,
  posEbarimtSubmissions,
  posQpayIntents,
  users,
} from "../lib/db/schema";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const cleanup: (() => Promise<void>)[] = [];

let userId = "";
let orgId = "";

function okOrRevalidate(resultText: string): boolean {
  return !resultText.startsWith("Алдаа") || resultText.includes("static generation store");
}

function tool(name: string, input: unknown) {
  return runAsOrg({ userId, orgId }, () => executeAiTool(userId, name, input, "post"));
}

function asOrg<T>(fn: () => Promise<T>) {
  return runAsOrg({ userId, orgId }, fn);
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `del-${STAMP}`, email: `del-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `Устгалт ${STAMP}` })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    const current = await db.query.organizations.findFirst({
      where: eq(organizations.id, org.id),
      columns: { name: true },
    });
    assert.ok(current);
    await deleteOrganizationForUser({ orgId: org.id, userId: user.id, confirmName: current.name });
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
  const account = await tool("create_cash_account", { name: "Банк", accountType: "bank", currency: "MNT", glAccount: "11000001" });
  assert.ok(okOrRevalidate(account.resultText), account.resultText);
  const partner = await tool("create_counterparty", { name: "Харилцагч", counterpartyType: "both" });
  assert.ok(okOrRevalidate(partner.resultText), partner.resultText);
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function postedInvoice(ref: string, date: string) {
  const created = await tool("create_arap_invoice", {
    documentType: "ar_invoice",
    counterparty: "Харилцагч",
    date,
    dueDate: date,
    description: ref,
    externalRef: `${ref}-${STAMP}`,
    lines: [{ account: "51100000", amount: 110_000 }],
  });
  assert.ok(okOrRevalidate(created.resultText), created.resultText);
  const doc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `${ref}-${STAMP}`)),
  });
  assert.equal(doc?.status, "posted", ref);
  assert.ok(doc?.voucherId);
  return doc!;
}

async function postedReceipt(ref: string, date: string) {
  const created = await tool("create_cash_transaction", {
    documentType: "receipt",
    cashAccount: "Банк",
    date,
    amount: 50_000,
    counterAccount: "51100000",
    description: ref,
    externalRef: `${ref}-${STAMP}`,
  });
  assert.ok(okOrRevalidate(created.resultText), created.resultText);
  const doc = await db.query.cashDocuments.findFirst({
    where: and(eq(cashDocuments.organizationId, orgId), eq(cashDocuments.externalRef, `${ref}-${STAMP}`)),
  });
  assert.equal(doc?.status, "posted", ref);
  assert.ok(doc?.voucherId);
  return doc!;
}

const voucherExists = async (id: string) =>
  !!(await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, id), columns: { id: true } }));

test("Нээлттэй үед батлагдсан нэхэмжлэх GL журналтайгаа устгагдаж, аудитын мөр үлдэнэ", { skip: !DB_READY }, async () => {
  await setupOrg();
  const doc = await postedInvoice("open-ok", "2025-04-10");
  const result = await asOrg(() => deleteArApDocument(doc.id));
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, doc.id) }), undefined);
  assert.equal(await voucherExists(doc.voucherId!), false, "GL журнал хамт устсан");
  const audit = await db.query.auditEvents.findFirst({
    where: and(eq(auditEvents.organizationId, orgId), eq(auditEvents.entityId, doc.id), eq(auditEvents.action, "delete")),
  });
  assert.match(audit?.summary ?? "", /өмнөх төлөв: posted/);
});

test("Хаалттай үеийн батлагдсан баримт устгагдахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const invoice = await postedInvoice("closed", "2025-02-10");
  const receipt = await postedReceipt("closed-rcpt", "2025-02-12");
  await db.insert(accountingPeriods).values([
    { userId, organizationId: orgId, code: "2025-01", startDate: "2025-01-01", endDate: "2025-01-31", status: "closed" },
    { userId, organizationId: orgId, code: "2025-02", startDate: "2025-02-01", endDate: "2025-02-28", status: "closed" },
  ]);
  const arap = await asOrg(() => deleteArApDocument(invoice.id));
  assert.ok(arap.error, "АР устгагдахгүй");
  const cash = await asOrg(() => deleteCashDocument(receipt.id));
  assert.ok(cash.error, "касс устгагдахгүй");
  assert.ok(await voucherExists(invoice.voucherId!));
  assert.ok(await voucherExists(receipt.voucherId!));
});

test("eBarimt-д бүртгэгдсэн / илгээгдэж буй нэхэмжлэх устгагдахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const sent = await postedInvoice("ebarimt-sent", "2025-04-12");
  await db.update(arApDocuments).set({ ebarimtStatus: "sent", ebarimtId: `DDTD-${STAMP}` }).where(eq(arApDocuments.id, sent.id));
  const blocked = await asOrg(() => deleteArApDocument(sent.id));
  assert.match(blocked.error ?? "", /\[EBARIMT_REGISTERED\]/, JSON.stringify(blocked));
  assert.ok(await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, sent.id) }), "баримт хэвээр");
  assert.ok(await voucherExists(sent.voucherId!), "GL хэвээр");

  const inFlight = await postedInvoice("ebarimt-claimed", "2025-04-13");
  await db.insert(posEbarimtSubmissions).values({ organizationId: orgId, arapDocumentId: inFlight.id, kind: "send", status: "claimed" });
  const claimed = await asOrg(() => deleteArApDocument(inFlight.id));
  assert.match(claimed.error ?? "", /илгээгдэж байна/, JSON.stringify(claimed));

  // Илгээгээгүй (дараалалд хүлээгдэж буй) нэхэмжлэх устгагдана — дараалал хамт цэвэрлэгдэнэ
  const pending = await postedInvoice("ebarimt-pending", "2025-04-14");
  await db.insert(posEbarimtSubmissions).values({ organizationId: orgId, arapDocumentId: pending.id, kind: "send", status: "pending" });
  const removed = await asOrg(() => deleteArApDocument(pending.id));
  assert.equal(removed.error, undefined, JSON.stringify(removed));
});

test("QPay-ээр орсон төлбөрийн кассын баримт устгагдахгүй, бусад нь устгагдана", { skip: !DB_READY }, async () => {
  await setupOrg();
  const settled = await postedReceipt("qpay-settled", "2025-04-15");
  await db.insert(posQpayIntents).values({
    organizationId: orgId,
    amount: "50000",
    cartSnapshot: {},
    status: "finalized",
    purpose: "arap",
    cashDocumentId: settled.id,
    expiresAt: new Date(),
  });
  const blocked = await asOrg(() => deleteCashDocument(settled.id));
  assert.match(blocked.error ?? "", /\[QPAY_SETTLEMENT\]/, JSON.stringify(blocked));
  assert.ok(await db.query.cashDocuments.findFirst({ where: eq(cashDocuments.id, settled.id) }), "баримт хэвээр");
  assert.ok(await voucherExists(settled.voucherId!), "GL хэвээр");

  const plain = await postedReceipt("plain", "2025-04-16");
  const removed = await asOrg(() => deleteCashDocument(plain.id));
  assert.equal(removed.error, undefined, JSON.stringify(removed));
  assert.equal(await voucherExists(plain.voucherId!), false, "GL журнал хамт устсан");
});

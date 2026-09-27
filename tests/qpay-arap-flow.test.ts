// Нэхэмжлэхийн линкээр QPay-ээр төлөх (lib/qpay/arap.ts) — төлөгдсөн intent нь
// орлогын баримт болж (Dt QPay түр данс / Кт авлагын хяналтын данс) нэхэмжлэхийг
// хаана; дахин дуудахад (webhook + [Шалгах]) давхар орлого үүсэхгүй; үлдэгдлээс
// их төлбөр нэхэмжлэхэд бүртгэгдэхгүй — paid хэвээр, ил алдаатай («Буцаах»).
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

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { db } from "../lib/db";
import {
  arApDocuments,
  cashDocuments,
  journalLines,
  journalVouchers,
  memberships,
  organizationProfile,
  organizations,
  posQpayIntents,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";
import { QPAY_ARAP_PURPOSE, settleArapIntent } from "../lib/qpay/arap";
import { markIntentPaid } from "../lib/qpay/store";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, input: unknown, mode: "draft" | "post" = "draft") =>
  asOrg(() => executeAiTool(userId, name, input, mode));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result;
}
const main = (code: string) =>
  code.split(".").length === 10 ? code.split(".")[2] : code;

async function invoice(ref: string, amount: number) {
  ok(
    await tool(
      "create_arap_invoice",
      {
        documentType: "ar_invoice",
        counterparty: `Бат ${STAMP}`,
        date: "2026-09-01",
        dueDate: "2026-09-30",
        description: `QPay линк ${ref}`,
        externalRef: `${ref}-${STAMP}`,
        lines: [{ account: "51100000", amount }],
      },
      "post",
    ),
  );
  const doc = await db.query.arApDocuments.findFirst({
    where: and(
      eq(arApDocuments.organizationId, orgId),
      eq(arApDocuments.externalRef, `${ref}-${STAMP}`),
    ),
  });
  assert.equal(doc?.status, "posted");
  return doc!;
}

async function intentFor(documentId: string, amount: number) {
  const [row] = await db
    .insert(posQpayIntents)
    .values({
      organizationId: orgId,
      purpose: QPAY_ARAP_PURPOSE,
      arApDocumentId: documentId,
      amount: String(amount),
      cartSnapshot: { arApDocumentId: documentId },
      status: "open",
      qpayInvoiceId: `inv-${Math.random().toString(36).slice(2, 8)}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    .returning({ id: posQpayIntents.id });
  return row.id;
}

const pay = (intentId: string, paidAmount: number) =>
  markIntentPaid(orgId, intentId, {
    paidAmount,
    paymentId: `pay-${intentId.slice(0, 6)}`,
    paidAt: new Date(),
    source: "webhook",
  });

test(
  "Нэхэмжлэхийн QPay: орлогын баримт → нэхэмжлэх төлөгдөнө, давхар үгүй, илүү төлбөр бүртгэгдэхгүй",
  { skip: !DB_READY },
  async () => {
    const [user] = await db
      .insert(users)
      .values({
        name: `qa-${STAMP}`,
        email: `qa-${STAMP}@test.local`,
        passwordHash: "x",
      })
      .returning({ id: users.id });
    const [org] = await db
      .insert(organizations)
      .values({ name: `QPay arap ${STAMP}` })
      .returning({ id: organizations.id });
    await db
      .insert(memberships)
      .values({ organizationId: org.id, userId: user.id, role: "owner" });
    userId = user.id;
    orgId = org.id;
    try {
      await db
        .insert(organizationProfile)
        .values({ userId, organizationId: orgId, name: `QPay arap ${STAMP}` });
      const sync = await asOrg(() => syncStandardAccounts());
      assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
      ok(
        await tool("create_cash_account", {
          name: "QPay түр данс",
          accountType: "bank",
          currency: "MNT",
          glAccount: "11000099",
        }),
      );
      ok(
        await tool("save_pos_payment_method", {
          code: "QPAY",
          name: "QPay",
          kind: "ewallet",
          cashAccount: "QPay түр данс",
          provider: "qpay",
          feePercent: 1,
        }),
      );
      ok(
        await tool("create_counterparty", {
          name: `Бат ${STAMP}`,
          counterpartyType: "customer",
        }),
      );

      // 1) Бүтэн үлдэгдлээр төлөгдөнө → орлогын баримт, нэхэмжлэх paid.
      const doc = await invoice("a", 330_000);
      const intentId = await intentFor(doc.id, 330_000);
      const marked = await pay(intentId, 330_000);
      assert.equal(marked.status, "paid");
      assert.deepEqual(await settleArapIntent(orgId, intentId), { ok: true });

      const intent = await db.query.posQpayIntents.findFirst({
        where: eq(posQpayIntents.id, intentId),
      });
      assert.equal(intent?.status, "finalized");
      assert.ok(intent?.cashDocumentId);
      const cash = await db.query.cashDocuments.findFirst({
        where: eq(cashDocuments.id, intent.cashDocumentId),
      });
      assert.ok(cash);
      assert.deepEqual(
        [
          cash.documentType,
          cash.status,
          cash.arApDocumentId,
          Number(cash.amount),
          cash.externalRef,
        ],
        ["receipt", "posted", doc.id, 330_000, `qpay-arap:${intentId}`],
      );
      const after = await db.query.arApDocuments.findFirst({
        where: eq(arApDocuments.id, doc.id),
      });
      assert.equal(after?.status, "paid");
      assert.equal(Number(after?.paidAmount), 330_000);

      // Журнал: Dt QPay түр данс / Кт авлагын хяналтын данс, тэнцвэртэй.
      assert.ok(cash.voucherId, "орлогын журнал");
      const voucher = await db.query.journalVouchers.findFirst({
        where: eq(journalVouchers.id, cash.voucherId),
      });
      assert.equal(voucher?.status, "posted");
      assert.ok(voucher);
      const lines = await db
        .select()
        .from(journalLines)
        .where(eq(journalLines.voucherId, voucher.id));
      const side = (account: string, key: "debit" | "credit") =>
        lines
          .filter((line) => main(line.accountNumber) === account)
          .reduce((sum, line) => sum + Number(line[key]), 0);
      assert.equal(side("11000099", "debit"), 330_000);
      assert.equal(side(main(doc.controlAccountNumber), "credit"), 330_000);

      // 2) Давтан (webhook + [Шалгах]) — давхар орлого үгүй.
      assert.deepEqual(await settleArapIntent(orgId, intentId), { ok: true });
      const receipts = await db.query.cashDocuments.findMany({
        where: and(
          eq(cashDocuments.organizationId, orgId),
          eq(cashDocuments.arApDocumentId, doc.id),
        ),
      });
      assert.equal(receipts.length, 1);

      // 3) Өөр замаар төлсний дараа ирсэн QPay — нэхэмжлэхэд бүртгэхгүй, paid + алдаа.
      const late = await intentFor(doc.id, 330_000);
      await pay(late, 330_000);
      const overpaid = await settleArapIntent(orgId, late);
      assert.equal(overpaid.ok, false);
      assert.match(overpaid.reason ?? "", /QPAY_ARAP_OVERPAID/);
      const lateRow = await db.query.posQpayIntents.findFirst({
        where: eq(posQpayIntents.id, late),
      });
      assert.equal(lateRow?.status, "paid");
      assert.match(lateRow?.lastError ?? "", /QPAY_ARAP_OVERPAID/);
      assert.equal(lateRow?.cashDocumentId, null);
    } finally {
      await purgeOrganization(orgId);
      await db.delete(users).where(eq(users.id, userId));
    }
  },
);

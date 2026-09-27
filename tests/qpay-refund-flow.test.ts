// QPay-д орсон мөнгийг харилцагчид буцаах (lib/qpay/refund.ts) — журнал ба
// мөнгөн баримт ҮРГЭЛЖ хамт, тэнцвэртэй: Dt QPay түр данс / Кт касс | банк |
// дэлгүүрийн кредитийн өглөг; кассаас бэлнээр бол ээлжийн бэлэн мөнгөнд
// тооцогдоно; давхар буцаалт / мөнгөгүй intent татгалзана. DATABASE_URL
// байхгүй бол алгасна (CI-ийн DB алхамд ажиллана).

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
import { loadEwalletSettlementContext } from "../lib/cash/ewallet-settlement-data";
import { db } from "../lib/db";
import {
  cashAccounts,
  cashDocuments,
  journalLines,
  journalVouchers,
  memberships,
  organizationProfile,
  organizations,
  posQpayIntents,
  posShifts,
  posStoreCredits,
  users,
  warehouses,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";
import { loadShiftViews } from "../lib/pos/load-data";
import { refundQpayIntentCore } from "../lib/qpay/refund";

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
const main = (code: string) => (code.split(".").length === 10 ? code.split(".")[2] : code);

async function accountId(name: string) {
  const row = await db.query.cashAccounts.findFirst({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.name, name)),
    columns: { id: true },
  });
  assert.ok(row, name);
  return row.id;
}

async function voucherOf(intentId: string) {
  const voucher = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.externalRef, `qpay-refund:${intentId}`)),
  });
  assert.ok(voucher, "буцаалтын журнал");
  assert.equal(voucher.status, "posted");
  assert.match(voucher.documentNo ?? "", /^CM-\d{2}-\d{6}$/);
  const lines = await db.select().from(journalLines).where(eq(journalLines.voucherId, voucher.id));
  const debit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.credit), 0);
  assert.ok(Math.abs(debit - credit) < 0.005, `Дт ${debit} ≠ Кт ${credit}`);
  for (const line of lines) {
    assert.equal(line.businessObjectType, "pos_qpay_intent");
    assert.equal(line.businessObjectId, intentId);
  }
  const side = (account: string, key: "debit" | "credit") =>
    lines.filter((line) => main(line.accountNumber) === account).reduce((sum, line) => sum + Number(line[key]), 0);
  return { side };
}

test("QPay буцаалт: касс / банк / кредит — журнал + мөнгөн баримт, ээлжийн бэлэн, давхар хориг", { skip: !DB_READY }, async () => {
  const [user] = await db
    .insert(users)
    .values({ name: `qr-${STAMP}`, email: `qr-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `QPay refund ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  userId = user.id;
  orgId = org.id;
  try {
    await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `QPay refund ${STAMP}` });
    const sync = await asOrg(() => syncStandardAccounts());
    assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
    ok(await tool("create_cash_account", { name: "Касс", accountType: "cash", currency: "MNT", glAccount: "10000001" }));
    ok(await tool("create_cash_account", { name: "Голомт банк", accountType: "bank", currency: "MNT", glAccount: "11000001" }));
    ok(await tool("create_cash_account", { name: "QPay түр данс", accountType: "bank", currency: "MNT", glAccount: "11000099" }));
    ok(
      await tool("save_pos_payment_method", {
        code: "QPAY", name: "QPay", kind: "ewallet", cashAccount: "QPay түр данс", provider: "qpay", feePercent: 1,
      })
    );
    ok(await tool("create_warehouse", { code: "WH1", name: "Төв дэлгүүр" }));
    ok(await tool("create_counterparty", { name: `Бат ${STAMP}`, counterpartyType: "customer" }));
    ok(await tool("open_pos_shift", { cashAccount: "Касс", warehouseCode: "WH1", openingFloat: 50_000 }));

    const shift = await db.query.posShifts.findFirst({ where: eq(posShifts.organizationId, orgId) });
    const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.organizationId, orgId) });
    assert.ok(shift && warehouse);
    const cashId = await accountId("Касс");
    const bankId = await accountId("Голомт банк");
    const qpayId = await accountId("QPay түр данс");

    const intent = async (status: string, extra: Partial<typeof posQpayIntents.$inferInsert> = {}) => {
      const [row] = await db
        .insert(posQpayIntents)
        .values({
          organizationId: orgId,
          shiftId: shift.id,
          cashierUserId: userId,
          amount: "4200",
          cartSnapshot: { shiftId: shift.id, warehouseId: warehouse.id, lines: [] },
          status,
          qpayInvoiceId: `inv-${status}-${Math.random().toString(36).slice(2, 8)}`,
          expiresAt: new Date(),
          paidAt: new Date(),
          paidAmount: "4200",
          paymentId: "pay",
          ...extra,
        })
        .returning({ id: posQpayIntents.id });
      return row.id;
    };

    // 1) Кассаас бэлнээр — давхар төлбөр (QR хаагдсаны дараа төлсөн).
    const late = await intent("paid");
    await assert.rejects(() => refundQpayIntentCore(orgId, userId, late, { method: "cash", reason: "" }), /шалтгаан/);
    const cash = await refundQpayIntentCore(orgId, userId, late, { method: "cash", reason: "Бэлнээр аль хэдийн зарсан" });
    assert.equal(cash.amount, 4200);
    assert.equal(cash.resolution.shiftId, shift.id);
    const cashVoucher = await voucherOf(late);
    assert.equal(cashVoucher.side("11000099", "debit"), 4200);
    assert.equal(cashVoucher.side("10000001", "credit"), 4200);
    const cashDoc = await db.query.cashDocuments.findFirst({ where: eq(cashDocuments.id, cash.resolution.cashDocumentId) });
    assert.ok(cashDoc);
    assert.deepEqual(
      [cashDoc.documentType, cashDoc.fromCashAccountId, cashDoc.toCashAccountId, cashDoc.status, cashDoc.sourceType],
      ["transfer", cashId, qpayId, "posted", "pos"]
    );
    // Ээлжийн системийн бэлэн: 50,000 − 4,200 буцаалт.
    const [view] = await loadShiftViews(orgId, { openOnly: true });
    assert.equal(view.cashRefunds, 4200);
    // Давтан дарах / өрсөлдөгч — татгалзана, журнал нэг л байна.
    await assert.rejects(
      () => refundQpayIntentCore(orgId, userId, late, { method: "cash", reason: "дахин" }),
      /Буцаах мөнгө алга/
    );
    const row = await db.query.posQpayIntents.findFirst({ where: eq(posQpayIntents.id, late) });
    assert.equal(row?.status, "refunded");

    // 2) Банкаар — дүн зөрсөн (failed + payment), бодит орсон дүнгээр.
    const mismatch = await intent("failed", { paidAmount: "5000", lastError: "[QPAY_AMOUNT_MISMATCH]" });
    const bank = await refundQpayIntentCore(orgId, userId, mismatch, { method: "bank", reason: "Дүн зөрсөн — буцаав", cashAccountId: bankId });
    assert.equal(bank.amount, 5000);
    const bankVoucher = await voucherOf(mismatch);
    assert.equal(bankVoucher.side("11000099", "debit"), 5000);
    assert.equal(bankVoucher.side("11000001", "credit"), 5000);
    const self = await intent("paid");
    await assert.rejects(
      () => refundQpayIntentCore(orgId, userId, self, { method: "bank", reason: "өөр рүүгээ", cashAccountId: qpayId }),
      /өөрөө рүүгээ/
    );

    // 3) Харилцагчийн кредит.
    const credit = await intent("paid");
    const counterparty = await db.query.counterparties.findFirst({
      where: (cp, { eq: eqOp }) => eqOp(cp.organizationId, orgId),
    });
    assert.ok(counterparty);
    await assert.rejects(() => refundQpayIntentCore(orgId, userId, credit, { method: "store_credit", reason: "кредит" }), /харилцагч/i);
    const stored = await refundQpayIntentCore(orgId, userId, credit, { method: "store_credit", reason: "Дараа авна", counterpartyId: counterparty.id });
    const creditVoucher = await voucherOf(credit);
    assert.equal(creditVoucher.side("11000099", "debit"), 4200);
    assert.ok(stored.resolution.storeCreditId);
    const storeCredit = await db.query.posStoreCredits.findFirst({ where: eq(posStoreCredits.id, stored.resolution.storeCreditId!) });
    assert.equal(Number(storeCredit?.balance), 4200);
    assert.equal(storeCredit?.counterpartyId, counterparty.id);

    // Мөнгөгүй (QR үүсээгүй failed) / аль хэдийн борлуулалт болсон → буцаах зүйлгүй.
    const noMoney = await intent("failed", { paidAmount: null, paymentId: null, paidAt: null, qpayInvoiceId: null });
    await assert.rejects(() => refundQpayIntentCore(orgId, userId, noMoney, { method: "cash", reason: "мөнгөгүй" }), /Буцаах мөнгө алга/);

    // Settlement: түр данс руу орсон бүх буцаалт QPay → банк шилжүүлэгт тулгагдах орлого.
    const context = await loadEwalletSettlementContext(orgId);
    const open = context.methods[0]?.openReceipts.map((receipt) => receipt.amount).sort((a, b) => a - b);
    assert.deepEqual(open, [4200, 4200, 5000]);
  } finally {
    await purgeOrganization(orgId);
    await db.delete(users).where(eq(users.id, userId));
  }
});

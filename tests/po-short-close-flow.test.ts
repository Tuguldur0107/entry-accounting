// ENT-064: захиалгын ДУТУУ хаалт — DB integration.
// D-SC-1 (илүү нэхэмжлэл → хэрэглэгчийн сонгосон зардлын данс), D-SC-2
// (хүлээн авснаас илүү нэхэмжлэхэд анхааруулга), D-SC-3 (proc:post +
// шалтгаан заавал, дахин нээхэд сэргэнэ). DATABASE_URL шаарддаг: түр
// байгууллага, төгсгөлд purgeOrganization.

import "./helpers/load-env";

import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
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
import { closePurchaseOrder, reopenPurchaseOrder } from "../lib/actions/procurement";
import { loadCostingAccountSettings } from "../lib/costing/master-data";
import { db } from "../lib/db";
import {
  auditEvents,
  journalLines,
  journalVouchers,
  memberships,
  organizationProfile,
  organizations,
  purchaseOrderLines,
  purchaseOrders,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";
import { loadPurchaseOrderDetail } from "../lib/procurement/load-data";
import { extractMainAccount } from "../lib/reports/balances";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const DATE = "2026-09-10";
const WRITE_OFF = "73100001";
let userId = "";
let orgId = "";
const roles = { clearing: "", apClearing: "" };
const cleanup: (() => Promise<void>)[] = [];

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, input: unknown) =>
  asOrg(() => executeAiTool(userId, name, input, "post"));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result.resultText;
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `psc-${STAMP}`, email: `psc-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `Дутуу хаалт ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId: user.id, organizationId: org.id, name: `Дутуу хаалт ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
  const settings = await loadCostingAccountSettings(orgId, userId);
  roles.clearing = settings.clearingAccountNumber;
  roles.apClearing = settings.apClearingAccountNumber;
  ok(await tool("create_warehouse", { code: "WH1", name: "Төв агуулах" }));
  ok(await tool("create_inventory_item", { code: "SC-A", name: "Дутуу бараа", unit: "ш" }));
  ok(await tool("create_counterparty", { name: `Нийлүүлэгч ${STAMP}`, counterpartyType: "supplier" }));
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

/** PO 20 × 1,000₮ (post горимд шууд нээлттэй) → `received` хүлээн авах → `invoiced` нэхэмжилж батлах. */
async function orderWith(tag: string, received: number, invoiced: number) {
  const ref = `psc-${tag}-${STAMP}`;
  ok(
    await tool("create_purchase_order", {
      supplier: `Нийлүүлэгч ${STAMP}`,
      date: DATE,
      warehouseCode: "WH1",
      description: `Дутуу хаалт ${tag}`,
      documentNo: ref,
      lines: [{ itemCode: "SC-A", quantity: 20, unitPrice: 1_000 }],
    })
  );
  const order = await db.query.purchaseOrders.findFirst({
    where: and(eq(purchaseOrders.organizationId, orgId), eq(purchaseOrders.documentNo, ref)),
  });
  assert.ok(order);
  ok(await tool("create_goods_receipt", { purchaseOrderId: order.id, date: DATE, lines: [{ itemCode: "SC-A", quantity: received }] }));
  const invoiceText = ok(
    await tool("create_ap_invoice_from_po", { purchaseOrderId: order.id, date: DATE, lines: [{ itemCode: "SC-A", quantity: invoiced }] })
  );
  return { id: order.id, documentNo: ref, invoiceText };
}

async function balances(purchaseOrderId: string) {
  const rows = await db
    .select({ accountNumber: journalLines.accountNumber, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalLines.voucherId))
    .where(
      and(
        eq(journalVouchers.organizationId, orgId),
        inArray(journalVouchers.status, ["posted", "reversed"]),
        eq(journalLines.businessObjectType, "purchase_order"),
        eq(journalLines.businessObjectId, purchaseOrderId)
      )
    );
  const result = new Map<string, number>();
  for (const row of rows) {
    const main = extractMainAccount(row.accountNumber);
    result.set(main, Math.round(((result.get(main) ?? 0) + Number(row.debit) - Number(row.credit)) * 100) / 100);
  }
  return result;
}

test("ENT-064: 20 захиалж 12 ирсэн → дутуу хаалт 8 цуцална, түр дансууд 0; дахин нээхэд сэргэнэ", { skip: !DB_READY }, async () => {
  await setupOrg();
  const order = await orderWith("a", 12, 12);
  assert.doesNotMatch(order.invoiceText, /Хүлээн авснаас илүү/);

  const normal = await tool("close_purchase_order", { purchaseOrderId: order.id, closeDate: DATE });
  assert.match(normal.resultText, /PO_NOT_READY/);
  assert.match(normal.resultText, /shortClose: true/, "дутуу хаах замыг санал болгоно");

  const noReason = await asOrg(() => closePurchaseOrder({ id: order.id, closeDate: DATE, shortClose: { reason: " " } }));
  assert.match(noReason.error ?? "", /REASON_REQUIRED/);

  const text = ok(
    await tool("close_purchase_order", {
      purchaseOrderId: order.id,
      closeDate: DATE,
      shortClose: true,
      reason: "Нийлүүлэгч үлдэгдлийг нийлүүлэх боломжгүй",
    })
  );
  assert.match(text, /ДУТУУ ХААГДЛАА/);
  assert.match(text, /8 нэгж цуцлагдав/);

  const closed = await loadPurchaseOrderDetail(orgId, order.id);
  assert.equal(closed?.status, "closed");
  assert.equal(closed?.shortCloseReason, "Нийлүүлэгч үлдэгдлийг нийлүүлэх боломжгүй");
  assert.equal(closed?.lines[0].cancelledQuantity, 8);
  const after = await balances(order.id);
  assert.equal(after.get(roles.clearing) ?? 0, 0);
  assert.equal(after.get(roles.apClearing) ?? 0, 0);
  const audit = await db.query.auditEvents.findFirst({
    where: and(eq(auditEvents.organizationId, orgId), eq(auditEvents.entityId, order.id), eq(auditEvents.action, "close")),
  });
  assert.match(audit?.summary ?? "", /ДУТУУ: цуцалсан 8 нэгж; шалтгаан: Нийлүүлэгч/);

  const reopened = await asOrg(() => reopenPurchaseOrder({ id: order.id }));
  assert.ok(!reopened.error, reopened.error);
  const [line] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, order.id));
  assert.equal(Number(line.cancelledQuantity), 0);
  const reopenedOrder = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, order.id) });
  assert.equal(reopenedOrder?.status, "open");
  assert.equal(reopenedOrder?.shortCloseReason, null);
});

test("ENT-064 D-SC-1/2: илүү нэхэмжлэл анхааруулгатай, дутуу хаалтад сонгосон зардлын дансанд", { skip: !DB_READY }, async () => {
  await setupOrg();
  const order = await orderWith("b", 12, 15);
  assert.match(order.invoiceText, /Хүлээн авснаас илүү нэхэмжилж байна \(SC-A 3\)/);

  const detail = await loadPurchaseOrderDetail(orgId, order.id);
  assert.deepEqual(detail?.shortClose, { blockers: [], cancelledQuantity: 8, writeOffMnt: 3_000 });

  const reason = "Үлдэгдэл ирэхгүй, илүү нэхэмжлэлийг зардалд";
  const missing = await asOrg(() => closePurchaseOrder({ id: order.id, closeDate: DATE, shortClose: { reason } }));
  assert.match(missing.error ?? "", /WRITE_OFF_ACCOUNT_REQUIRED/);
  const revenue = await asOrg(() =>
    closePurchaseOrder({ id: order.id, closeDate: DATE, shortClose: { reason, writeOffAccount: "51100000" } })
  );
  assert.match(revenue.error ?? "", /зардлын данс биш/);

  const closed = await asOrg(() =>
    closePurchaseOrder({ id: order.id, closeDate: DATE, shortClose: { reason, writeOffAccount: WRITE_OFF } })
  );
  assert.ok(!closed.error, closed.error);
  assert.equal(closed.writeOffMnt, 3_000);
  const after = await balances(order.id);
  assert.equal(after.get(roles.clearing) ?? 0, 0);
  assert.equal(after.get(roles.apClearing) ?? 0, 0);
  assert.equal(after.get(WRITE_OFF), 3_000, "илүү нэхэмжлэл зардалд Дт");
  assert.equal([...after.keys()].filter((key) => key.startsWith("8") || key.startsWith("5")).length, 0, "ханшийн олз/гарз үгүй (MNT)");
});

test("ENT-064: хүлээн авсан ч нэхэмжлээгүй бараатай PO дутуу хаагдахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const order = await orderWith("c", 12, 10);
  const result = await tool("close_purchase_order", {
    purchaseOrderId: order.id,
    closeDate: DATE,
    shortClose: true,
    reason: "Туршилтын шалтгаан",
  });
  assert.match(result.resultText, /бүрэн нэхэмжлээгүй — 1 мөр \(2 нэгж\)/);
  const unchanged = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, order.id) });
  assert.equal(unchanged?.status, "open");
});

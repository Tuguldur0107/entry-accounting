// Хангамжийн зэрэгцээ үйлдэл (docs/ontology-audit.md M8): AI захиалга (PO)
// цуцлах ба хүлээн авалт батлахыг зэрэг дуудахад цуцлалт PO-г түгждэггүй,
// хүлээн авалтыг транзакцаас гадна шалгадаг, ноорог устгалт 0 мөр устгахад
// чимээгүй өнгөрдөг байсан тул ЦУЦЛАГДСАН PO-д БАТЛАГДСАН хүлээн авалт
// (капитализаци, GL) үлддэг байв.
// Уралдааныг ТОДОРХОЙ давтана: тусдаа холболтоор PO болон хүлээн авалтын мөрийг
// түгжиж action-ыг хүлээлгэнэ, «батлалт»-аа (хүлээн авалт → confirmed) commit хийнэ.
// DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { eq } from "drizzle-orm";
import postgres from "postgres";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд алгасна
}

import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { createCounterparty } from "../lib/actions/arap";
import { createInventoryItem, createWarehouse } from "../lib/actions/inventory";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createGoodsReceipt,
  createPurchaseOrder,
} from "../lib/actions/procurement";
import { db } from "../lib/db";
import { goodsReceipts, inventoryItems, memberships, organizations, purchaseOrders, users, warehouses } from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];
const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
function ok<T extends { error?: string }>(result: T, label: string) {
  assert.equal(result.error, undefined, `${label}: ${result.error}`);
  return result as Extract<T, { error?: undefined }>;
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

let setups = 0;
async function setup() {
  setups += 1;
  const tag = `${STAMP}-${setups}`;
  const [user] = await db
    .insert(users)
    .values({ name: `m8-${tag}`, email: `m8-${tag}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `M8 ${tag}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
  const supplierId = ok(await asOrg(() => createCounterparty({ name: `Нийлүүлэгч ${tag}`, counterpartyType: "supplier" })), "харилцагч").id;
  await asOrg(() => createInventoryItem({ code: `IT-${tag}`, name: "Бараа", unit: "ш" }));
  await asOrg(() => createWarehouse({ code: `WH-${tag}`, name: "Агуулах" }));
  const item = await db.query.inventoryItems.findFirst({ where: eq(inventoryItems.organizationId, orgId) });
  const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.organizationId, orgId) });
  assert.ok(item && warehouse);
  const order = ok(
    await asOrg(() =>
      createPurchaseOrder({
        counterpartyId: supplierId,
        date: "2025-03-03",
        currency: "MNT",
        warehouseId: warehouse.id,
        description: "M8",
        lines: [{ itemId: item.id, quantity: 5, unitPrice: 1_000 }],
      })
    ),
    "PO"
  );
  ok(await asOrg(() => approvePurchaseOrder({ id: order.id })), "батлах");
  const receipt = ok(
    await asOrg(() => createGoodsReceipt({ purchaseOrderId: order.id, date: "2025-03-05", warehouseId: warehouse.id, description: "ноорог" })),
    "хүлээн авалт"
  );
  return { orderId: order.id, receiptId: receipt.id };
}

test("PO цуцлалт: хооронд нь батлагдсан хүлээн авалттай PO цуцлагдахгүй", { skip: !DB_READY }, async () => {
  const { orderId, receiptId } = await setup();
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
  let pending!: Promise<{ error?: string }>;
  try {
    await sql.begin(async (tx) => {
      // confirmGoodsReceipt-тэй ижил: PO-г түгжиж, хүлээн авалтыг батлана.
      await tx`select id from purchase_orders where id = ${orderId} for update`;
      await tx`update goods_receipts set status = 'confirmed' where id = ${receiptId}`;
      pending = asOrg(() => cancelPurchaseOrder({ id: orderId }));
      for (let attempt = 0; ; attempt += 1) {
        const [row] = await sql`
          select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`;
        if (row.waiting > 0) break;
        if (attempt > 100) throw new Error("цуцлалт түгжээ хүлээсэнгүй — уралдаан үүссэнгүй");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });
    const result = await pending;
    assert.match(result.error ?? "", /хүлээн авалттай|STATE_CHANGED/, JSON.stringify(result));
  } finally {
    await sql.end({ timeout: 5 });
  }
  const order = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, orderId) });
  assert.equal(order?.status, "open", "цуцлагдаагүй");
  const receipt = await db.query.goodsReceipts.findFirst({ where: eq(goodsReceipts.id, receiptId) });
  assert.equal(receipt?.status, "confirmed");
});

test("PO цуцлалт: зэрэгцээгүй үед ноорог хүлээн авалтыг хамт устгаж цуцлагдана (регресс биш)", { skip: !DB_READY }, async () => {
  const { orderId, receiptId } = await setup();
  const result = ok(await asOrg(() => cancelPurchaseOrder({ id: orderId })), "цуцлах");
  assert.equal(result.deletedReceipts.length, 1);
  assert.equal((await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, orderId) }))?.status, "cancelled");
  assert.equal(await db.query.goodsReceipts.findFirst({ where: eq(goodsReceipts.id, receiptId) }), undefined);
});

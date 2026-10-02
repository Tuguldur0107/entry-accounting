// AI хязгаар/хамгаалалтыг тойрох замууд (docs/ontology-audit.md H6, §4.2):
//   • update_pos_settings — хасах үлдэгдэл асаах, хөнгөлөлтийн дээд хувь өсгөх;
//   • update_costing_accounts — нээлттэй PO-той сар хаалтыг block → warn;
//   • update_purchase_order — БАТЛАГДСАН PO-г ноорог горимд, хязгааргүй засах;
//   • create_recurring_invoice{autoPost} — ирээдүйн нэхэмжлэхийг хүнгүй, хязгааргүй батлах.
// Хамгаалалт сулруулах → [HUMAN_REQUIRED] (вэбээс хүн), чангатгах чөлөөтэй;
// батлах шинжтэй засвар → 'Шууд бичих' горим + батлах хязгаар (approve-тэй ижил).
// DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

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
import { arApDocuments, memberships, organizationProfile, organizations, posSettings, purchaseOrders, users } from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

const tool = (name: string, input: unknown, mode: "draft" | "post" = "post") =>
  runAsOrg({ userId, orgId }, () => executeAiTool(userId, name, input, mode));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result;
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `h6-${STAMP}`, email: `h6-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `H6 ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `H6 ${STAMP}` });
  const sync = await runAsOrg({ userId, orgId }, () => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
}

test("update_pos_settings: хамгаалалт сулруулах [HUMAN_REQUIRED], чангатгах чөлөөтэй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const enable = await tool("update_pos_settings", { allowNegativeStock: true });
  assert.match(enable.resultText, /HUMAN_REQUIRED/, enable.resultText);
  ok(await tool("update_pos_settings", { maxManualDiscountPercent: 5 }));
  const raise = await tool("update_pos_settings", { maxManualDiscountPercent: 60 });
  assert.match(raise.resultText, /HUMAN_REQUIRED/, raise.resultText);
  ok(await tool("update_pos_settings", { allowNegativeStock: false, maxManualDiscountPercent: 2 }));
  const settings = await db.query.posSettings.findFirst({ where: eq(posSettings.organizationId, orgId) });
  assert.equal(settings?.allowNegativeStock, false);
  assert.equal(Number(settings?.maxManualDiscountPercent), 2);
});

test("update_costing_accounts: block → warn нь [HUMAN_REQUIRED]", { skip: !DB_READY }, async () => {
  await setupOrg();
  const loosen = await tool("update_costing_accounts", { openPoCloseMode: "warn" });
  assert.match(loosen.resultText, /HUMAN_REQUIRED/, loosen.resultText);
  ok(await tool("update_costing_accounts", { openPoCloseMode: "block" }));
});

test("update_purchase_order: батлагдсан PO-ийн мөр засах = батлах (горим + хязгаар)", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("create_counterparty", { name: "Нийлүүлэгч", counterpartyType: "supplier" }));
  ok(await tool("create_warehouse", { code: "WH1", name: "Агуулах" }));
  ok(await tool("create_inventory_item", { code: "PART", name: "Сэлбэг", unit: "ш" }));
  ok(
    await tool("create_purchase_order", {
      supplier: "Нийлүүлэгч",
      date: "2025-03-03",
      warehouseCode: "WH1",
      description: "H6",
      lines: [{ itemCode: "PART", quantity: 10, unitPrice: 10_000 }],
    }, "draft")
  );
  const order = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.organizationId, orgId) });
  assert.ok(order);
  // Ноорог PO — ноорог горимд засна (батлаагүй тул регресс биш).
  ok(await tool("update_purchase_order", { purchaseOrderId: order.documentNo, lines: [{ itemCode: "PART", quantity: 12, unitPrice: 10_000 }] }, "draft"));
  ok(await tool("approve_purchase_order", { purchaseOrderId: order.documentNo }));

  const draftMode = await tool("update_purchase_order", { purchaseOrderId: order.documentNo, lines: [{ itemCode: "PART", quantity: 20, unitPrice: 10_000 }] }, "draft");
  assert.match(draftMode.resultText, /DIRECT_MODE_REQUIRED/, draftMode.resultText);
  const overLimit = await tool("update_purchase_order", { purchaseOrderId: order.documentNo, lines: [{ itemCode: "PART", quantity: 2_000, unitPrice: 10_000 }] });
  assert.match(overLimit.resultText, /AMOUNT_LIMIT_EXCEEDED/, overLimit.resultText);
  assert.equal(Number((await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, order.id) }))?.totalAmount), 120_000);
  // Мөргүй засвар (тайлбар) — дүн хөндөхгүй тул ноорог горимд ч болно.
  ok(await tool("update_purchase_order", { purchaseOrderId: order.documentNo, description: "H6 засвар" }, "draft"));
  ok(await tool("update_purchase_order", { purchaseOrderId: order.documentNo, lines: [{ itemCode: "PART", quantity: 15, unitPrice: 10_000 }] }));
  assert.equal(Number((await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, order.id) }))?.totalAmount), 150_000);
});

test("create_recurring_invoice{autoPost}: горим + батлах хязгаар", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("create_counterparty", { name: "Түрээслэгч", counterpartyType: "customer" }));
  const invoice = async (description: string, amount: number) => {
    ok(await tool("create_arap_invoice", {
      documentType: "ar_invoice",
      counterparty: "Түрээслэгч",
      date: "2025-03-01",
      description,
      lines: [{ description: "Түрээс", amount, account: "51100000" }],
    }, "draft"));
    const row = await db.query.arApDocuments.findFirst({
      where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.description, description)),
    });
    assert.ok(row);
    return row.documentNo;
  };
  const small = await invoice("Түрээс жижиг", 500_000);
  const big = await invoice("Түрээс том", 50_000_000);
  const schedule = (documentId: string, autoPost: boolean) => ({ documentId, intervalMonths: 1, dayOfMonth: 1, startDate: "2025-04-01", autoPost });

  const draftMode = await tool("create_recurring_invoice", schedule(small, true), "draft");
  assert.match(draftMode.resultText, /DIRECT_MODE_REQUIRED/, draftMode.resultText);
  const overLimit = await tool("create_recurring_invoice", schedule(big, true));
  assert.match(overLimit.resultText, /AMOUNT_LIMIT_EXCEEDED/, overLimit.resultText);
  // Ноорог үүсгэх давтамж — ноорог горимд ч болно; хязгаар дотор autoPost — шууд горимд.
  ok(await tool("create_recurring_invoice", schedule(big, false), "draft"));
  ok(await tool("create_recurring_invoice", schedule(small, true)));
});

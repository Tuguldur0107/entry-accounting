// AI/MCP tool-ын idempotency (`externalRef`) — сүлжээ тасарч агент ДАХИН
// дуудахад давхар бичилт үүсэхгүй (docs/ontology-audit.md §4.2, H2):
//   pay_arap_document · create_pos_sale · create_goods_receipt ·
//   create_inventory_movement · create_fixed_asset(s_batch) ·
//   create_cost_allocation · create_company
// Ижил externalRef-тэй ХОЁР дахь дуудлага шинэ бичилт үүсгэхгүй, анхныхыг
// `dedup`-тайгаар буцаана; ЗЭРЭГЦЭЭ дуудлага ч нэг л бичилт (unique index).
// DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

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
import { db } from "../lib/db";
import {
  arApDocuments,
  cashDocuments,
  costAllocations,
  fixedAssets,
  goodsReceipts,
  inventoryMovements,
  memberships,
  organizationProfile,
  organizations,
  posSales,
  purchaseOrders,
  users,
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
function ok<T extends { resultText: string; dedup?: boolean }>(result: T) {
  assert.ok(
    !result.resultText.startsWith("Алдаа") || result.resultText.includes("static generation store"),
    result.resultText
  );
  return result;
}
const ref = (name: string) => `${name}-${STAMP}`;

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `idem-${STAMP}`, email: `idem-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `Idempotency ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    // create_company-оор үүссэн байгууллагууд (энэ хэрэглэгч эзэмшдэг) мөн устгагдана.
    const owned = await db.query.memberships.findMany({ where: eq(memberships.userId, user.id), columns: { organizationId: true } });
    for (const row of owned) await purgeOrganization(row.organizationId);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `Idempotency ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
  ok(await tool("create_warehouse", { code: "WH1", name: "Төв агуулах" }));
  ok(await tool("create_inventory_item", { code: "ITM", name: "Бараа", unit: "ш", salesPrice: 5_000 }));
  ok(await tool("create_cash_account", { name: "Касс", accountType: "cash", currency: "MNT", glAccount: "10000001" }));
  ok(await tool("create_counterparty", { name: "Харилцагч", counterpartyType: "both" }));
  ok(await tool("save_cost_component", { code: "FREIGHT", name: "Тээвэр" }));
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

/** Ижил дуудлагыг 2 удаа: эхнийх үүсгэнэ, хоёр дахь нь dedup. */
async function twice(name: string, input: unknown, mode: "draft" | "post" = "post") {
  const first = ok(await tool(name, input, mode));
  const second = ok(await tool(name, input, mode));
  assert.notEqual(first.dedup, true, `${name}: эхний дуудлага шинэ`);
  assert.equal(second.dedup, true, `${name}: давтан дуудлага dedup — ${second.resultText}`);
  assert.match(second.resultText, /externalRef/, name);
  return { first, second };
}

test("pay_arap_document: давтан дуудлага давхар төлбөр үүсгэхгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(
    await tool("create_arap_invoice", {
      documentType: "ar_invoice",
      counterparty: "Харилцагч",
      date: "2025-03-01",
      dueDate: "2025-03-31",
      description: "idem",
      externalRef: ref("inv"),
      lines: [{ account: "51100000", amount: 100_000 }],
    })
  );
  const invoice = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, ref("inv"))),
  });
  assert.equal(invoice?.status, "posted");
  // Хэсэгчилсэн төлөлт — үлдэгдэл хангалттай тул хуучин код давтан төлбөрийг ч бүртгэдэг байв.
  await twice("pay_arap_document", {
    documentId: invoice!.documentNo,
    cashAccount: "Касс",
    date: "2025-03-05",
    amount: 30_000,
    externalRef: ref("pay"),
  });
  const docs = await db.query.cashDocuments.findMany({
    where: and(eq(cashDocuments.organizationId, orgId), eq(cashDocuments.arApDocumentId, invoice!.id)),
  });
  assert.equal(docs.length, 1, "нэг л төлбөрийн баримт");
  const after = await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, invoice!.id) });
  assert.equal(Number(after?.paidAmount), 30_000);
});

test("create_inventory_movement: давтан ба ЗЭРЭГЦЭЭ дуудлага нэг хөдөлгөөн", { skip: !DB_READY }, async () => {
  await setupOrg();
  const input = { movementType: "receipt", date: "2025-03-02", itemCode: "ITM", warehouseCode: "WH1", quantity: 10, externalRef: ref("mv") };
  await twice("create_inventory_movement", input);
  const concurrent = { ...input, externalRef: ref("mv-race") };
  const results = await Promise.all([tool("create_inventory_movement", concurrent), tool("create_inventory_movement", concurrent)]);
  for (const result of results) ok(result);
  const rows = await db.query.inventoryMovements.findMany({
    where: and(eq(inventoryMovements.organizationId, orgId), inArray(inventoryMovements.externalRef, [ref("mv"), ref("mv-race")])),
  });
  assert.equal(rows.length, 2, "ref бүрд нэг хөдөлгөөн");
});

test("create_cost_allocation: давтан дуудлага нэг хуваарилалт", { skip: !DB_READY }, async () => {
  await setupOrg();
  const movement = await db.query.inventoryMovements.findFirst({
    where: and(eq(inventoryMovements.organizationId, orgId), eq(inventoryMovements.externalRef, ref("mv"))),
  });
  assert.ok(movement, "орлогын хөдөлгөөн");
  await twice(
    "create_cost_allocation",
    {
      allocationBase: "manual",
      component: "FREIGHT",
      date: "2025-03-03",
      totalAmount: 2_000,
      targets: [{ movementId: movement!.id, manualAmount: 2_000 }],
      externalRef: ref("alloc"),
    },
    "draft"
  );
  const rows = await db.query.costAllocations.findMany({ where: eq(costAllocations.organizationId, orgId) });
  assert.equal(rows.length, 1);
});

test("create_fixed_asset ба batch: давтан дуудлага нэг карт", { skip: !DB_READY }, async () => {
  await setupOrg();
  const asset = { name: "Компьютер", acquisitionDate: "2025-01-10", cost: 3_000_000, usefulLifeMonths: 36, custodian: "Нягтлан", externalRef: ref("fa") };
  await twice("create_fixed_asset", asset);
  const batch = { items: [{ ...asset, name: "Принтер", externalRef: ref("fa-b1") }] };
  ok(await tool("create_fixed_assets_batch", batch));
  const again = ok(await tool("create_fixed_assets_batch", batch));
  assert.match(again.resultText, /алгас|dedup|аль хэдийн/i, again.resultText);
  const rows = await db.query.fixedAssets.findMany({ where: eq(fixedAssets.organizationId, orgId) });
  assert.equal(rows.length, 2, "компьютер + принтер");
});

test("create_goods_receipt: давтан дуудлага нэг хүлээн авалт", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(
    await tool("create_purchase_order", {
      supplier: "Харилцагч",
      date: "2025-03-04",
      description: "idem PO",
      documentNo: `PO-${STAMP}`,
      warehouseCode: "WH1",
      lines: [{ itemCode: "ITM", quantity: 5, unitPrice: 1_000 }],
    })
  );
  // post горимд PO шууд батлагдана (open).
  await twice("create_goods_receipt", { purchaseOrderId: `PO-${STAMP}`, date: "2025-03-06", externalRef: ref("gr") }, "draft");
  const order = await db.query.purchaseOrders.findFirst({
    where: and(eq(purchaseOrders.organizationId, orgId), eq(purchaseOrders.documentNo, `PO-${STAMP}`)),
  });
  const rows = await db.query.goodsReceipts.findMany({ where: eq(goodsReceipts.purchaseOrderId, order!.id) });
  assert.equal(rows.length, 1);
});

test("create_pos_sale: давтан дуудлага давхар борлуулалт үүсгэхгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("update_pos_settings", { allowNegativeStock: true }));
  ok(await tool("open_pos_shift", { cashAccount: "Касс", warehouseCode: "WH1" }));
  const sale = { lines: [{ itemCode: "ITM", quantity: 1 }], payments: [{ method: "CASH", amount: 5_000 }], skipEbarimt: true, externalRef: ref("pos") };
  const { first, second } = await twice("create_pos_sale", sale);
  const docNo = /POS-\d{4}-\d{4}/.exec(first.resultText)?.[0];
  assert.ok(docNo && second.resultText.includes(docNo), "давтан хариу ижил баримтын дугаартай");
  const rows = await db.query.posSales.findMany({ where: eq(posSales.organizationId, orgId) });
  assert.equal(rows.length, 1);
});

test("create_company: давтан дуудлага шинэ компани (tenant) үүсгэхгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const name = `Шинэ компани ${STAMP}`;
  await twice("create_company", { name, externalRef: ref("co") });
  const owned = await db
    .select({ id: organizations.id })
    .from(organizations)
    .innerJoin(memberships, eq(memberships.organizationId, organizations.id))
    .where(and(eq(memberships.userId, userId), eq(organizations.name, name)));
  assert.equal(owned.length, 1);
});

test("ЗЭРЭГЦЭЭ дуудлага: төлбөр, POS, компани — unique index нэгийг л үлдээнэ", { skip: !DB_READY }, async () => {
  await setupOrg();
  const invoice = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, ref("inv"))),
  });
  assert.ok(invoice);
  const pay = { documentId: invoice!.documentNo, cashAccount: "Касс", date: "2025-03-07", amount: 10_000, externalRef: ref("pay-race") };
  const sale = { lines: [{ itemCode: "ITM", quantity: 1 }], payments: [{ method: "CASH", amount: 5_000 }], skipEbarimt: true, externalRef: ref("pos-race") };
  const company = { name: `Зэрэгцээ компани ${STAMP}`, externalRef: ref("co-race") };
  const results = await Promise.all([
    tool("pay_arap_document", pay),
    tool("pay_arap_document", pay),
    tool("create_pos_sale", sale),
    tool("create_pos_sale", sale),
    tool("create_company", company),
    tool("create_company", company),
  ]);
  for (const result of results) ok(result);
  const pays = await db.query.cashDocuments.findMany({
    where: and(eq(cashDocuments.organizationId, orgId), eq(cashDocuments.externalRef, ref("pay-race"))),
  });
  assert.equal(pays.length, 1, "нэг төлбөр");
  const sales = await db.query.posSales.findMany({
    where: and(eq(posSales.organizationId, orgId), eq(posSales.externalRef, ref("pos-race"))),
  });
  assert.equal(sales.length, 1, "нэг борлуулалт");
  const companies = await db
    .select({ id: organizations.id })
    .from(organizations)
    .innerJoin(memberships, eq(memberships.organizationId, organizations.id))
    .where(and(eq(memberships.userId, userId), eq(organizations.name, company.name)));
  assert.equal(companies.length, 1, "нэг компани");
  // Хоёр хариуны нэг нь dedup — агент давхар гэдгийг ил мэднэ.
  assert.equal(results.filter((result) => result.dedup).length, 3, results.map((r) => r.resultText).join("\n---\n"));
});

test("өөр хэрэглэгчийн ижил externalRef өөр компани үүсгэнэ, бусдын компанийг задлахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const [other] = await db
    .insert(users)
    .values({ name: `idem2-${STAMP}`, email: `idem2-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [otherOrg] = await db.insert(organizations).values({ name: `Бусад ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: otherOrg.id, userId: other.id, role: "owner" });
  cleanup.push(async () => {
    const owned = await db.query.memberships.findMany({ where: eq(memberships.userId, other.id), columns: { organizationId: true } });
    for (const row of owned) await purgeOrganization(row.organizationId);
    await db.delete(users).where(eq(users.id, other.id));
  });
  const result = ok(
    await runAsOrg({ userId: other.id, orgId: otherOrg.id }, () =>
      executeAiTool(other.id, "create_company", { name: `Бусдын шинэ ${STAMP}`, externalRef: ref("co") }, "post")
    )
  );
  assert.notEqual(result.dedup, true, result.resultText);
  assert.match(result.resultText, /Шинэ компани үүслээ/);
});

// SIM2-007 / ENT-003: нээлтийн барааны үлдэгдэл өртөгтэй — DB integration.
// D-OS-1 (Dr нөөц / Cr 44000098) ба D-OS-2 (бусад гүйлгээнээс өмнө) шалгана.
// DATABASE_URL шаарддаг: түр байгууллага, төгсгөлд purgeOrganization.

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
import { postCostEntries, postCostEntry, reverseCostEntry } from "../lib/actions/costing";
import { db } from "../lib/db";
import {
  costEntries,
  inventoryMovements,
  journalLines,
  journalVouchers,
  memberships,
  organizationProfile,
  organizations,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, input: unknown, mode: "draft" | "post" = "draft") =>
  asOrg(() => executeAiTool(userId, name, input, mode));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result;
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `ons-${STAMP}`, email: `ons-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `Нээлтийн бараа ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId: user.id, organizationId: org.id, name: `Нээлтийн бараа ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
  ok(await tool("create_warehouse", { code: "WH1", name: "Төв агуулах" }));
  ok(await tool("create_warehouse", { code: "WH2", name: "Дэлгүүр" }));
  ok(await tool("create_inventory_item", { code: "OS-A", name: "Нээлтийн бараа A", unit: "ш" }));
  ok(await tool("create_inventory_item", { code: "OS-B", name: "Нээлтийн бараа B", unit: "ш" }));
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function entriesOf(externalBatch: string[]) {
  return db.query.costEntries.findMany({
    where: and(eq(costEntries.organizationId, orgId), inArray(costEntries.movementId, externalBatch)),
  });
}

async function openingMovementIds() {
  const rows = await db.query.inventoryMovements.findMany({
    where: and(eq(inventoryMovements.organizationId, orgId), eq(inventoryMovements.sourceType, "opening")),
    columns: { id: true, status: true, itemId: true, warehouseId: true, quantity: true },
  });
  return rows;
}

test("SIM2-007: нээлтийн бараа өртөгтэй — НЭГ журнал Dr нөөц / Cr 44000098, идемпотент", { skip: !DB_READY }, async () => {
  await setupOrg();
  const lines = [
    { itemCode: "OS-A", warehouseCode: "WH1", quantity: 10, unitCost: 1000 },
    { itemCode: "OS-A", warehouseCode: "WH2", quantity: 5, unitCost: 1200 },
    { itemCode: "OS-B", warehouseCode: "WH1", quantity: 4, unitCost: 250 },
  ];
  const text = ok(
    await tool("create_opening_stock", { date: "2024-12-31", lines, externalRef: "opening-stock:2024-12-31" }, "post")
  ).resultText;
  assert.match(text, /3 мөр, нийт 17,000₮/);
  assert.match(text, /Cr 44000098/);
  assert.match(text, /батлагдсан — журнал COST-24-/);

  const movements = await openingMovementIds();
  assert.equal(movements.length, 3);
  assert.ok(movements.every((movement) => movement.status === "confirmed"));
  const entries = await entriesOf(movements.map((movement) => movement.id));
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    assert.equal(entry.status, "posted");
    assert.equal(entry.valuationSource, "opening");
    assert.equal(entry.entryType, "receipt_capitalize");
    assert.equal(entry.creditAccountNumber, "44000098");
  }
  const voucherIds = [...new Set(entries.map((entry) => entry.voucherId))];
  assert.equal(voucherIds.length, 1, "багцад НЭГ журнал");
  const voucher = await db.query.journalVouchers.findFirst({
    where: eq(journalVouchers.id, voucherIds[0]!),
    with: { lines: true },
  });
  assert.equal(voucher?.externalRef, "opening-stock:2024-12-31");
  assert.equal(voucher?.status, "posted");
  const main = (code: string) => code.split(".")[2] ?? code;
  const debit = voucher!.lines.filter((line) => Number(line.debit) > 0);
  const credit = voucher!.lines.filter((line) => Number(line.credit) > 0);
  assert.ok(debit.every((line) => main(line.accountNumber) === "14000001"));
  assert.ok(credit.every((line) => main(line.accountNumber) === "44000098"));
  assert.equal(debit.reduce((sum, line) => sum + Number(line.debit), 0), 17_000);
  assert.ok(voucher!.lines.every((line) => line.costEntryId && line.inventoryMovementId), "мөр бүр дэд дэвтэртэй холбоотой");

  // Дахин дуудахад шинэ бичилт үүсэхгүй.
  const again = (await tool("create_opening_stock", { date: "2024-12-31", lines, externalRef: "opening-stock:2024-12-31" }, "post"))
    .resultText;
  assert.match(again, /Аль хэдийн оруулсан/);
  assert.equal((await openingMovementIds()).length, 3);

  // Өртөг тооцоход «үнэ хүлээж байгаа» үлдэхгүй — нээлт өртөгтэй орлого.
  const costing = ok(await tool("run_monthly_costing", { period: "2024-12" })).resultText;
  assert.doesNotMatch(costing, /БЛОКЛОГДСОН/, costing);
});

test("SIM2-007: ноорог горим → «Өртгийн бичилт»-ээс батлахад Cr 44000098 хэвээр; ганц бичилтийн буцаалт", { skip: !DB_READY }, async () => {
  await setupOrg();
  const text = ok(
    await tool("create_opening_stock", {
      date: "2024-12-31",
      lines: [{ itemCode: "OS-B", warehouseCode: "WH2", quantity: 3, unitCost: 500 }],
      externalRef: "opening-stock:draft",
    })
  ).resultText;
  assert.match(text, /НООРОГ/);
  const movement = (await openingMovementIds()).find((row) => Number(row.quantity) === 3);
  assert.ok(movement);
  const [entry] = await entriesOf([movement!.id]);
  assert.equal(entry.status, "draft");
  assert.equal(entry.voucherId, null);

  const posted = await asOrg(() => postCostEntry(entry.id));
  assert.ok(!posted.error, posted.error);
  const after = await db.query.costEntries.findFirst({ where: eq(costEntries.id, entry.id) });
  assert.equal(after?.status, "posted");
  const lines = await db.query.journalLines.findMany({ where: eq(journalLines.voucherId, after!.voucherId!) });
  const creditLine = lines.find((line) => Number(line.credit) > 0)!;
  assert.equal(creditLine.accountNumber.split(".")[2], "44000098", "клиринг (14000099) руу БИШ");

  // Багц журналын НЭГ бичилтийг буцаахад зөвхөн тэр бичилтийн 2 мөр эргэнэ.
  const batchEntry = (await db.query.costEntries.findMany({
    where: and(eq(costEntries.organizationId, orgId), eq(costEntries.valuationSource, "opening"), eq(costEntries.status, "posted")),
  })).find((row) => row.id !== entry.id)!;
  const reversed = await asOrg(() => reverseCostEntry(batchEntry.id));
  assert.ok(!reversed.error, reversed.error);
  const reversal = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.reversalOfVoucherId, batchEntry.voucherId!)),
    with: { lines: true },
  });
  assert.equal(reversal?.lines.length, 2);
  assert.equal(
    reversal!.lines.reduce((sum, line) => sum + Number(line.debit), 0),
    Number(batchEntry.amount)
  );

  // postCostEntries нь алдааг ил тоолно (өмнө нь бүгдийг «батлагдсан» гэдэг байв).
  const batch = await asOrg(() => postCostEntries(["00000000-0000-4000-a000-000000000000"]));
  assert.ok(!batch.error);
  assert.equal(batch.posted, 0);
  assert.equal(batch.failures.length, 1);
});

test("SIM2-007 D-OS-2: нээлтийн огноо бусад гүйлгээнээс хожуу бол татгалзана", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(
    await tool(
      "create_inventory_movement",
      { movementType: "issue", date: "2025-01-05", itemCode: "OS-A", warehouseCode: "WH1", quantity: 2 },
      "post"
    )
  );
  const late = await tool("create_opening_stock", {
    date: "2025-01-10",
    lines: [{ itemCode: "OS-B", warehouseCode: "WH1", quantity: 1, unitCost: 100 }],
  });
  assert.match(late.resultText, /OPENING_AFTER_ACTIVITY/);
  const bad = await tool("create_opening_stock", {
    date: "2024-12-31",
    lines: [{ itemCode: "NOPE", warehouseCode: "WH1", quantity: 1, unitCost: 100 }],
  });
  assert.match(bad.resultText, /ITEM_NOT_FOUND[^\n]*NOPE/);
});

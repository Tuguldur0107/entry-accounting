// Өртгийн бичилтийн буцаалт (reverse_cost_entry) — GL ↔ дэд дэвтэр:
//   • нээлтийн үлдэгдлийн багц НЭГ журналтай — бичилт бүрийг ТУСДАА буцаах
//     боломжтой; журнал сүүлийн бичилт буцтал «posted» (өмнө нь эхнийх нь
//     журналыг бүхэлд нь «reversed» болгож дараагийнх нь гацдаг байв)
//   • ижил бичилтийг давхар буцаахгүй
//   • хуучин өгөгдөл: журнал «reversed» боловч буцаалтууд нь бүгд бичилт
//     бүрийнх бол үлдсэн бичилт буцна; GL талаас бүтэн буцаасан журналд ҮГҮЙ
//   • reverseCostAllocation нь бичилтийн буцаалтын алдааг ЧИМЭЭГҮЙ залгихгүй —
//     хуваарилалтыг устгаад GL-д капитализаци үлдээхгүй
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
import { postCostEntry, reverseCostEntry } from "../lib/actions/costing";
import { reverseCostAllocation } from "../lib/actions/cost-allocation";
import { db } from "../lib/db";
import {
  costAllocations,
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
    .values({ name: `cer-${STAMP}`, email: `cer-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `Өртгийн буцаалт ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId: user.id, organizationId: org.id, name: `Өртгийн буцаалт ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
  ok(await tool("create_warehouse", { code: "WH1", name: "Төв агуулах" }));
  for (const code of ["R-A", "R-B", "R-C", "R-D", "R-E"])
    ok(await tool("create_inventory_item", { code, name: `Бараа ${code}`, unit: "ш" }));
  ok(await tool("save_cost_component", { code: "FREIGHT", name: "Тээвэр" }));
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

// Нээлтийн багц (НЭГ журнал) → бичилтүүд барааны кодоор.
async function openingBatch(date: string, items: string[], ref: string) {
  ok(
    await tool(
      "create_opening_stock",
      {
        date,
        lines: items.map((itemCode, index) => ({ itemCode, warehouseCode: "WH1", quantity: 10, unitCost: 1000 * (index + 1) })),
        externalRef: `${ref}-${STAMP}`,
      },
      "post"
    )
  );
  const movements = await db.query.inventoryMovements.findMany({
    where: and(eq(inventoryMovements.organizationId, orgId), eq(inventoryMovements.sourceType, "opening"), eq(inventoryMovements.date, date)),
    with: { item: { columns: { code: true } } },
  });
  const entries = await db.query.costEntries.findMany({
    where: and(eq(costEntries.organizationId, orgId), inArray(costEntries.movementId, movements.map((m) => m.id))),
  });
  const byCode = new Map(entries.map((entry) => [movements.find((m) => m.id === entry.movementId)!.item!.code, entry]));
  const voucherIds = new Set(entries.map((entry) => entry.voucherId));
  assert.equal(voucherIds.size, 1, "багцад НЭГ журнал");
  return { byCode, voucherId: [...voucherIds][0]! };
}

const voucherStatus = async (id: string) =>
  (await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, id), columns: { status: true } }))?.status;

// Эх журнал + бүх буцаалтын журналын GL нийлбэр (тайлан posted + reversed-ийг уншдаг).
async function netWithReversals(voucherId: string) {
  const reversals = await db.query.journalVouchers.findMany({
    where: eq(journalVouchers.reversalOfVoucherId, voucherId),
    columns: { id: true },
  });
  const lines = await db.query.journalLines.findMany({
    where: inArray(journalLines.voucherId, [voucherId, ...reversals.map((r) => r.id)]),
  });
  return lines.reduce((sum, line) => sum + Number(line.debit), 0);
}

test("нээлтийн багц: бичилт бүр тусдаа буцна, журнал сүүлийнх нь буцтал posted", { skip: !DB_READY }, async () => {
  await setupOrg();
  const { byCode, voucherId } = await openingBatch("2024-12-31", ["R-A", "R-B", "R-C"], "batch");
  const [a, b, c] = ["R-A", "R-B", "R-C"].map((code) => byCode.get(code)!);
  const total = [a, b, c].reduce((sum, entry) => sum + Number(entry.amount), 0);

  const first = await asOrg(() => reverseCostEntry(a.id));
  assert.equal(first.error, undefined, JSON.stringify(first));
  assert.equal(await voucherStatus(voucherId), "posted", "бусад бичилт идэвхтэй — журнал posted хэвээр");
  assert.equal(await netWithReversals(voucherId), total - Number(a.amount));

  // Өмнө нь: «GL журнал аль хэдийн буцаагдсан байна» гэж гацдаг байв.
  const second = await asOrg(() => reverseCostEntry(b.id));
  assert.equal(second.error, undefined, JSON.stringify(second));
  assert.equal(await voucherStatus(voucherId), "posted");

  // Давхар буцаалт хориотой — GL дахин хасагдахгүй.
  const twice = await asOrg(() => reverseCostEntry(b.id));
  assert.ok(twice.error, "давхар буцаалт татгалзана");
  assert.equal(await netWithReversals(voucherId), Number(c.amount));

  const last = await asOrg(() => reverseCostEntry(c.id));
  assert.equal(last.error, undefined, JSON.stringify(last));
  assert.equal(await voucherStatus(voucherId), "reversed", "сүүлийн бичилт буцахад журнал reversed");
  assert.equal(await netWithReversals(voucherId), 0, "GL цэвэр 0");

  const rows = await db.query.costEntries.findMany({ where: inArray(costEntries.id, [a.id, b.id, c.id]) });
  assert.ok(rows.every((row) => row.status === "reversed" && row.reversalVoucherId));
  assert.equal(new Set(rows.map((row) => row.reversalVoucherId)).size, 3, "бичилт бүр өөрийн буцаалтын журналтай");
  for (const row of rows) {
    const reversal = await db.query.journalVouchers.findFirst({
      where: eq(journalVouchers.id, row.reversalVoucherId!),
      with: { lines: true },
    });
    assert.equal(reversal?.lines.length, 2, "зөвхөн өөрийн мөрүүд");
    assert.equal(reversal!.lines.reduce((sum, line) => sum + Number(line.debit), 0), -Number(row.amount));
  }
});

test("хуучин өгөгдөл: журнал reversed боловч буцаалтууд нь бичилт бүрийнх — үлдсэн бичилт буцна", { skip: !DB_READY }, async () => {
  await setupOrg();
  const { byCode, voucherId } = await openingBatch("2024-12-30", ["R-D", "R-E"], "legacy");
  const d = byCode.get("R-D")!;
  const e = byCode.get("R-E")!;

  // Хуучин код: эхний бичилтийн буцаалт журналыг бүхэлд нь «reversed» болгосон.
  assert.equal((await asOrg(() => reverseCostEntry(d.id))).error, undefined);
  await db.update(journalVouchers).set({ status: "reversed" }).where(eq(journalVouchers.id, voucherId));
  const repaired = await asOrg(() => reverseCostEntry(e.id));
  assert.equal(repaired.error, undefined, JSON.stringify(repaired));
  assert.equal(await netWithReversals(voucherId), 0);
  assert.equal(await voucherStatus(voucherId), "reversed");

});

test("GL-ээс бүтэн буцаасан журнал: бичилт буцахгүй, reverseCostAllocation хуваарилалтыг устгахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const { byCode } = await openingBatch("2024-12-29", ["R-A"], "alloc");
  const target = byCode.get("R-A")!;
  ok(
    await tool("create_cost_allocation", {
      allocationBase: "manual",
      component: "FREIGHT",
      date: "2025-01-10",
      totalAmount: 5000,
      documentNo: `ALLOC-${STAMP}`,
      targets: [{ movementId: target.movementId!, manualAmount: 5000 }],
    })
  );
  const allocation = await db.query.costAllocations.findFirst({
    where: and(eq(costAllocations.organizationId, orgId), eq(costAllocations.documentNo, `ALLOC-${STAMP}`)),
    with: { lines: true },
  });
  assert.ok(allocation?.lines[0]?.costEntryId);
  const entryId = allocation!.lines[0].costEntryId!;
  const posted = await asOrg(() => postCostEntry(entryId));
  assert.equal(posted.error, undefined, JSON.stringify(posted));
  const entry = await db.query.costEntries.findFirst({ where: eq(costEntries.id, entryId) });
  assert.ok(entry?.voucherId);

  // GL талаас (хуучин замаар) бүтэн буцаасан журнал — бичилтийн буцаалт татгалзана.
  await db.update(journalVouchers).set({ status: "reversed" }).where(eq(journalVouchers.id, entry!.voucherId!));
  await db.insert(journalVouchers).values({
    userId,
    organizationId: orgId,
    date: entry!.date,
    description: "GL буцаалт",
    status: "posted",
    reversalOfVoucherId: entry!.voucherId!,
  });

  // Дэд дэвтрийн бичилтийг дахин буцаавал GL давхар хасагдана → татгалзана.
  const direct = await asOrg(() => reverseCostEntry(entryId));
  assert.match(direct.error ?? "", /аль хэдийн буцаагдсан/, JSON.stringify(direct));
  const still = await db.query.costEntries.findFirst({ where: eq(costEntries.id, entryId), columns: { status: true } });
  assert.equal(still?.status, "posted", "транзакц бүхэлдээ буцсан");

  const result = await asOrg(() => reverseCostAllocation({ allocationId: allocation!.id }));
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(
    await db.query.costAllocations.findFirst({ where: eq(costAllocations.id, allocation!.id) }),
    "хуваарилалт хэвээр — капитализаци нь баримтгүй үлдэхгүй"
  );
});

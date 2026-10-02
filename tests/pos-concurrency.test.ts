// POS-ийн зэрэгцээ үйлдэл (docs/ontology-audit.md H8):
//   • кассчин ба AI нэг борлуулалтыг ЗЭРЭГ буцаавал хоёулаа «үлдсэн» тоогоор
//     давж бараа/мөнгө хэтэрч буцаагддаг байв;
//   • ээлж хаагдах зуур эхэлсэн борлуулалт ХААГДСАН ээлжид бүртгэгддэг;
//   • ээлж хаах нь системийн мөнгийг транзакцаас гадна бодсон тул хооронд нь
//     орсон мөнгө зөрүүнд тооцогдохгүй.
// Уралдааныг ТОДОРХОЙ давтана: тусдаа холболтоор POS түгжээг барьж action-уудыг
// хүлээлгэнэ (pg_stat_activity), дараа нь «зэрэгцээ» өөрчлөлтөө commit хийнэ.
// DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";

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
import { closeShift } from "../lib/actions/pos";
import { db } from "../lib/db";
import { memberships, organizationProfile, organizations, posSaleLines, posSales, posShifts, users } from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const POS_LOCK_KEY = 7; // lib/actions/pos.ts
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, input: unknown, mode: "draft" | "post" = "post") =>
  asOrg(() => executeAiTool(userId, name, input, mode));
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
    .values({ name: `h8-${STAMP}`, email: `h8-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `H8 ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `H8 ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
  ok(await tool("create_warehouse", { code: "WH1", name: "Дэлгүүр" }));
  ok(await tool("create_inventory_item", { code: "TEA", name: "Цай", unit: "ш", salesPrice: 5_000 }));
  ok(await tool("create_cash_account", { name: "Касс", accountType: "cash", currency: "MNT", glAccount: "10000001" }));
  ok(await tool("update_pos_settings", { allowNegativeStock: true }));
}

async function openShift() {
  ok(await tool("open_pos_shift", { cashAccount: "Касс", warehouseCode: "WH1" }));
  const shift = await db.query.posShifts.findFirst({
    where: and(eq(posShifts.organizationId, orgId), eq(posShifts.status, "open")),
  });
  assert.ok(shift);
  return shift;
}

async function sell(quantity: number) {
  ok(await tool("create_pos_sale", { lines: [{ itemCode: "TEA", quantity }], payments: [{ method: "CASH", amount: quantity * 5_000 }] }));
  const sale = await db.query.posSales.findFirst({
    where: and(eq(posSales.organizationId, orgId), eq(posSales.isReturn, false)),
    orderBy: (row, { desc }) => [desc(row.soldAt)],
  });
  assert.ok(sale);
  return sale;
}

/**
 * POS түгжээг тусдаа холболтоор барьж `actions`-ыг эхлүүлнэ; бүгд түгжээ
 * хүлээж эхэлмэгц `during`-ийг ТЭР транзакцад хийж commit хийнэ.
 */
async function underPosLock<T>(
  actions: (() => Promise<T>)[],
  during: (tx: postgres.TransactionSql) => Promise<unknown> = async () => {}
): Promise<T[]> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
  try {
    let pending: Promise<T>[] = [];
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${orgId}), ${POS_LOCK_KEY})`;
      pending = actions.map((action) => action());
      for (let attempt = 0; ; attempt += 1) {
        const [row] = await sql`
          select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`;
        if (row.waiting >= actions.length) break;
        if (attempt > 100) throw new Error("action-ууд POS түгжээ хүлээсэнгүй — уралдаан үүссэнгүй");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await during(tx);
    });
    return await Promise.all(pending);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test("буцаалт: кассчин ба AI зэрэг буцаавал нэг л удаа — хэтэрч буцаагдахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  await openShift();
  const sale = await sell(1);
  const results = await underPosLock([1, 2].map(() => () =>
    tool("return_pos_sale", { sale: sale.documentNo, lines: [{ itemCode: "TEA", quantity: 1 }], reason: "зэрэгцээ" })
  ));
  const succeeded = results.filter((result) => !result.resultText.startsWith("Алдаа"));
  assert.equal(succeeded.length, 1, results.map((result) => result.resultText).join("\n"));
  const returned = await db
    .select({ quantity: posSaleLines.quantity })
    .from(posSaleLines)
    .innerJoin(posSales, eq(posSales.id, posSaleLines.saleId))
    .where(and(eq(posSales.organizationId, orgId), eq(posSales.originalSaleId, sale.id)));
  assert.equal(returned.reduce((sum, line) => sum + Number(line.quantity), 0), 1, "нийт буцаасан ≤ зарсан");
});

test("борлуулалт: ээлж хаагдах зуур эхэлсэн борлуулалт хаагдсан ээлжид бичигдэхгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const shift = await db.query.posShifts.findFirst({
    where: and(eq(posShifts.organizationId, orgId), eq(posShifts.status, "open")),
  });
  assert.ok(shift, "өмнөх тестийн ээлж");
  const before = (await db.query.posSales.findMany({ where: eq(posSales.shiftId, shift.id) })).length;
  const [result] = await underPosLock(
    [() => tool("create_pos_sale", { lines: [{ itemCode: "TEA", quantity: 1 }], payments: [{ method: "CASH", amount: 5_000 }] })],
    (tx) => tx`update pos_shifts set status = 'closed', closed_at = now() where id = ${shift.id}`
  );
  assert.match(result.resultText, /SHIFT_CLOSED/, result.resultText);
  assert.equal((await db.query.posSales.findMany({ where: eq(posSales.shiftId, shift.id) })).length, before);
});

test("ээлж хаах: хооронд нь мөнгө орсон бол хуучин тоогоор хаахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const shift = await openShift();
  await sell(2);
  // Системийн мөнгө: эхний 0 + 10,000. Хаах хооронд эхний мөнгө 1,000 өөрчлөгдөнө.
  const [result] = await underPosLock(
    [() => asOrg(() => closeShift(shift.id, { countedCash: 10_000 }))],
    (tx) => tx`update pos_shifts set opening_float = opening_float + 1000 where id = ${shift.id}`
  );
  assert.match(result.error ?? "", /STATE_CHANGED/, JSON.stringify(result));
  const after = await db.query.posShifts.findFirst({ where: eq(posShifts.id, shift.id) });
  assert.equal(after?.status, "open", "хаагдаагүй — дахин тоолно");
  const retry = await asOrg(() => closeShift(shift.id, { countedCash: 11_000 }));
  assert.ok(!retry.error, retry.error);
  assert.equal(retry.variance, 0);
});

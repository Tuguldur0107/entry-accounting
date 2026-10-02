// Fork-ийн журналын hook БҮХ модульд (docs/ontology-audit.md M4).
// `beforeJournalPost` зөвхөн GL-ийн гар журналд ажиллаж, касс, АР/АП, POS (бас ҮХ,
// өртөг, хангамж, цалин, НӨАТ, банкны хуулга)-ийн журналууд fork-ийн хоригийг
// ТОЙРДОГ байв. Одоо DB trigger батлагдсан журналыг тэмдэглэж `db.transaction`
// commit-ийн өмнө hook-ийг нэг цэгээс дуудна (lib/custom/journal-hooks.ts).
// DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { and, eq, like } from "drizzle-orm";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд алгасна
}

import { customization } from "../custom";
import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts, unpostVoucher } from "../lib/actions/gl";
import { updatePosSettings } from "../lib/actions/pos";
import { isStornoLines, parsePostedVoucherNote } from "../lib/custom/journal-hooks";
import type { JournalHookContext } from "../lib/custom/types";
import { db } from "../lib/db";
import { journalVouchers, memberships, organizationProfile, organizations, posSales, users } from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

test("тэмдэглэл задлах: давхардалгүй, эхний эх сурвалж, гажигийг алгасна", () => {
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(parsePostedVoucherNote(`${a}:c,${b}:p,${a}:p,гажиг,`), [
    { voucherId: a, source: "create_posted" },
    { voucherId: b, source: "post" },
  ]);
  assert.deepEqual(parsePostedVoucherNote(null), []);
  assert.equal(isStornoLines([{ debit: -5, credit: 0 }, { debit: 0, credit: -5 }]), true);
  assert.equal(isStornoLines([{ debit: 5, credit: 0 }, { debit: 0, credit: 5 }]), false);
});

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const BLOCKED_TOTAL = 4_321;
let userId = "";
let orgId = "";
let blockAll = false;
const afterCalls: JournalHookContext[] = [];
const cleanup: (() => Promise<void>)[] = [];

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, input: unknown, mode: "draft" | "post" = "post") =>
  asOrg(() => executeAiTool(userId, name, input, mode));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result.resultText;
}

test.before(() => {
  // Fork-ийн custom/ багцыг дуурайна — зөвхөн ЭНЭ байгууллагын журналд хориг.
  customization.hooks = {
    async beforeJournalPost(ctx) {
      if (ctx.orgId !== orgId) return { ok: true };
      if (blockAll || ctx.description.includes("HOOK-BLOCK") || ctx.totalDebit === BLOCKED_TOTAL)
        return { ok: false, reason: `M4 custom хориг: ${ctx.documentNo}` };
      return { ok: true };
    },
    async afterJournalPost(ctx) {
      if (ctx.orgId === orgId) afterCalls.push(ctx);
    },
  };
});

test.after(async () => {
  customization.hooks = undefined;
  for (const fn of cleanup.reverse()) await fn();
});

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `m4-${STAMP}`, email: `m4-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `M4 ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `M4 ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
  ok(await tool("create_cash_account", { name: "Касс", accountType: "cash", currency: "MNT", glAccount: "10000001" }));
  ok(await tool("create_counterparty", { name: "Түнш", counterpartyType: "both" }));
}

const postedWith = (description: string) =>
  db.query.journalVouchers.findMany({
    where: and(
      eq(journalVouchers.organizationId, orgId),
      eq(journalVouchers.status, "posted"),
      like(journalVouchers.description, `%${description}%`)
    ),
  });

test("GL гар журнал: хориг хэвээр (регресс биш)", { skip: !DB_READY }, async () => {
  await setupOrg();
  const blocked = await tool("create_journal_voucher", {
    date: "2025-05-05",
    description: "GL HOOK-BLOCK",
    lines: [{ account: "11000001", debit: 10_000 }, { account: "51100000", credit: 10_000 }],
  });
  assert.match(blocked.resultText, /M4 custom хориг: GL-25-/, blocked.resultText);
  assert.equal((await postedWith("GL HOOK-BLOCK")).length, 0);
});

test("касс: нэхэмжлэхгүй орлогын журнал hook-оор хориглогдоно", { skip: !DB_READY }, async () => {
  await setupOrg();
  const blocked = await tool("create_cash_transaction", {
    documentType: "receipt", cashAccount: "Касс", date: "2025-05-06", amount: 20_000,
    counterAccount: "51100000", description: "Касс HOOK-BLOCK",
  });
  assert.match(blocked.resultText, /M4 custom хориг: CM-25-/, blocked.resultText);
  assert.equal((await postedWith("Касс HOOK-BLOCK")).length, 0);

  // Зөвшөөрөгдсөн гүйлгээ — commit-ийн дараа afterJournalPost CM- журналаар.
  ok(await tool("create_cash_transaction", {
    documentType: "receipt", cashAccount: "Касс", date: "2025-05-06", amount: 20_000,
    counterAccount: "51100000", description: "Касс зөвшөөрөгдсөн",
  }));
  const after = afterCalls.find((call) => call.description.includes("Касс зөвшөөрөгдсөн"));
  assert.ok(after, "afterJournalPost дуудагдсан");
  assert.match(after.documentNo ?? "", /^CM-25-/);
  assert.equal(after.reversal, false);
});

test("АР нэхэмжлэх: батлалт hook-оор хориглогдоно", { skip: !DB_READY }, async () => {
  await setupOrg();
  const blocked = await tool("create_arap_invoice", {
    documentType: "ar_invoice", counterparty: "Түнш", date: "2025-05-07",
    description: "АР HOOK-BLOCK", lines: [{ account: "51100000", amount: 30_000 }],
  });
  assert.match(blocked.resultText, /M4 custom хориг: AR-25-/, blocked.resultText);
  assert.equal((await postedWith("АР HOOK-BLOCK")).length, 0);
});

test("POS борлуулалт: журнал хориглогдвол борлуулалт бүхэлдээ буцна", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("create_warehouse", { code: "WH1", name: "Дэлгүүр" }));
  ok(await tool("create_inventory_item", { code: "TEA", name: "Цай", unit: "ш", salesPrice: BLOCKED_TOTAL }));
  const settings = await asOrg(() => updatePosSettings({ allowNegativeStock: true }));
  assert.ok(!settings.error, settings.error);
  ok(await tool("open_pos_shift", { cashAccount: "Касс", warehouseCode: "WH1" }));
  const sale = await tool("create_pos_sale", {
    lines: [{ itemCode: "TEA", quantity: 1 }],
    payments: [{ method: "CASH", amount: BLOCKED_TOTAL }],
  });
  assert.match(sale.resultText, /M4 custom хориг: POS-/, sale.resultText);
  assert.equal((await db.query.posSales.findMany({ where: eq(posSales.organizationId, orgId) })).length, 0);
});

test("буцаалт: hook бүгдийг хориглосон ч буцаалтын журнал хаагдахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("create_journal_voucher", {
    date: "2025-05-08",
    description: "Буцаах журнал",
    externalRef: `m4-rev-${STAMP}`,
    lines: [{ account: "11000001", debit: 15_000 }, { account: "51100000", credit: 15_000 }],
  }));
  const [voucher] = await postedWith("Буцаах журнал");
  assert.ok(voucher);
  blockAll = true;
  try {
    const reversed = await asOrg(() => unpostVoucher(voucher.id));
    assert.ok(!reversed.error, reversed.error);
  } finally {
    blockAll = false;
  }
  const storno = afterCalls.find((call) => call.description === "Буцаалт: Буцаах журнал");
  assert.equal(storno?.reversal, true, "afterJournalPost буцаалтыг тэмдэглэнэ");
});

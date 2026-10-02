// Журнал бүр дугаартай (docs/ontology-audit.md M1, CLAUDE.md §2a): POS-ийн бүх
// журнал (борлуулалт, урьдчилсан COGS, төлбөр, буцаалт, буцаан олголт, ээлжийн
// зөрүү, бэлгийн карт) ба ҮХ-ийн сарын нэгтгэсэн элэгдэл `documentNo`-гүй
// бичигддэг байв — журналын жагсаалт/тайланд «—», дугаараар хайхад олдохгүй.
//   • статик: `insert(journalVouchers)` бүрийн `.values({...})`-д `documentNo` ЗААВАЛ;
//   • DB: POS-ийн урсгал «POS-YY-NNNNNN», сарын элэгдэл «FA-YY-NNNNNN».
// DB хэсэг DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { and, eq, isNull, like } from "drizzle-orm";

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
import { closeShift, updatePosSettings } from "../lib/actions/pos";
import { db } from "../lib/db";
import {
  faDepreciationEntries,
  journalVouchers,
  memberships,
  organizationProfile,
  organizations,
  posSales,
  posShifts,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const ROOT = process.cwd();
const SCANNED = ["lib", "app", "custom"];

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** `.values(` нээх хаалтаас тэнцүү хаах хаалт хүртэлх текст. */
function valuesBody(source: string, from: number): string | null {
  const start = source.indexOf(".values(", from);
  if (start < 0) return null;
  let depth = 0;
  for (let index = start + ".values".length; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")" && --depth === 0) return source.slice(start, index + 1);
  }
  return null;
}

test("статик: insert(journalVouchers) бүр documentNo олгоно", () => {
  const missing: string[] = [];
  for (const file of SCANNED.flatMap((dir) => sourceFiles(path.join(ROOT, dir)))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/insert\(journalVouchers\)/g)) {
      const body = valuesBody(source, match.index!);
      const line = source.slice(0, match.index).split("\n").length;
      // `${original.documentNo}` гэх мэт тайлбарын текст тооцогдохгүй — талбар л.
      if (!body || !/\bdocumentNo\s*[:,}]/.test(body))
        missing.push(`${path.relative(ROOT, file)}:${line}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Журналын дугааргүй insert — documentNo: await nextVoucherNo(tx, orgId, "<модуль>", <огноо>) нэмнэ:\n${missing.join("\n")}`
  );
});

// ─── DB ───────────────────────────────────────────────────────────────────────

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
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
    .values({ name: `m1-${STAMP}`, email: `m1-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `M1 ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `M1 ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
}

test("POS: борлуулалт, COGS, төлбөр, буцаалт, ээлжийн зөрүүний журнал POS- дугаартай", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("create_warehouse", { code: "WH1", name: "Дэлгүүр" }));
  ok(await tool("create_inventory_item", { code: "TEA", name: "Цай", unit: "ш", salesPrice: 5_000 }));
  ok(await tool("create_cash_account", { name: "Касс", accountType: "cash", currency: "MNT", glAccount: "10000001" }));
  const settings = await asOrg(() => updatePosSettings({ allowNegativeStock: true }));
  assert.ok(!settings.error, settings.error);
  ok(await tool("open_pos_shift", { cashAccount: "Касс", warehouseCode: "WH1" }));
  const shift = await db.query.posShifts.findFirst({
    where: and(eq(posShifts.organizationId, orgId), eq(posShifts.status, "open")),
  });
  assert.ok(shift);

  ok(await tool("create_pos_sale", { lines: [{ itemCode: "TEA", quantity: 2 }], payments: [{ method: "CASH", amount: 10_000 }] }));
  const sale = await db.query.posSales.findFirst({
    where: and(eq(posSales.organizationId, orgId), eq(posSales.isReturn, false)),
  });
  assert.ok(sale);
  ok(await tool("return_pos_sale", { sale: sale.documentNo, lines: [{ itemCode: "TEA", quantity: 1 }], reason: "M1" }));
  // Тоолсон мөнгө системийнхээс 1,000 илүү — ээлжийн зөрүүний журнал.
  const closed = await asOrg(() => closeShift(shift.id, { countedCash: 6_000 }));
  assert.ok(!closed.error, closed.error);

  const vouchers = await db.query.journalVouchers.findMany({
    where: and(eq(journalVouchers.organizationId, orgId), like(journalVouchers.externalRef, "pos-%")),
  });
  const kinds = new Set(vouchers.map((voucher) => voucher.externalRef!.split(":")[0]));
  for (const kind of ["pos-sale", "pos-pay", "pos-return", "pos-refund", "pos-shift-variance"])
    assert.ok(kinds.has(kind), `${kind} журнал үүссэн (${[...kinds].join(", ")})`);
  for (const voucher of vouchers)
    assert.match(voucher.documentNo ?? "", /^POS-\d{2}-\d{6}$/, `${voucher.externalRef}: "${voucher.documentNo}"`);
  assert.equal(new Set(vouchers.map((voucher) => voucher.documentNo)).size, vouchers.length, "давхардалгүй");
  const unnumbered = await db.query.journalVouchers.findMany({
    where: and(eq(journalVouchers.organizationId, orgId), isNull(journalVouchers.documentNo)),
  });
  assert.deepEqual(unnumbered.map((voucher) => voucher.description), []);
});

test("ҮХ: сарын нэгтгэсэн элэгдлийн журнал FA- дугаартай", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("create_fixed_asset", {
    name: `Компьютер ${STAMP}`, acquisitionDate: "2024-12-10", cost: 1_200_000,
    usefulLifeMonths: 12, depreciationStartMonth: "2025-01", custodian: "Б.Бат",
  }));
  ok(await tool("run_fa_depreciation", { month: "2025-01" }, "draft"));
  ok(await tool("post_fa_depreciation", { month: "2025-01" }));
  const [entry] = await db.query.faDepreciationEntries.findMany({
    where: and(eq(faDepreciationEntries.organizationId, orgId), eq(faDepreciationEntries.periodMonth, "2025-01")),
  });
  assert.ok(entry?.voucherId, "элэгдэл журналтай");
  const voucher = await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, entry.voucherId) });
  assert.match(voucher?.documentNo ?? "", /^FA-25-\d{6}$/, `"${voucher?.documentNo}"`);
});

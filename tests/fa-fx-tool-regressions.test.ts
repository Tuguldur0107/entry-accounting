// AI tool-ын хоёр алдааны DB регресс (ontology аудит §5, 2026-09-30):
//   1. run_fx_revaluation / reverse_fx_revaluation — action-ы { error } үр дүнг
//      шалгалгүй «тэгшитгэгдэв» / «буцаагдлаа» гэж ХУДАЛ хариулдаг байв
//   2. reverse_fa_depreciation — сарын элэгдэл НЭГ журналд (postDepreciationMonth)
//      нэгтгэгддэг ч буцаалт бичилт бүрээр явж, эхний бичилт журналыг бүтнээр нь
//      буцаагаад үлдсэн бичилтүүд «батлагдсан» хэвээр үлддэг байв (GL ≠ дэд
//      дэвтэр); дахин бодолт тэр буцаагдсан журналыг ДАХИН сторно хийдэг байв
// DATABASE_URL шаарддаг; түр байгууллага бодит устгалтын замаар устгагдана.

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
  // патчлагдахгүй орчинд okOrRevalidate fallback ажиллана
}

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { deleteOrganizationForUser } from "../lib/actions/org";
import { reverseDepreciationEntry } from "../lib/actions/fa";
import { db } from "../lib/db";
import {
  cashAccounts,
  cashFxRevaluations,
  faDepreciationEntries,
  fixedAssets,
  journalLines,
  journalVouchers,
  memberships,
  organizations,
  users,
} from "../lib/db/schema";
import { stornoOf } from "../lib/gl/storno";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const cleanup: (() => Promise<void>)[] = [];

let userId = "";
let orgId = "";

function okOrRevalidate(resultText: string): boolean {
  return !resultText.startsWith("Алдаа") || resultText.includes("static generation store");
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `fafx-${STAMP}`, email: `fafx-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `FA/FX регресс ${STAMP}` })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    const current = await db.query.organizations.findFirst({
      where: eq(organizations.id, org.id),
      columns: { name: true },
    });
    assert.ok(current);
    await deleteOrganizationForUser({ orgId: org.id, userId: user.id, confirmName: current.name });
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  const sync = await runAsOrg({ userId, orgId }, () => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
}

function tool(name: string, input: unknown, mode: "draft" | "post" = "draft") {
  return runAsOrg({ userId, orgId }, () => executeAiTool(userId, name, input, mode));
}

/** Дансны (8 оронтой үндсэн код) батлагдсан + буцаагдсан журналын нэт Дт − Кт тухайн огноонд. */
async function glNet(main: string, date: string): Promise<number> {
  const vouchers = await db.query.journalVouchers.findMany({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.date, date)),
    with: { lines: true },
  });
  let net = 0;
  for (const voucher of vouchers) {
    if (voucher.status === "draft") continue;
    for (const line of voucher.lines) {
      const parts = line.accountNumber.split(".");
      const lineMain = parts.length >= 3 ? parts[2] : line.accountNumber;
      if (lineMain === main) net += Number(line.debit) - Number(line.credit);
    }
  }
  return Math.round(net * 100) / 100;
}

async function monthEntries(month: string) {
  return db.query.faDepreciationEntries.findMany({
    where: and(eq(faDepreciationEntries.organizationId, orgId), eq(faDepreciationEntries.periodMonth, month)),
  });
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

// ── 1. Ханшийн тэгшитгэл ────────────────────────────────────────────────────

test("run_fx_revaluation: action алдаа буцаавал «тэгшитгэгдэв» гэж хэлэхгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const created = await tool("create_cash_account", {
    name: "Голомт USD", accountType: "bank", currency: "USD", glAccount: "11000002",
    openingBalance: 1_000, openingDate: "2024-12-31", openingRate: 3420.46,
  });
  assert.ok(okOrRevalidate(created.resultText), created.resultText);

  // Ирээдүйн огноо — action `{ error }` буцаана (шиддэггүй)
  const future = await tool(
    "run_fx_revaluation",
    { valuationDate: "2099-01-31", cashAccount: "Голомт USD", rate: 3500, manualReason: "регресс" },
    "post"
  );
  const account = await db.query.cashAccounts.findFirst({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.name, "Голомт USD")),
  });
  const rows = await db.query.cashFxRevaluations.findMany({
    where: eq(cashFxRevaluations.cashAccountId, account!.id),
  });
  assert.equal(rows.length, 0, "тэгшитгэл бичигдээгүй");
  assert.doesNotMatch(future.resultText, /тэгшитгэгдэв/, future.resultText);
  assert.match(future.resultText, /0\/1 данс/, future.resultText);
  assert.match(future.resultText, /АЛДАА — Ирээдүйн огноонд/, future.resultText);
  assert.doesNotMatch(future.resultText, /Журналууд шууд бичигдсэн/, "журнал бичигдээгүйг худлаа хэлэхгүй");
});

test("reverse_fx_revaluation: action алдаа буцаавал «буцаагдлаа» гэж хэлэхгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const jan = await tool(
    "run_fx_revaluation",
    { valuationDate: "2025-01-31", cashAccount: "Голомт USD", rate: 3448.24, manualReason: "регресс" },
    "post"
  );
  assert.match(jan.resultText, /1\/1 данс/, jan.resultText);
  const feb = await tool(
    "run_fx_revaluation",
    { valuationDate: "2025-02-28", cashAccount: "Голомт USD", rate: 3460, manualReason: "регресс" },
    "post"
  );
  assert.match(feb.resultText, /1\/1 данс/, feb.resultText);

  // 1-р сарынх хамгийн сүүлийнх биш — action `{ error }` буцаана
  const reversed = await tool("reverse_fx_revaluation", { cashAccount: "Голомт USD", valuationDate: "2025-01-31" }, "post");
  assert.doesNotMatch(reversed.resultText, /буцаагдлаа/, reversed.resultText);
  assert.match(reversed.resultText, /Зөвхөн хамгийн сүүлийн тэгшитгэлийг буцаана/, reversed.resultText);
  const account = await db.query.cashAccounts.findFirst({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.name, "Голомт USD")),
  });
  const janRow = await db.query.cashFxRevaluations.findFirst({
    where: and(
      eq(cashFxRevaluations.cashAccountId, account!.id),
      eq(cashFxRevaluations.valuationDate, "2025-01-31")
    ),
  });
  assert.equal(janRow?.status, "posted", "1-р сарынх хөндөгдөөгүй");

  // Сүүлийнх нь буцаагдана
  const ok = await tool("reverse_fx_revaluation", { cashAccount: "Голомт USD", valuationDate: "2025-02-28" }, "post");
  assert.match(ok.resultText, /буцаагдлаа/, ok.resultText);
});

// ── 2. Элэгдлийн буцаалт (сарын нэгтгэсэн журнал) ───────────────────────────

async function setupAssets() {
  const existing = await db.query.fixedAssets.findMany({
    where: and(eq(fixedAssets.organizationId, orgId), eq(fixedAssets.status, "active")),
  });
  if (existing.length > 0) return;
  for (const name of ["Компьютер А", "Компьютер Б", "Принтер В"]) {
    const created = await tool(
      "create_fixed_asset",
      { name, acquisitionDate: "2024-12-10", cost: 1_200_000, usefulLifeMonths: 12, depreciationStartMonth: "2025-01", custodian: "Б.Бат" },
      "post"
    );
    assert.ok(okOrRevalidate(created.resultText), created.resultText);
  }
  const assets = await db.query.fixedAssets.findMany({
    where: and(eq(fixedAssets.organizationId, orgId), eq(fixedAssets.status, "active")),
  });
  assert.equal(assets.length, 3);
}

async function runAndPost(month: string) {
  const ran = await tool("run_fa_depreciation", { month });
  assert.ok(okOrRevalidate(ran.resultText), ran.resultText);
  const posted = await tool("post_fa_depreciation", { month }, "post");
  assert.ok(okOrRevalidate(posted.resultText), posted.resultText);
}

test("reverse_fa_depreciation: сарын нэгтгэсэн журнал НЭГ удаа буцаагдаж, бүх бичилт «буцаагдсан»", { skip: !DB_READY }, async () => {
  await setupOrg();
  await setupAssets();
  await runAndPost("2025-01");
  const before = await monthEntries("2025-01");
  assert.equal(before.length, 3);
  assert.equal(new Set(before.map((entry) => entry.voucherId)).size, 1, "нэг журнал");
  assert.equal(await glNet("70000001", "2025-01-28"), 300_000);

  // Нэг хөрөнгөөр буцаах нь нэгтгэсэн журналд ХОРИОТОЙ (журнал бүтнээр буцаж бусад бичилт үлддэг байв)
  const single = await runAsOrg({ userId, orgId }, () => reverseDepreciationEntry(before[0].id));
  assert.match(single.error ?? "", /нэгтгэсэн журналд \(3 хөрөнгө\)/, JSON.stringify(single));
  assert.ok((await monthEntries("2025-01")).every((entry) => entry.status === "posted"), "юу ч өөрчлөгдөөгүй");

  const reversed = await tool("reverse_fa_depreciation", { month: "2025-01" }, "post");
  assert.ok(okOrRevalidate(reversed.resultText), reversed.resultText);
  assert.match(reversed.resultText, /3 бичилт/, reversed.resultText);

  const after = await monthEntries("2025-01");
  assert.deepEqual(after.map((entry) => entry.status), ["reversed", "reversed", "reversed"], "дэд дэвтэр GL-тэй таарна");
  const voucherId = before[0].voucherId!;
  const reversals = await db.query.journalVouchers.findMany({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.reversalOfVoucherId, voucherId)),
  });
  assert.equal(reversals.length, 1, "журнал НЭГ л удаа буцаагдана");
  assert.ok(reversals[0].documentNo, "буцаалтын журнал дугаартай");
  assert.ok(after.every((entry) => entry.reversalVoucherId === reversals[0].id));
  assert.equal(await glNet("70000001", "2025-01-28"), 0, "GL-д элэгдэл үлдээгүй");
  assert.equal(await glNet("20000002", "2025-01-28"), 0);

  // Буцаасны дараа дахин бодоод батлахад ердийн журнал үүснэ
  await runAndPost("2025-01");
  assert.equal(await glNet("70000001", "2025-01-28"), 300_000);
});

test("Хуучин зөрчилтэй төлөв (журнал буцаагдсан ч бичилт «батлагдсан») — давхар сторно хийхгүй, засна", { skip: !DB_READY }, async () => {
  await setupOrg();
  await setupAssets();
  await runAndPost("2025-02");
  const entries = await monthEntries("2025-02");
  const posted = entries.filter((entry) => entry.status === "posted");
  assert.equal(posted.length, 3);
  const voucherId = posted[0].voucherId!;

  // Засварын өмнөх алдааны үлдээдэг төлөвийг дуурайна: журналыг бүтнээр
  // буцаагаад зөвхөн НЭГ бичилтийг «буцаагдсан» болгоно.
  const voucher = await db.query.journalVouchers.findFirst({
    where: eq(journalVouchers.id, voucherId),
    with: { lines: true },
  });
  const [legacyReversal] = await db
    .insert(journalVouchers)
    .values({
      userId, organizationId: orgId, date: voucher!.date, description: `Буцаалт: ${voucher!.description}`,
      status: "posted", reversalOfVoucherId: voucherId,
    })
    .returning({ id: journalVouchers.id });
  await db.insert(journalLines).values(
    voucher!.lines.map((line, index) => ({
      voucherId: legacyReversal.id, accountNumber: line.accountNumber,
      ...stornoOf({ debit: line.debit, credit: line.credit }), description: line.description, sortOrder: index,
    }))
  );
  await db.update(journalVouchers).set({ status: "reversed" }).where(eq(journalVouchers.id, voucherId));
  await db
    .update(faDepreciationEntries)
    .set({ status: "reversed", reversalVoucherId: legacyReversal.id })
    .where(eq(faDepreciationEntries.id, posted[0].id));
  assert.equal(await glNet("70000001", "2025-02-28"), 0, "GL-д буцаагдсан");

  // reverse_fa_depreciation үлдсэн 2 бичилтийг GL хөндөлгүй засна
  const repaired = await tool("reverse_fa_depreciation", { month: "2025-02" }, "post");
  assert.ok(okOrRevalidate(repaired.resultText), repaired.resultText);
  const afterRepair = await monthEntries("2025-02");
  assert.ok(afterRepair.every((entry) => entry.status === "reversed"), "бүх бичилт буцаагдсан");
  assert.ok(afterRepair.every((entry) => entry.reversalVoucherId === legacyReversal.id), "байгаа буцаалттай холбогдоно");
  const reversals = await db.query.journalVouchers.findMany({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.reversalOfVoucherId, voucherId)),
  });
  assert.equal(reversals.length, 1, "шинэ сторно үүсээгүй");
  assert.equal(await glNet("70000001", "2025-02-28"), 0, "GL давхар буцаагдаагүй (сөрөг биш)");
});

test("Дахин бодолт (run_fa_depreciation) буцаагдсан журналыг ДАХИН сторно хийхгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  await setupAssets();
  await runAndPost("2025-03");
  const posted = (await monthEntries("2025-03")).filter((entry) => entry.status === "posted");
  const voucherId = posted[0].voucherId!;
  // Мөн хуучин зөрчилтэй төлөв: журнал буцаагдсан, бичилтүүд «батлагдсан»
  const voucher = await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, voucherId), with: { lines: true } });
  const [legacyReversal] = await db
    .insert(journalVouchers)
    .values({ userId, organizationId: orgId, date: voucher!.date, description: "Буцаалт", status: "posted", reversalOfVoucherId: voucherId })
    .returning({ id: journalVouchers.id });
  await db.insert(journalLines).values(
    voucher!.lines.map((line, index) => ({
      voucherId: legacyReversal.id, accountNumber: line.accountNumber,
      ...stornoOf({ debit: line.debit, credit: line.credit }), description: line.description, sortOrder: index,
    }))
  );
  await db.update(journalVouchers).set({ status: "reversed" }).where(eq(journalVouchers.id, voucherId));

  // Батлагдсан бичилттэй сарыг дахин бодох = батлах үйлдэл → «Шууд бичих» горим.
  const ran = await tool("run_fa_depreciation", { month: "2025-03" }, "post");
  assert.ok(okOrRevalidate(ran.resultText), ran.resultText);
  const reversals = await db.query.journalVouchers.findMany({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.reversalOfVoucherId, voucherId)),
  });
  assert.equal(reversals.length, 1, "дахин бодолт шинэ сторно үүсгээгүй");
  assert.equal(await glNet("70000001", "2025-03-28"), 0, "GL сөрөг болоогүй");
  const old = await db.query.faDepreciationEntries.findMany({
    where: and(eq(faDepreciationEntries.organizationId, orgId), inArray(faDepreciationEntries.id, posted.map((entry) => entry.id))),
  });
  assert.ok(old.every((entry) => entry.status === "reversed" && entry.reversalVoucherId === legacyReversal.id));
});

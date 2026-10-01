// AI/MCP-ийн эрх, хязгаарын цоорхой (docs/ontology-audit.md §4.2):
//   • update_counterparty — server action-гүй, db.update ШУУД: эрх шалгахгүй
//     (viewer ч нийлүүлэгчийн банкны дансыг сольж чадна — луйврын зам),
//     аудитын мөр бичихгүй
//   • run_fa_depreciation — батлагдсан сарын элэгдлийг журналаар БУЦААЖ
//     батална, гэхдээ ноорог горимд ч, хязгааргүй, fa:write эрхээр
//   • import_bank_statement — хаагдсан тайлант үед GL бичнэ, батлах хязгааргүй,
//     модулийн эрх биш role-оор (cash:write override-той гишүүн ч батална)
// DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
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
import {
  accountingPeriods,
  auditEvents,
  bankStatements,
  counterparties,
  faDepreciationEntries,
  journalVouchers,
  memberships,
  organizationProfile,
  organizations,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let ownerId = "";
let orgId = "";
const members: Record<string, string> = {};
const cleanup: (() => Promise<void>)[] = [];

const toolAs = (userId: string, name: string, input: unknown, mode: "draft" | "post" = "post") =>
  runAsOrg({ userId, orgId }, () => executeAiTool(userId, name, input, mode));
const tool = (name: string, input: unknown, mode: "draft" | "post" = "post") => toolAs(ownerId, name, input, mode);
function ok<T extends { resultText: string }>(result: T) {
  assert.ok(
    !result.resultText.startsWith("Алдаа") || result.resultText.includes("static generation store"),
    result.resultText
  );
  return result;
}
const failed = (result: { resultText: string }) => result.resultText.startsWith("Алдаа");

async function addMember(key: string, role: "viewer" | "accountant", permissions?: Record<string, string>) {
  const [user] = await db
    .insert(users)
    .values({ name: `gap-${key}-${STAMP}`, email: `gap-${key}-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  await db.insert(memberships).values({
    organizationId: orgId,
    userId: user.id,
    role,
    permissions: permissions ? JSON.stringify(permissions) : null,
  });
  cleanup.push(async () => {
    await db.delete(users).where(eq(users.id, user.id));
  });
  members[key] = user.id;
  return user.id;
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `gap-${STAMP}`, email: `gap-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `AI цоорхой ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  ownerId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId: ownerId, organizationId: orgId, name: `AI цоорхой ${STAMP}` });
  const sync = await runAsOrg({ userId: ownerId, orgId }, () => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
  ok(await tool("create_counterparty", { name: "Нийлүүлэгч", counterpartyType: "supplier", bankAccountNo: "100200300" }));
  ok(await tool("create_cash_account", { name: "Банк", accountType: "bank", currency: "MNT", glAccount: "11000001" }));
  await addMember("viewer", "viewer");
  await addMember("readAp", "accountant", { ar: "read", ap: "read" });
  await addMember("faWrite", "accountant", { fa: "write" });
  await addMember("cashWrite", "accountant", { cash: "write" });
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

test("update_counterparty: AR/AP-д бичих эрхгүй гишүүн засаж чадахгүй, засвар аудиттай", { skip: !DB_READY }, async () => {
  await setupOrg();
  for (const key of ["viewer", "readAp"]) {
    const result = await toolAs(members[key], "update_counterparty", { counterparty: "Нийлүүлэгч", bankAccountNo: `999-${key}` });
    assert.ok(failed(result), `${key}: ${result.resultText}`);
  }
  const unchanged = await db.query.counterparties.findFirst({
    where: and(eq(counterparties.organizationId, orgId), eq(counterparties.name, "Нийлүүлэгч")),
  });
  assert.equal(unchanged?.bankAccountNo, "100200300", "банкны данс хөндөгдөөгүй");

  ok(await tool("update_counterparty", { counterparty: "Нийлүүлэгч", bankAccountNo: "555666777", phone: "99112233" }));
  const audit = await db.query.auditEvents.findFirst({
    where: and(eq(auditEvents.organizationId, orgId), eq(auditEvents.entityType, "counterparty"), eq(auditEvents.action, "update")),
  });
  assert.ok(audit, "засварын аудит");
  assert.match(audit!.summary, /bankAccountNo/);
  assert.doesNotMatch(audit!.summary, /555666777/, "банкны дансны утга аудитын текстэд гарахгүй");
});

test("run_fa_depreciation: батлагдсан сарыг буцаах нь шууд горим + хязгаар + fa:post", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(
    await tool("create_fixed_asset", {
      name: "Сервер",
      acquisitionDate: "2025-01-05",
      cost: 12_000_000,
      usefulLifeMonths: 12,
      custodian: "IT",
    })
  );
  ok(await tool("run_fa_depreciation", { month: "2025-02" }));
  ok(await tool("post_fa_depreciation", { month: "2025-02" }));
  const postedVouchers = async () =>
    (
      await db.query.faDepreciationEntries.findMany({
        where: and(eq(faDepreciationEntries.organizationId, orgId), eq(faDepreciationEntries.periodMonth, "2025-02")),
      })
    ).filter((entry) => entry.status === "posted");
  assert.equal((await postedVouchers()).length, 1);

  // Ноорог горим — батлагдсаныг буцааж журнал батлахгүй.
  const draftMode = await tool("run_fa_depreciation", { month: "2025-02" }, "draft");
  assert.match(draftMode.resultText, /DIRECT_MODE_REQUIRED/, draftMode.resultText);
  // fa:write эрхтэй гишүүн — буцаалт = батлах эрх.
  const writer = await toolAs(members.faWrite, "run_fa_depreciation", { month: "2025-02" });
  assert.match(writer.resultText, /^Алдаа.*эрх/, writer.resultText);
  // Хязгаар: 1 сая ₮ элэгдэл > 500 мянга.
  ok(await tool("update_company_settings", { aiPostLimitMnt: 500_000 }));
  const overLimit = await tool("run_fa_depreciation", { month: "2025-02" });
  assert.match(overLimit.resultText, /AMOUNT_LIMIT_EXCEEDED/, overLimit.resultText);
  assert.equal((await postedVouchers()).length, 1, "батлагдсан элэгдэл хэвээр");
  ok(await tool("update_company_settings", { aiPostLimitMnt: 10_000_000 }));

  // Батлагдаагүй сар — fa:write эрх, ноорог горим хангалттай (регресс биш).
  ok(await toolAs(members.faWrite, "run_fa_depreciation", { month: "2025-03" }, "draft"));

  // Шууд горимд хязгаар дотор — дахин бодоод буцаалтаа ИЛ хэлнэ.
  const rerun = ok(await tool("run_fa_depreciation", { month: "2025-02" }));
  assert.match(rerun.resultText, /буцаа/i, rerun.resultText);
});

test("import_bank_statement: хаагдсан үе, хязгаар, cash:post эрх", { skip: !DB_READY }, async () => {
  await setupOrg();
  await db.insert(accountingPeriods).values({
    userId: ownerId,
    organizationId: orgId,
    code: "2024-11",
    startDate: "2024-11-01",
    endDate: "2024-11-30",
    status: "closed",
  });
  const statements = async () => (await db.query.bankStatements.findMany({ where: eq(bankStatements.organizationId, orgId) })).length;
  const before = await statements();
  const row = (date: string, income: number) => ({ date, income, counterGlAccount: "51100000", description: `орлого ${date}` });

  const closed = await tool("import_bank_statement", { cashAccount: "Банк", rows: [row("2024-11-15", 10_000)] });
  assert.ok(failed(closed), `хаагдсан үе: ${closed.resultText}`);
  assert.match(closed.resultText, /хаагдсан|хаалттай/i);

  ok(await tool("update_company_settings", { aiPostLimitMnt: 1_000_000 }));
  const overLimit = await tool("import_bank_statement", { cashAccount: "Банк", rows: [row("2025-03-10", 5_000), row("2025-03-11", 2_000_000)] });
  assert.match(overLimit.resultText, /AMOUNT_LIMIT_EXCEEDED/, overLimit.resultText);
  ok(await tool("update_company_settings", { aiPostLimitMnt: 10_000_000 }));

  const writer = await toolAs(members.cashWrite, "import_bank_statement", { cashAccount: "Банк", rows: [row("2025-03-12", 7_000)] });
  assert.match(writer.resultText, /^Алдаа.*эрх/, `cash:write: ${writer.resultText}`);
  assert.equal(await statements(), before, "нэг ч хуулга бичигдээгүй");

  ok(await tool("import_bank_statement", { cashAccount: "Банк", rows: [row("2025-03-13", 8_000)] }));
  assert.equal(await statements(), before + 1);
  const vouchers = await db.query.journalVouchers.findMany({ where: eq(journalVouchers.organizationId, orgId) });
  assert.ok(vouchers.every((voucher) => !voucher.date.startsWith("2024-11")), "хаагдсан сард журнал алга");
});

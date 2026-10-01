// Цалингийн журналын буцаалт (docs/ontology-audit.md H5).
// Өмнө нь AI/хэрэглэгч сарын цалингийн журналыг GL-ээс `reverse_journal_voucher`
// / «Буцаах»-аар буцаавал payroll_runs.voucherId хэвээр үлдэж:
//   • дахин бодох — «GL журнал аль хэдийн үүссэн» гэж хориглогддог,
//   • буцаагдсан журналыг устгах — [USE_REVERSAL],
//   • шинэ журнал — externalRef `payroll:YYYY-MM` давхардаж хуучныг буцаадаг
// тул тэр сар бүрмөсөн ГАЦДАГ байв. Одоо GL-ийн буцаалт хаалттай, Цалин
// модулийн `reversePayrollVoucher` л буцаана (улаан сторно, бодолт ноорог).
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
import { postVoucher, syncStandardAccounts, unpostVoucher } from "../lib/actions/gl";
import { calculatePayrollRun, createPayrollVoucher, reversePayrollVoucher } from "../lib/actions/payroll";
import { db } from "../lib/db";
import {
  journalLines,
  journalVouchers,
  memberships,
  organizationProfile,
  organizations,
  payrollRuns,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const PERIOD = "2025-04";
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, input: unknown) => asOrg(() => executeAiTool(userId, name, input, "post"));
const loadRun = () =>
  db.query.payrollRuns.findFirst({
    where: and(eq(payrollRuns.organizationId, orgId), eq(payrollRuns.periodMonth, PERIOD)),
  });

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function setupOrg() {
  const [user] = await db
    .insert(users)
    .values({ name: `h5-${STAMP}`, email: `h5-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `H5 ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `H5 ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
  await tool("create_employee", { name: "Бат", position: "Нягтлан", baseSalary: 2_000_000 });
  const calc = await asOrg(() => calculatePayrollRun(PERIOD));
  assert.ok(!("error" in calc && calc.error), JSON.stringify(calc));
}

test("цалингийн журнал: GL-ээс буцаахгүй, Цалин модулиас буцааж дахин бодно", { skip: !DB_READY }, async () => {
  await setupOrg();
  const created = await asOrg(() => createPayrollVoucher(PERIOD));
  assert.ok(!created.error, created.error);
  const voucherId = (await loadRun())!.voucherId!;
  const posted = await asOrg(() => postVoucher(voucherId));
  assert.ok(!posted.error, posted.error);

  // GL талаас — хоёр замаар ч хаалттай, Цалин модуль руу чиглүүлнэ.
  const viaGl = await asOrg(() => unpostVoucher(voucherId));
  assert.match(viaGl.error ?? "", /PAYROLL_OWNED/);
  const viaAi = await tool("reverse_journal_voucher", { voucherId });
  assert.match(viaAi.resultText, /PAYROLL_OWNED/);
  assert.equal((await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, voucherId) }))?.status, "posted");

  // Цалин модулиас — улаан сторно, бодолт ноорог руу.
  const reversed = await asOrg(() => reversePayrollVoucher(PERIOD));
  assert.ok(!reversed.error, reversed.error);
  const original = await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, voucherId) });
  assert.equal(original?.status, "reversed");
  assert.match(original?.externalRef ?? "", new RegExp(`^payroll:${PERIOD}:reversed:`));
  const storno = await db.query.journalVouchers.findFirst({
    where: eq(journalVouchers.reversalOfVoucherId, voucherId),
    with: { lines: true },
  });
  assert.equal(storno?.status, "posted");
  assert.equal(storno?.date, original?.date, "эх огноогоор");
  const originalLines = await db.query.journalLines.findMany({ where: eq(journalLines.voucherId, voucherId) });
  const net = (side: "debit" | "credit") =>
    originalLines.reduce((sum, line) => sum + Number(line[side]), 0) +
    storno!.lines.reduce((sum, line) => sum + Number(line[side]), 0);
  assert.equal(Math.round(net("debit")), 0, "GL-д цэвэр 0");
  assert.ok(storno!.lines.every((line) => Number(line.debit) <= 0 && Number(line.credit) <= 0), "улаан сторно — сөрөг, тал солихгүй");
  const run = await loadRun();
  assert.equal(run?.voucherId, null);
  assert.equal(run?.status, "draft");

  // Дахин бодож ШИНЭ журнал үүсгэнэ (хуучныг dedup-аар буцаахгүй).
  const recalc = await asOrg(() => calculatePayrollRun(PERIOD));
  assert.ok(!("error" in recalc && recalc.error), JSON.stringify(recalc));
  const again = await asOrg(() => createPayrollVoucher(PERIOD));
  assert.ok(!again.error, again.error);
  assert.equal(again.dedup, undefined);
  assert.notEqual(again.id, voucherId);
  assert.equal((await loadRun())?.voucherId, again.id);

  // Ноорог журнал — Цалин модулиас устгагдана.
  const draftReverse = await asOrg(() => reversePayrollVoucher(PERIOD));
  assert.ok(!draftReverse.error, draftReverse.error);
  assert.equal(await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, again.id!) }), undefined);
  assert.equal((await loadRun())?.voucherId, null);
});

test("цалингийн журнал: өмнө нь GL-ээс буцааж ГАЦСАН сарыг суллана", { skip: !DB_READY }, async () => {
  const run = await loadRun();
  assert.ok(run, "өмнөх тестийн бодолт");
  const created = await asOrg(() => createPayrollVoucher(PERIOD));
  assert.ok(!created.error, created.error);
  const voucherId = (await loadRun())!.voucherId!;
  assert.ok(!(await asOrg(() => postVoucher(voucherId))).error);
  // Засварын өмнөх GL-ийн буцаалтыг дуурайна: эх нь reversed, бодолт холбоотой хэвээр.
  await db.update(journalVouchers).set({ status: "reversed" }).where(eq(journalVouchers.id, voucherId));

  const released = await asOrg(() => reversePayrollVoucher(PERIOD));
  assert.ok(!released.error, released.error);
  assert.equal(released.reversalId, null, "дахин сторно хийхгүй");
  assert.equal((await loadRun())?.voucherId, null);
  const again = await asOrg(() => createPayrollVoucher(PERIOD));
  assert.ok(!again.error && !again.dedup, JSON.stringify(again));
});

// Журналын DB түвшний хамгаалалт (scripts/lib/ledger-invariants.mjs) — deploy
// бүрд push-ийн ДАРАА тавигдана (2026-10-01 P0: SmartGPS DB-д огт байгаагүй,
// SaaS-ийн Дт/Кт constraint-ийг push устгадаг байсан).
//   • төлөвлөгөө: зөрчилтэй DB дээр тухайн хамгаалалтыг алгасна, чанга анхааруулна
//   • db:predeploy-д push-ийн ДАРАА бүртгэлтэй
//   • DB: идемпотент тавилт; тэнцээгүй / Дт+Кт мөр / батлагдсан мөрийн засвар
//     ХОРИГЛОГДОНО; журналыг бүтнээр нь устгах, байгууллага устгах саадгүй
// DB хэсэг DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import postgres from "postgres";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд алгасна
}

import {
  LEDGER_CONSTRAINT_NAME,
  LEDGER_TRIGGER_NAMES,
  applyLedgerInvariants,
  planLedgerInvariants,
} from "../scripts/lib/ledger-invariants.mjs";
import { LEDGER_GUARD_CONSTRAINT, LEDGER_GUARD_TRIGGERS, ledgerGuardStatus } from "../lib/db/ledger-guard-status";
import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { db } from "../lib/db";
import { journalLines, journalVouchers, memberships, organizations, users } from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);

test("төлөвлөгөө: цэвэр DB-д бүх хамгаалалт, анхааруулгагүй", () => {
  assert.deepEqual(planLedgerInvariants({ imbalancedVouchers: 0, dualSidedLines: 0 }), {
    constraint: true,
    balanceTriggers: true,
    protectTrigger: true,
    warnings: [],
  });
});

test("төлөвлөгөө: зөрчилтэй DB-д тухайн хамгаалалтыг алгасаж, ил анхааруулна", () => {
  const dual = planLedgerInvariants({ imbalancedVouchers: 0, dualSidedLines: 3 });
  assert.equal(dual.constraint, false);
  assert.equal(dual.balanceTriggers, true);
  assert.match(dual.warnings.join("\n"), /3 журналын мөрөнд Дт, Кт зэрэг/);

  const imbalanced = planLedgerInvariants({ imbalancedVouchers: 2, dualSidedLines: 0 });
  assert.equal(imbalanced.balanceTriggers, false);
  assert.equal(imbalanced.constraint, true);
  assert.match(imbalanced.warnings.join("\n"), /2 батлагдсан журнал тэнцээгүй/);

  // Мөрийн хамгаалалт өгөгдлөөс хамаарахгүй — үргэлж.
  assert.equal(planLedgerInvariants({ imbalancedVouchers: 9, dualSidedLines: 9 }).protectTrigger, true);
});

test("health-ийн нэрс скрипттэй ИЖИЛ", () => {
  assert.deepEqual([...LEDGER_GUARD_TRIGGERS], [...LEDGER_TRIGGER_NAMES]);
  assert.equal(LEDGER_GUARD_CONSTRAINT, LEDGER_CONSTRAINT_NAME);
});

test("db:predeploy: хамгаалалт push-ийн ДАРАА (push CHECK-ийг устгадаг)", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const steps = String(pkg.scripts["db:predeploy"]).split("&&").map((s) => s.trim());
  const push = steps.findIndex((s) => s.startsWith("drizzle-kit push"));
  const ledger = steps.indexOf("node scripts/apply-ledger-invariants.mjs");
  assert.ok(push >= 0 && ledger > push, steps.join(" | "));
});

// ─── DB ──────────────────────────────────────────────────────────────────────

let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];
const tool = (name: string, input: unknown) =>
  runAsOrg({ userId, orgId }, () => executeAiTool(userId, name, input, "post"));

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `ledger-${STAMP}`, email: `ledger-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `Журналын хамгаалалт ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  userId = user.id;
  orgId = org.id;
  // Байгууллага устгах нь хамгаалалттай DB-д ч саадгүй (батлагдсан журнал,
  // кассын тэмдэгтэй мөр cascade/set null-оор) — алдаа гарвал энд унана.
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  const sync = await runAsOrg({ userId, orgId }, () => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

// drizzle нь Postgres-ийн алдааг "Failed query …" болгож эхийг `cause`-д хадгална.
function dbError(pattern: RegExp) {
  return (error: Error & { cause?: { message?: string; constraint_name?: string } }) => {
    const text = [error.message, error.cause?.message, error.cause?.constraint_name].join(" ");
    assert.match(text, pattern);
    return true;
  };
}

async function postedVoucher(lines: { debit: string; credit: string }[]) {
  return db.transaction(async (tx) => {
    const [voucher] = await tx
      .insert(journalVouchers)
      .values({ userId, organizationId: orgId, date: "2025-03-10", description: `ledger ${STAMP}`, status: "posted" })
      .returning({ id: journalVouchers.id });
    await tx.insert(journalLines).values(
      lines.map((line, index) => ({
        voucherId: voucher.id,
        accountNumber: index % 2 === 0 ? "11000001" : "51100000",
        debit: line.debit,
        credit: line.credit,
        sortOrder: index,
      }))
    );
    return voucher.id;
  });
}

test("DB: тавилт идемпотент — trigger 3, Дт xor Кт constraint", { skip: !DB_READY }, async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const log: string[] = [];
    const triggerOids = async () =>
      (await sql.unsafe(`select tgname, oid::text from pg_trigger where tgname like 'ea_journal%' order by 1`)).map(
        (row) => `${row.tgname}:${row.oid}`
      );
    let before: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      const result = await applyLedgerInvariants(sql, (line) => log.push(line));
      assert.equal(result.failures, 0, log.join("\n"));
      assert.equal(result.skipped, 0, log.join("\n"));
      assert.deepEqual(result.status, { triggers: 3, expectedTriggers: 3, drXorCr: true });
      if (run === 0) before = await triggerOids();
    }
    // Хоёр дахь удаад trigger-ийг ДАХИН үүсгэхгүй (апп ажиллаж байх зуур
    // journal_lines-ийг deploy бүрд түгжихгүй).
    assert.deepEqual(await triggerOids(), before);
    assert.match(log.slice(-3).join("\n"), /батлагдсан мөрийн хамгаалалт: бий/);
    // /api/health → ledger
    assert.deepEqual(await ledgerGuardStatus(), { ok: true, triggers: 3, expectedTriggers: 3, drXorCr: true });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("DB: тэнцээгүй, Дт+Кт нэг мөр, батлагдсан мөрийн засвар ХОРИГЛОГДОНО", { skip: !DB_READY }, async () => {
  await setupOrg();
  await assert.rejects(postedVoucher([{ debit: "1000", credit: "0" }, { debit: "0", credit: "900" }]), dbError(/тэнцэхгүй/));
  await assert.rejects(postedVoucher([{ debit: "500", credit: "500" }]), dbError(new RegExp(LEDGER_CONSTRAINT_NAME)));

  const id = await postedVoucher([{ debit: "1000", credit: "0" }, { debit: "0", credit: "1000" }]);
  // Улаан сторно (сөрөг дүн) зөвшөөрөгдөнө — тэмдгийг хязгаарлахгүй.
  const storno = await postedVoucher([{ debit: "-1000", credit: "0" }, { debit: "0", credit: "-1000" }]);
  assert.ok(storno);
  await assert.rejects(
    db.update(journalLines).set({ debit: "2000" }).where(eq(journalLines.voucherId, id)),
    dbError(/Батлагдсан журналын мөрийг/)
  );
  await assert.rejects(db.delete(journalLines).where(eq(journalLines.voucherId, id)), dbError(/Батлагдсан журналын мөрийг/));

  // Журналыг БҮТНЭЭР нь устгах (тайлант үе нээлттэй үеийн батлагдсан баримтын устгалт) саадгүй.
  await db.delete(journalVouchers).where(eq(journalVouchers.id, id));
  assert.equal(await db.query.journalLines.findFirst({ where: eq(journalLines.voucherId, id) }), undefined);
});

test("DB: кассын тэмдэгтэй батлагдсан журналтай байгууллага устгагдана", { skip: !DB_READY }, async () => {
  await setupOrg();
  const account = await tool("create_cash_account", { name: "Банк", accountType: "bank", currency: "MNT", glAccount: "11000001" });
  assert.ok(!account.resultText.startsWith("Алдаа") || account.resultText.includes("static generation store"), account.resultText);
  const receipt = await tool("create_cash_transaction", {
    documentType: "receipt",
    cashAccount: "Банк",
    date: "2025-03-12",
    amount: 50_000,
    counterAccount: "51100000",
    description: "хамгаалалт",
    externalRef: `ledger-${STAMP}`,
  });
  assert.ok(!receipt.resultText.startsWith("Алдаа") || receipt.resultText.includes("static generation store"), receipt.resultText);
  const tagged = await db.query.journalLines.findMany({
    where: (line, { isNotNull }) => isNotNull(line.cashAccountId),
    with: { voucher: { columns: { organizationId: true, status: true } } },
  });
  assert.ok(
    tagged.some((line) => line.voucher.organizationId === orgId && line.voucher.status === "posted"),
    "кассын тэмдэгтэй батлагдсан мөр үүссэн"
  );
  // Устгалт test.after-т (purgeOrganization) — унавал тест унана.
});

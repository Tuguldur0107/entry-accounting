// ENT-065: авлагын ECL нөөц + найдваргүй авлага хасах/сэргээх — DB integration.
// D-ECL-1 (12000099 / 87000002), D-ECL-2 (matrix), D-ECL-3 (DTA), D-ECL-4
// (сэргэлт → зардал бууруулна). DATABASE_URL шаарддаг.

import "./helpers/load-env";

import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { and, eq, like } from "drizzle-orm";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд алгасна
}

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { postVoucher, syncStandardAccounts } from "../lib/actions/gl";
import { reverseArApOffset } from "../lib/actions/arap";
import {
  getEclOverview,
  recoverArApWriteOff,
  reverseArApWriteOff,
  runEclProvision,
  saveEclSettings,
  writeOffArApDocument,
} from "../lib/actions/arap-ecl";
import { creditBalanceOf, loadEclSettings } from "../lib/arap/ecl-db";
import { db } from "../lib/db";
import {
  arApDocuments,
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
const tool = (name: string, input: unknown) => asOrg(() => executeAiTool(userId, name, input, "post"));
function ok<T extends { error?: string }>(result: T, label: string) {
  assert.equal(result.error, undefined, `${label}: ${result.error}`);
  return result as Extract<T, { error?: undefined }>;
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `ecl-${STAMP}`, email: `ecl-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `ECL ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId: user.id, organizationId: org.id, name: `ECL ${STAMP}` });
  ok(await asOrg(() => syncStandardAccounts()), "стандарт данс");
  const created = await tool("create_counterparty", { name: `Худалдан авагч ${STAMP}`, counterpartyType: "customer" });
  assert.ok(!created.resultText.startsWith("Алдаа"), created.resultText);
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function invoice(ref: string, date: string, dueDate: string, amount: number) {
  const result = await tool("create_arap_invoice", {
    documentType: "ar_invoice",
    counterparty: `Худалдан авагч ${STAMP}`,
    date,
    dueDate,
    description: `ECL тест ${ref}`,
    externalRef: `${ref}-${STAMP}`,
    lines: [{ account: "51100000", amount }],
  });
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  const doc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `${ref}-${STAMP}`)),
  });
  assert.equal(doc?.status, "posted");
  return doc!;
}

test("ENT-065: ECL нөөц (ноорог, дахин ажиллуулахад солигдоно) + DTA; хасалт → сэргэлт → буцаалт", { skip: !DB_READY }, async () => {
  await setupOrg();
  const old = await invoice("a", "2025-06-01", "2025-06-30", 1_000_000); // 427 хоног → 100%
  const fresh = await invoice("b", "2026-07-15", "2026-08-01", 2_000_000); // 30 хоног → 1%
  const settings = await asOrg(() => loadEclSettings(orgId));
  assert.equal(settings.allowanceAccountNumber, "12000099");
  assert.equal(settings.expenseAccountNumber, "87000002");
  assert.equal(settings.taxRatePct, null);

  // Ноорог — ААНОАТ-ын хувьгүй тул DTA мөргүй.
  const first = ok(await asOrg(() => runEclProvision({ asOf: "2026-08-31" })), "ECL 1");
  assert.equal(first.plan.requiredAllowance, 1_020_000);
  assert.equal(first.plan.deferredTax, null);
  ok(
    await asOrg(() =>
      saveEclSettings({ ...settings, taxRatePct: 10 })
    ),
    "ECL тохиргоо"
  );
  const second = ok(await asOrg(() => runEclProvision({ asOf: "2026-08-31" })), "ECL 2");
  assert.equal(second.replacedDrafts, 1, "өмнөх ноорог солигдоно");
  assert.equal(second.documentNo, first.documentNo, "ноорог дугаараа хадгална (цоорхойгүй)");
  assert.equal(second.voucherId, first.voucherId);
  assert.deepEqual(second.plan.deferredTax, { ratePct: 10, requiredAsset: 102_000, currentAsset: 0, delta: 102_000 });
  const drafts = await db.query.journalVouchers.findMany({
    where: and(eq(journalVouchers.organizationId, orgId), like(journalVouchers.externalRef, "ecl-provision:%")),
    with: { lines: true },
  });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].status, "draft");
  assert.equal(drafts[0].lines.length, 4);
  ok(await asOrg(() => postVoucher(second.voucherId!)), "ECL батлах");
  const after = ok(await asOrg(() => getEclOverview("2026-08-31")), "overview");
  assert.equal(after.plan.allowanceDelta, 0, "батлагдсаны дараа delta 0");
  assert.equal(after.plan.deferredTax?.delta, 0);

  // Шалтгаангүй хасалт татгалзана.
  const noReason = await asOrg(() => writeOffArApDocument({ documentId: old.id, date: "2026-09-10", reason: "" }));
  assert.match(noReason.error ?? "", /REASON_REQUIRED/);

  // Хасалт A: нөөц 1,020,000 хүрэлцэнэ → бүхэлдээ нөөцөөс.
  const writeOffA = ok(
    await asOrg(() => writeOffArApDocument({ documentId: old.id, date: "2026-09-10", reason: "Харилцагч татан буугдсан" })),
    "хасалт A"
  );
  assert.equal(writeOffA.fromAllowance, 1_000_000);
  assert.equal(writeOffA.toExpense, 0);
  const docA = await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, old.id) });
  assert.equal(docA?.status, "paid");
  assert.equal(await creditBalanceOf(db, orgId, "12000099", "2026-09-10"), 20_000);

  // Суутган тооцооны буцаалтаар хасалтыг буцаахгүй.
  const viaOffset = await asOrg(() => reverseArApOffset(writeOffA.voucherId));
  assert.match(viaOffset.error ?? "", /USE_WRITE_OFF_REVERSE/);

  // Сэргэлт 400,000 → нэхэмжлэх дахин нээгдэж, Cr 87000002.
  const recovery = ok(
    await asOrg(() => recoverArApWriteOff({ writeOffId: writeOffA.writeOffId, date: "2026-09-15", amount: 400_000 })),
    "сэргэлт"
  );
  assert.equal(recovery.baseAmount, 400_000);
  const reopened = await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, old.id) });
  assert.equal(reopened?.status, "partially_paid");
  assert.equal(Number(reopened?.paidAmount), 600_000);
  // Зардал: ECL нөөц Дт 1,020,000 − сэргэлт Кт 400,000 = Дт 620,000.
  assert.equal(await creditBalanceOf(db, orgId, "87000002", "2026-09-15"), -620_000, "сэргэлт зардлыг бууруулна");
  const blocked = await asOrg(() => reverseArApWriteOff(writeOffA.writeOffId));
  assert.match(blocked.error ?? "", /HAS_RECOVERY/);
  const tooMuch = await asOrg(() => recoverArApWriteOff({ writeOffId: writeOffA.writeOffId, date: "2026-09-15", amount: 700_000 }));
  assert.match(tooMuch.error ?? "", /RECOVERY_EXCEEDS/);

  // Хасалт B (нөөц 20,000 л үлдсэн) → 20,000 нөөцөөс, 1,980,000 зардалд; дараа нь буцаалт.
  const writeOffB = ok(
    await asOrg(() => writeOffArApDocument({ documentId: fresh.id, date: "2026-09-20", reason: "Шүүхийн шийдвэрээр" })),
    "хасалт B"
  );
  assert.equal(writeOffB.fromAllowance, 20_000);
  assert.equal(writeOffB.toExpense, 1_980_000);
  ok(await asOrg(() => reverseArApWriteOff(writeOffB.writeOffId)), "хасалт B буцаах");
  const restored = await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, fresh.id) });
  assert.equal(restored?.status, "posted");
  assert.equal(Number(restored?.paidAmount), 0);
  assert.equal(await creditBalanceOf(db, orgId, "12000099", "2026-09-20"), 20_000, "буцаалтын дараа нөөц сэргэнэ");
});

// Валютын журналын буцаалт ба хуулбар (docs/ontology-audit.md M2, R5; IAS 21).
// GL-ийн «Буцаах» (unpostVoucher → reverseVoucherInTx) ба «Хуулбарлах»
// (duplicateVoucher) нь журналын валют, ханш, мөрийн debitFc/creditFc-ийг
// ХАЯЖ MNT журнал болгодог байв — буцаасны дараа валютын үлдэгдэл 0 болохгүй,
// хуулбар нь USD журналыг ₮ болгож ханшийн тэгшитгэлээс гадуур гаргана.
//   • буцаалт: эхийн валют, ханш, валютын дүн (сөрөг), касс/бизнес объектын түлхүүр;
//   • хуулбар: эхийн валют, валютын дүн, ХУУЛБАРЫН огнооны албан ханш (ханш ЗОХИОХГҮЙ).
// DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { and, eq } from "drizzle-orm";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд алгасна
}

import { runAsOrg } from "../lib/auth";
import { createVoucher, duplicateVoucher, syncStandardAccounts, unpostVoucher } from "../lib/actions/gl";
import { db } from "../lib/db";
import { exchangeRates, journalVouchers, memberships, organizations, users } from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";
import { ulaanbaatarToday } from "../lib/periods/document-date";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];
const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `m2-${STAMP}`, email: `m2-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `M2 ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
}

/** USD 1,000 @ 3,400 = 3,400,000₮ — батлагдсан гар журнал. */
async function postedUsdVoucher(description: string) {
  const created = await asOrg(() =>
    createVoucher({
      date: "2025-03-10",
      description,
      currency: "USD",
      exchangeRate: 3400,
      rateSource: "manual",
      rateDate: "2025-03-10",
      status: "posted",
      lines: [
        { account: "11000001", debit: 0, credit: 0, debitFc: 1_000, creditFc: 0, description: "USD данс" },
        { account: "51100000", debit: 0, credit: 0, debitFc: 0, creditFc: 1_000, description: "Орлого" },
      ],
    })
  );
  assert.ok(!created.error, created.error);
  return db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, created.id!), with: { lines: true } });
}

test("буцаалт: валют, ханш, валютын дүн (улаан сторно) хадгалагдана", { skip: !DB_READY }, async () => {
  await setupOrg();
  const original = await postedUsdVoucher("M2 буцаалт");
  assert.equal(original?.currency, "USD");
  const reversed = await asOrg(() => unpostVoucher(original!.id));
  assert.ok(!reversed.error, reversed.error);

  const storno = await db.query.journalVouchers.findFirst({
    where: eq(journalVouchers.reversalOfVoucherId, original!.id),
    with: { lines: true },
  });
  assert.ok(storno);
  assert.equal(storno.currency, "USD");
  assert.equal(Number(storno.exchangeRate), 3400);
  assert.equal(storno.rateSource, "manual");
  const sum = (field: "debit" | "credit" | "debitFc" | "creditFc") =>
    [...original!.lines, ...storno.lines].reduce((total, line) => total + Number(line[field]), 0);
  for (const field of ["debit", "credit", "debitFc", "creditFc"] as const)
    assert.equal(Math.round(sum(field) * 100) / 100, 0, `${field}: эх + буцаалт = 0`);
  assert.ok(storno.lines.some((line) => Number(line.debitFc) === -1_000), "тал хэвээр, валютын дүн сөрөг");
});

test("хуулбар: валют, валютын дүн хэвээр, ханш нь хуулбарын огнооны албан ханш", { skip: !DB_READY }, async () => {
  await setupOrg();
  const today = ulaanbaatarToday();
  const inserted = await db
    .insert(exchangeRates)
    .values({ source: "mongolbank", date: today, currency: "USD", officialRate: "3500" })
    .onConflictDoNothing()
    .returning({ id: exchangeRates.id });
  cleanup.push(async () => {
    for (const row of inserted) await db.delete(exchangeRates).where(eq(exchangeRates.id, row.id));
  });
  const stored = await db.query.exchangeRates.findFirst({
    where: and(eq(exchangeRates.date, today), eq(exchangeRates.currency, "USD"), eq(exchangeRates.source, "mongolbank")),
  });
  const rate = Number(stored!.officialRate);

  const original = await postedUsdVoucher("M2 хуулбар");
  const copied = await asOrg(() => duplicateVoucher(original!.id));
  assert.ok(!copied.error, copied.error);
  const copy = await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, copied.id!), with: { lines: true } });
  assert.ok(copy);
  assert.equal(copy.status, "draft");
  assert.equal(copy.date, today);
  assert.equal(copy.currency, "USD");
  assert.equal(Number(copy.exchangeRate), rate);
  assert.equal(copy.rateSource, "mongolbank");
  const lineOf = (account: string) => copy.lines.find((line) => line.accountNumber.includes(account))!;
  assert.equal(Number(lineOf("11000001").debitFc), 1_000);
  assert.equal(Number(lineOf("11000001").debit), 1_000 * rate);
  assert.equal(Number(lineOf("51100000").creditFc), 1_000);
});

test("хуулбар: MNT журнал өмнөх шигээ (регресс биш)", { skip: !DB_READY }, async () => {
  await setupOrg();
  const created = await asOrg(() =>
    createVoucher({
      date: "2025-03-11",
      description: "M2 MNT",
      status: "posted",
      lines: [
        { account: "11000001", debit: 50_000, credit: 0, description: "" },
        { account: "51100000", debit: 0, credit: 50_000, description: "" },
      ],
    })
  );
  assert.ok(!created.error, created.error);
  const copied = await asOrg(() => duplicateVoucher(created.id!));
  assert.ok(!copied.error, copied.error);
  const copy = await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, copied.id!), with: { lines: true } });
  assert.equal(copy?.currency, "MNT");
  assert.deepEqual(copy!.lines.map((line) => Number(line.debit) + Number(line.credit)).sort(), [50_000, 50_000]);
});

// Туршилтын funnel — integration тест (DATABASE_URL шаарддаг). loadTrialFunnel-ийн
// raw SQL бодит схем дээр: алхмын анхны огноо, системийн seed харилцагч хасагдах,
// эзний нэмэлт компани когортод орохгүй, Console-оос идэвхжүүлсэн = төлсөн.
// Түр байгууллага үүсгэж, төгсгөлд нь устгана.

import "./helpers/load-env";

import test from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";

import { db } from "../lib/db";
import {
  apiTokens,
  counterparties,
  journalVouchers,
  memberships,
  organizationSubscriptions,
  organizations,
  payrollSettings,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";
import { ulaanbaatarToday } from "../lib/periods/document-date";
import { loadTrialFunnel } from "../lib/platform/trial-funnel-store";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let firstOrgId = "";
let secondOrgId = "";

test("бэлтгэл — эзэн, анхны компани (холбосон, мастер дата, журнал), нэмэлт компани", { skip: !DB_READY }, async () => {
  const [user] = await db
    .insert(users)
    .values({ name: `funnel-${STAMP}`, email: `funnel-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  userId = user.id;
  const [first] = await db
    .insert(organizations)
    .values({ name: `Funnel A ${STAMP}` })
    .returning({ id: organizations.id });
  firstOrgId = first.id;
  const [second] = await db
    .insert(organizations)
    .values({ name: `Funnel B ${STAMP}`, createdAt: new Date(Date.now() + 1000) })
    .returning({ id: organizations.id });
  secondOrgId = second.id;
  await db.insert(memberships).values([
    { organizationId: firstOrgId, userId, role: "owner" },
    { organizationId: secondOrgId, userId, role: "owner" },
  ]);

  await db.insert(apiTokens).values({ userId, organizationId: firstOrgId, name: "t", tokenHash: `h-${STAMP}`, tokenHint: "x" });
  await db.insert(journalVouchers).values({ userId, organizationId: firstOrgId, date: "2026-09-01", description: "t" });
  await db.insert(counterparties).values({ userId, organizationId: firstOrgId, name: `Хэрэглэгчийн ${STAMP}` });
  // Нэмэлт компанид ЗӨВХӨН системийн «Ажилчид» харилцагч — мастер дата биш.
  const [seeded] = await db
    .insert(counterparties)
    .values({ userId, organizationId: secondOrgId, name: "Ажилчид" })
    .returning({ id: counterparties.id });
  await db.insert(payrollSettings).values({ userId, organizationId: secondOrgId, employeeCounterpartyId: seeded.id });
  await db.insert(organizationSubscriptions).values({ organizationId: firstOrgId, planId: "standard", status: "active" });
});

test("loadTrialFunnel — алхмын огноо, когорт, Console-ийн идэвхжүүлэлт", { skip: !DB_READY }, async () => {
  // Урт муж: loader мужийг шалгадаггүй (route-ийн parseFunnelRange шалгана).
  const funnel = await loadTrialFunnel({ from: "2020-01-01", to: ulaanbaatarToday(), product: "accounting" });
  const row = funnel.orgs.find((o) => o.organizationId === firstOrgId);
  assert.ok(row, "анхны компани когортод орсон байх ёстой");
  assert.ok(row.connectedAt && row.masterDataAt && row.firstJournalAt);
  assert.equal(row.paidAt, null);
  assert.equal(row.manuallyConverted, true);
  assert.equal(row.lastStage, "paid");
  assert.equal(
    funnel.orgs.some((o) => o.organizationId === secondOrgId),
    false,
    "эзний нэмэлт компани шинэ бүртгэл биш"
  );
  assert.ok(funnel.excluded.additionalCompany >= 1);
});

test("loadTrialFunnel — seed харилцагч мастер дата биш", { skip: !DB_READY }, async () => {
  // Нэмэлт компанийг эзнээс салгаж анхны компани мэт болгоод шалгана.
  await db.delete(memberships).where(eq(memberships.organizationId, secondOrgId));
  const funnel = await loadTrialFunnel({ from: "2020-01-01", to: ulaanbaatarToday(), product: "accounting" });
  const row = funnel.orgs.find((o) => o.organizationId === secondOrgId);
  assert.ok(row);
  assert.equal(row.masterDataAt, null);
  assert.equal(row.lastStage, "signed_up");
});

test("цэвэрлэгээ", { skip: !DB_READY }, async () => {
  for (const id of [firstOrgId, secondOrgId]) if (id) await purgeOrganization(id);
  await db.delete(organizations).where(inArray(organizations.id, [firstOrgId, secondOrgId].filter(Boolean)));
  if (userId) await db.delete(users).where(eq(users.id, userId));
});

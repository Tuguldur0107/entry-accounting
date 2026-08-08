// Фаз 01 — Байгууллага хоорондын тусгаарлалтын integration тест
// (спекийн шалгуур: "А байгууллагын гишүүн Б-гийн датаг харж чадахгүй").
//
// DATABASE_URL шаарддаг, түр өгөгдөл үүсгээд ТӨГСГӨЛД НЬ УСТГАДАГ
// (org устгахад cascade бүх мөрийг цэвэрлэнэ). Server action-ууд бүгд
// getActiveOrg()-оос (гишүүнчлэлээр баталгаажсан) scope авдаг тул энд
// query давхарга + гол хамгаалалтуудыг шалгана.

import "./helpers/load-env";

import test from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";

import { db } from "../lib/db";
import {
  accountingPeriods,
  chartOfAccounts,
  journalVouchers,
  memberships,
  organizations,
  users,
  vatSettings,
} from "../lib/db/schema";
import { assertPeriodOpen, ClosedPeriodError } from "../lib/periods/guard";
import { loadVatSettings } from "../lib/vat/settings";

const STAMP = Date.now().toString(36);
const cleanup: (() => Promise<void>)[] = [];

async function makeOrg(tag: string) {
  const [user] = await db
    .insert(users)
    .values({
      name: `org-iso-${tag}-${STAMP}`,
      email: `org-iso-${tag}-${STAMP}@test.local`,
      passwordHash: "x",
    })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `Org ${tag} ${STAMP}` })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({
    organizationId: org.id,
    userId: user.id,
    role: "owner",
  });
  cleanup.push(async () => {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, user.id));
  });
  return { userId: user.id, orgId: org.id };
}

test("байгууллага хоорондын тусгаарлалт", async (t) => {
  const a = await makeOrg("a");
  const b = await makeOrg("b");

  try {
    await t.test("бичилт зөвхөн өөрийн org-д харагдана", async () => {
      await db.insert(journalVouchers).values({
        userId: a.userId,
        organizationId: a.orgId,
        date: "2026-08-01",
        description: "A-гийн бичилт",
        status: "draft",
      });
      const fromA = await db.query.journalVouchers.findMany({
        where: eq(journalVouchers.organizationId, a.orgId),
      });
      const fromB = await db.query.journalVouchers.findMany({
        where: eq(journalVouchers.organizationId, b.orgId),
      });
      assert.equal(fromA.length, 1);
      assert.equal(fromB.length, 0);
    });

    await t.test("нэг хэрэглэгч 2 org-т ижил дансны дугаар үүсгэж чадна", async () => {
      // Хуучин (user_id, number) unique унасны баталгаа — org түвшний
      // uniqueness л үйлчилнэ.
      await db.insert(chartOfAccounts).values([
        { userId: a.userId, organizationId: a.orgId, number: "99990001", name: "Тест A" },
        { userId: a.userId, organizationId: b.orgId, number: "99990001", name: "Тест B" },
      ]);
      const inA = await db.query.chartOfAccounts.findMany({
        where: and(
          eq(chartOfAccounts.organizationId, a.orgId),
          eq(chartOfAccounts.number, "99990001")
        ),
      });
      assert.equal(inA.length, 1);
      assert.equal(inA[0].name, "Тест A");
    });

    await t.test("периодын хаалт org тус бүрдээ", async () => {
      await db.insert(accountingPeriods).values({
        userId: a.userId,
        organizationId: a.orgId,
        code: "2026-07",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        status: "closed",
      });
      // A-д хаагдсан — алдаа шидэх ёстой
      await assert.rejects(
        () => assertPeriodOpen(a.orgId, "2026-07-15"),
        ClosedPeriodError
      );
      // B-д мөн сар нээлттэй хэвээр
      await assert.doesNotReject(() => assertPeriodOpen(b.orgId, "2026-07-15"));
    });

    await t.test("тохиргоо (vat_settings) org бүрд тусдаа", async () => {
      const settingsA = await loadVatSettings(a.orgId, a.userId);
      const settingsB = await loadVatSettings(b.orgId, b.userId);
      assert.notEqual(settingsA.id, settingsB.id);
      assert.equal(settingsA.organizationId, a.orgId);
      assert.equal(settingsB.organizationId, b.orgId);
      // B-гийн тохиргоог өөрчилөхөд A хөндөгдөхгүй
      await db
        .update(vatSettings)
        .set({ vatRatePercent: "11" })
        .where(eq(vatSettings.id, settingsB.id));
      const reloadedA = await loadVatSettings(a.orgId, a.userId);
      assert.equal(Number(reloadedA.vatRatePercent), 10);
    });

    await t.test("externalRef idempotency org түвшинд", async () => {
      await db.insert(journalVouchers).values({
        userId: a.userId,
        organizationId: a.orgId,
        date: "2026-08-02",
        description: "ref тест A",
        status: "draft",
        externalRef: `iso-ref-${STAMP}`,
      });
      // ӨӨР org ИЖИЛ ref ашиглаж чадна (org-scoped partial unique)
      await assert.doesNotReject(() =>
        db.insert(journalVouchers).values({
          userId: b.userId,
          organizationId: b.orgId,
          date: "2026-08-02",
          description: "ref тест B",
          status: "draft",
          externalRef: `iso-ref-${STAMP}`,
        })
      );
      // Нэг org дотор давхардвал унана
      await assert.rejects(() =>
        db.insert(journalVouchers).values({
          userId: a.userId,
          organizationId: a.orgId,
          date: "2026-08-03",
          description: "ref давхардал",
          status: "draft",
          externalRef: `iso-ref-${STAMP}`,
        })
      );
    });
  } finally {
    for (const fn of cleanup.reverse()) await fn();
  }
});

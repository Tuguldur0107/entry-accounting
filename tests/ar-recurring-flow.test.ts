// Давтамжтай нэхэмжлэх (lib/arap/recurring-run.ts) — DB урсгал: эх нэхэмжлэхээс
// загвар, хуваарийн өдөр НООРОГ үүснэ, давтан tick давхардахгүй, нөхөлт + дуусах
// огноо → ended, шууд батлах + и-мэйл, түр зогсоох, «Одоо үүсгэх», ноорогтой
// и-мэйл хослол татгалзана. Resend-ийг fetch-ээр барина. DATABASE_URL байхгүй бол алгасна.

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

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import {
  createRecurringInvoice,
  runRecurringInvoiceNow,
  setRecurringInvoiceStatus,
} from "../lib/actions/ar-recurring";
import { syncStandardAccounts } from "../lib/actions/gl";
import { runRecurringInvoices } from "../lib/arap/recurring-run";
import { db } from "../lib/db";
import {
  arApDocuments,
  arRecurringInvoices,
  memberships,
  notifications,
  organizationProfile,
  organizations,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";
import { todayInUlaanbaatar } from "../lib/periods/selection";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, input: unknown) => asOrg(() => executeAiTool(userId, name, input, "post"));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result;
}

async function invoice(ref: string, date: string, dueDate: string, amount: number) {
  ok(
    await tool("create_arap_invoice", {
      documentType: "ar_invoice",
      counterparty: `Түрээслэгч ${STAMP}`,
      date,
      dueDate,
      description: "Оффисын түрээс",
      externalRef: `${ref}-${STAMP}`,
      lines: [{ account: "51100000", amount }],
    })
  );
  const doc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `${ref}-${STAMP}`)),
  });
  assert.ok(doc);
  return doc;
}

const generated = (templateId: string) =>
  db.query.arApDocuments.findMany({
    where: and(eq(arApDocuments.organizationId, orgId), like(arApDocuments.externalRef, `recurring:${templateId}:%`)),
    orderBy: (doc, { asc }) => [asc(doc.date)],
  });

test("Давтамжтай нэхэмжлэх: хуваарь, давхардалгүй, нөхөлт, шууд батлах + и-мэйл, зогсоох", { skip: !DB_READY }, async (t) => {
  const env = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL, url: process.env.NEXT_PUBLIC_APP_URL };
  process.env.RESEND_API_KEY = "re_test_dummy";
  process.env.RESEND_FROM_EMAIL = "billing@example.mn";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.mn";
  const realFetch = globalThis.fetch;
  const sent: { to: string; subject: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("api.resend.com")) return realFetch(input, init);
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: `mail-${sent.length}` }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  t.after(() => {
    globalThis.fetch = realFetch;
    restore("RESEND_API_KEY", env.key);
    restore("RESEND_FROM_EMAIL", env.from);
    restore("NEXT_PUBLIC_APP_URL", env.url);
  });

  const [user] = await db
    .insert(users)
    .values({ name: `rc-${STAMP}`, email: `rc-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `Recurring ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  userId = user.id;
  orgId = org.id;
  try {
    await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `Recurring ${STAMP}` });
    const sync = await asOrg(() => syncStandardAccounts());
    assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
    ok(await tool("create_counterparty", { name: `Түрээслэгч ${STAMP}`, counterpartyType: "customer", email: "rent@example.mn" }));

    // 1) Ноорог загвар: сар бүр 5-нд, 14 хоногт төлөх, 12-р сар хүртэл.
    const source = await invoice("src", "2026-09-05", "2026-09-19", 500_000);
    const created = await asOrg(() =>
      createRecurringInvoice(source.id, {
        intervalMonths: 1,
        dayOfMonth: 5,
        paymentTermsDays: 14,
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        autoPost: false,
        sendEmail: false,
      })
    );
    assert.equal(created.error, undefined, created.error);
    assert.equal(created.nextRunDate, "2026-10-05");
    const templateId = created.id!;

    assert.equal((await runRecurringInvoices("2026-10-04")).created, 0);
    const first = await runRecurringInvoices("2026-10-05");
    assert.equal(first.created, 1, JSON.stringify(first.errors));
    let docs = await generated(templateId);
    assert.deepEqual(
      docs.map((doc) => [doc.date, doc.dueDate, doc.status, Number(doc.totalAmount), doc.description]),
      [["2026-10-05", "2026-10-19", "draft", 500_000, "Оффисын түрээс — 2026-10"]]
    );
    // Давтан tick — давхардахгүй.
    assert.equal((await runRecurringInvoices("2026-10-05")).created, 0);
    // Системийн үүсгэлт → owner-т мэдэгдэл (ноорог — батлах хэрэгтэй).
    const alerts = await db.query.notifications.findMany({
      where: and(eq(notifications.organizationId, orgId), eq(notifications.type, "arap.recurring_created")),
    });
    assert.deepEqual(alerts.map((row) => row.userId), [userId]);

    // 2) Нөхөлт + дуусах огноо: 11, 12-р сар үүсээд загвар дуусна.
    const catchUp = await runRecurringInvoices("2027-02-01");
    assert.equal(catchUp.created, 2, JSON.stringify(catchUp.errors));
    docs = await generated(templateId);
    assert.deepEqual(docs.map((doc) => doc.date), ["2026-10-05", "2026-11-05", "2026-12-05"]);
    let template = await db.query.arRecurringInvoices.findFirst({ where: eq(arRecurringInvoices.id, templateId) });
    assert.deepEqual([template?.status, template?.runCount, template?.nextRunDate], ["ended", 3, "2027-01-05"]);
    const ended = await asOrg(() => runRecurringInvoiceNow(templateId));
    assert.match(ended.error ?? "", /дууссан/i);

    // 3) Шууд батлах + и-мэйл (өнгөрсөн сарын өдөр → батлагдана).
    const today = todayInUlaanbaatar();
    const monthStart = `${today.slice(0, 7)}-01`;
    const auto = await asOrg(() =>
      createRecurringInvoice(source.id, {
        intervalMonths: 1,
        dayOfMonth: 1,
        paymentTermsDays: 10,
        startDate: monthStart,
        endDate: null,
        autoPost: true,
        sendEmail: true,
      })
    );
    assert.equal(auto.error, undefined, auto.error);
    const autoRun = await runRecurringInvoices(today);
    assert.equal(autoRun.created, 1, JSON.stringify(autoRun.errors));
    const [posted] = await generated(auto.id!);
    assert.equal(posted.status, "posted");
    assert.equal(posted.date, monthStart);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "rent@example.mn");
    assert.match(sent[0].subject, new RegExp(posted.documentNo));

    // 4) «Одоо үүсгэх» — дараагийн сарынхыг ӨНӨӨДРИЙН огноогоор, дараа нь ticker давхарлахгүй.
    const now = await asOrg(() => runRecurringInvoiceNow(auto.id!));
    assert.equal(now.error, undefined, now.error);
    assert.equal(now.emailed, true);
    template = await db.query.arRecurringInvoices.findFirst({ where: eq(arRecurringInvoices.id, auto.id!) });
    const nextMonthRun = template!.nextRunDate;
    assert.ok(nextMonthRun > today);
    const autoDocs = await generated(auto.id!);
    assert.equal(autoDocs.length, 2);
    assert.equal(autoDocs[1].date, today);

    // 5) Түр зогсоох → хуваарийн өдөр ч үүсэхгүй; сэргээхэд зогссон үе нөхөгдөхгүй.
    const paused = await asOrg(() => setRecurringInvoiceStatus(auto.id!, true));
    assert.equal(paused.error, undefined, paused.error);
    assert.equal((await runRecurringInvoices(nextMonthRun)).created, 0);
    const resumed = await asOrg(() => setRecurringInvoiceStatus(auto.id!, false));
    assert.equal(resumed.error, undefined, resumed.error);
    assert.equal(resumed.nextRunDate, nextMonthRun, "ирээдүйн огноо хэвээр");

    // 6) Ноорогтой и-мэйл хослол татгалзана (ноорог нэхэмжлэх илгээгдэхгүй).
    const bad = await asOrg(() =>
      createRecurringInvoice(source.id, {
        intervalMonths: 1,
        dayOfMonth: 1,
        paymentTermsDays: 10,
        startDate: monthStart,
        endDate: null,
        autoPost: false,
        sendEmail: true,
      })
    );
    assert.match(bad.error ?? "", /автоматаар батлах/);
  } finally {
    await purgeOrganization(orgId);
    await db.delete(users).where(eq(users.id, userId));
  }
});

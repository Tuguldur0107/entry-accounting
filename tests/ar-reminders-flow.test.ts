// Төлбөрийн автомат сануулга (lib/arap/reminders-run.ts) — DB урсгал: унтраалттай
// бол явахгүй, шат бүр нэг л удаа, байгууллага × өдөр нэг ажил, харилцагч
// хасагдвал алгасна, Resend алдаа → failed → дараагийн удаа дахин оролдоно.
// Resend-ийн HTTP-г fetch-ээр барина (сүлжээгүй). DATABASE_URL байхгүй бол алгасна.

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

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { saveArReminderSettings, sendInvoiceReminder, setCounterpartyReminderOptOut } from "../lib/actions/ar-reminders";
import { syncStandardAccounts } from "../lib/actions/gl";
import { runInvoiceReminders, sendOrgInvoiceReminders } from "../lib/arap/reminders-run";
import { db } from "../lib/db";
import {
  arApDocuments,
  arApInvoiceSends,
  arInvoiceReminders,
  counterparties,
  memberships,
  notifications,
  organizationProfile,
  organizations,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

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

type SentMail = { to: string; subject: string; text: string };

test("Төлбөрийн сануулга: шат бүр нэг удаа, хасалт, алдаа → дахин оролдлого", { skip: !DB_READY }, async (t) => {
  const env = {
    key: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
    url: process.env.NEXT_PUBLIC_APP_URL,
  };
  process.env.RESEND_API_KEY = "re_test_dummy";
  process.env.RESEND_FROM_EMAIL = "billing@example.mn";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.mn";
  const realFetch = globalThis.fetch;
  const sent: SentMail[] = [];
  let failNext = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("api.resend.com")) return realFetch(input, init);
    if (failNext) {
      failNext = false;
      return new Response(JSON.stringify({ name: "application_error", message: "temporary failure", statusCode: 500 }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: `mail-${sent.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
    .values({ name: `rm-${STAMP}`, email: `rm-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `Reminders ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  userId = user.id;
  orgId = org.id;
  try {
    await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `Reminders ${STAMP}` });
    const sync = await asOrg(() => syncStandardAccounts());
    assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
    ok(await tool("create_counterparty", { name: `Бат ${STAMP}`, counterpartyType: "customer", email: "bat@example.mn" }));
    ok(
      await tool("create_arap_invoice", {
        documentType: "ar_invoice",
        counterparty: `Бат ${STAMP}`,
        date: "2026-09-01",
        dueDate: "2026-09-20",
        description: "Сануулгын тест",
        externalRef: `rm-${STAMP}`,
        lines: [{ account: "51100000", amount: 550_000 }],
      })
    );
    const invoice = await db.query.arApDocuments.findFirst({
      where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `rm-${STAMP}`)),
    });
    assert.equal(invoice?.status, "posted");
    const counterparty = await db.query.counterparties.findFirst({ where: eq(counterparties.id, invoice!.counterpartyId) });
    assert.equal(counterparty?.email, "bat@example.mn");

    // 1) Анхнаасаа унтраалттай — юу ч явахгүй.
    assert.deepEqual(await sendOrgInvoiceReminders(orgId, "2026-09-21"), { sent: 0, failed: 0, skipped: 0 });
    assert.equal(sent.length, 0);

    // 2) Асаах — буруу тохиргоо татгалзана, зөв нь хадгалагдана.
    const bad = await asOrg(() => saveArReminderSettings({ enabled: true, beforeDays: null, afterDays: [] }));
    assert.match(bad.error ?? "", /шат/);
    const saved = await asOrg(() => saveArReminderSettings({ enabled: true, beforeDays: 3, afterDays: [1, 7, 14] }));
    assert.equal(saved.error, undefined, saved.error);

    // 3) 1 хоног хэтэрсэн — НЭГ захиа, гарчигт дүнгүй, нээлттэй линктэй.
    assert.deepEqual(await sendOrgInvoiceReminders(orgId, "2026-09-21"), { sent: 1, failed: 0, skipped: 0 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "bat@example.mn");
    assert.match(sent[0].subject, /^Хугацаа хэтэрсэн төлбөр: нэхэмжлэх №/);
    assert.doesNotMatch(sent[0].subject, /550/);
    assert.match(sent[0].text, /550,000\.00 MNT/);
    const token = /\/invoice\/([0-9a-f-]{36})/.exec(sent[0].text)?.[1];
    assert.ok(token, "нээлттэй линк");
    const send = await db.query.arApInvoiceSends.findFirst({ where: eq(arApInvoiceSends.token, token) });
    assert.deepEqual([send?.purpose, send?.channel, send?.recipient, send?.messageId], ["reminder", "email", "bat@example.mn", "mail-1"]);
    const rows = await db.query.arInvoiceReminders.findMany({ where: eq(arInvoiceReminders.documentId, invoice!.id) });
    assert.deepEqual(
      rows.map((row) => [row.stage, row.status, row.dueDate, row.sendId]),
      [["after:1", "sent", "2026-09-20", send!.id]]
    );

    // 4) Давтан дуудлага / дараагийн өдөр — шат нэг л удаа.
    assert.equal((await sendOrgInvoiceReminders(orgId, "2026-09-21")).sent, 0);
    assert.equal((await sendOrgInvoiceReminders(orgId, "2026-09-22")).sent, 0);
    assert.equal(sent.length, 1);

    // 5) Resend түр алдаа → failed; дахин дуудахад оролдоно → sent (attempts 2).
    failNext = true;
    assert.deepEqual(await sendOrgInvoiceReminders(orgId, "2026-09-27"), { sent: 0, failed: 1, skipped: 0 });
    const failed = await db.query.arInvoiceReminders.findFirst({
      where: and(eq(arInvoiceReminders.documentId, invoice!.id), eq(arInvoiceReminders.stage, "after:7")),
    });
    assert.equal(failed?.status, "failed");
    assert.ok(failed?.error);
    // Автомат (систем) алдаа → owner-т ч мэдэгдэл (actor хасалт хамаарахгүй).
    const alerts = await db.query.notifications.findMany({
      where: and(eq(notifications.organizationId, orgId), eq(notifications.type, "arap.reminder_failed")),
    });
    assert.deepEqual(alerts.map((row) => row.userId), [userId]);
    // Байгууллага × өдөр НЭГ ажил: эхний run дахин оролдоод илгээнэ, хоёр дахь нь булаалтгүй.
    const first = await runInvoiceReminders("2026-09-27");
    assert.ok(first.claimed >= 1);
    assert.equal(first.errors.filter((error) => error.organizationId === orgId).length, 0);
    const second = await runInvoiceReminders("2026-09-27");
    assert.equal(second.claimed, 0);
    const retried = await db.query.arInvoiceReminders.findFirst({ where: eq(arInvoiceReminders.id, failed!.id) });
    assert.deepEqual([retried?.status, retried?.attempts, retried?.error], ["sent", 2, null]);
    assert.equal(sent.length, 2);
    assert.match(sent[1].text, /7 хоног хэтэрсэн/);

    // 6) Харилцагчийг хассан — дараагийн шат алгасагдана.
    const optOut = await asOrg(() => setCounterpartyReminderOptOut(invoice!.counterpartyId, true));
    assert.equal(optOut.error, undefined, optOut.error);
    assert.deepEqual(await sendOrgInvoiceReminders(orgId, "2026-10-04"), { sent: 0, failed: 0, skipped: 1 });
    assert.equal(sent.length, 2);

    // 7) Гараар — хасагдсан харилцагчид ч (ИЛ үйлдэл), нэхэмжлэхэд өдөрт нэг.
    const manual = await asOrg(() => sendInvoiceReminder(invoice!.id, null));
    assert.equal(manual.error, undefined, manual.error);
    assert.equal(manual.sentTo, "bat@example.mn");
    assert.equal(sent.length, 3);
    const again = await asOrg(() => sendInvoiceReminder(invoice!.id, "other@example.mn"));
    assert.match(again.error ?? "", /аль хэдийн/);
    assert.equal(sent.length, 3);
    const manualRow = await db.query.arInvoiceReminders.findFirst({
      where: and(eq(arInvoiceReminders.documentId, invoice!.id), eq(arInvoiceReminders.status, "sent"), eq(arInvoiceReminders.recipient, "bat@example.mn")),
      orderBy: (row, { desc }) => [desc(row.createdAt)],
    });
    assert.match(manualRow?.stage ?? "", /^manual:\d{4}-\d{2}-\d{2}$/);
  } finally {
    await purgeOrganization(orgId);
    await db.delete(users).where(eq(users.id, userId));
  }
});

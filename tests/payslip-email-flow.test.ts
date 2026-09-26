// Цалингийн хуудсыг и-мэйлээр илгээх — DB integration. Журнал батлагдаагүй
// бол хориг, батлагдсаны дараа PDF хавсралттай илгээж аудитад бичнэ, и-мэйлгүй
// ажилтан ил алгасагдана. Resend-ийн HTTP дуудлагыг fetch-ээр барина (сүлжээгүй).
// DATABASE_URL шаарддаг.

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
import { postVoucher, syncStandardAccounts } from "../lib/actions/gl";
import { getPayslipReport } from "../lib/actions/payroll";
import { sendPayslipEmails } from "../lib/actions/payroll-payslip-email";
import { db } from "../lib/db";
import {
  auditEvents,
  memberships,
  organizationProfile,
  organizations,
  payrollRuns,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const PERIOD = "2026-08";
let userId = "";
let orgId = "";

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = async (name: string, input: unknown) => {
  const result = await asOrg(() => executeAiTool(userId, name, input, "draft"));
  assert.ok(!result.resultText.startsWith("Алдаа"), `${name}: ${result.resultText}`);
  return result;
};

type SentMail = { to: string; subject: string; text: string; attachments: { filename: string; content: string }[] };

test("цалингийн хуудас и-мэйлээр: журнал батлагдсаны дараа л, дүнгүй мэйл + PDF, аудит", { skip: !DB_READY }, async (t) => {
  const [user] = await db
    .insert(users)
    .values({ name: `ps-${STAMP}`, email: `ps-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `Payslip ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  userId = user.id;
  orgId = org.id;
  t.after(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  await db.insert(organizationProfile).values({
    userId,
    organizationId: orgId,
    name: `Payslip ${STAMP} ХХК`,
  });
  await asOrg(() => syncStandardAccounts());

  await tool("create_employee", { name: "Бат", lastName: "Дорж", position: "Нягтлан", baseSalary: 2_000_000, email: `bat-${STAMP}@example.mn` });
  await tool("create_employee", { name: "Сараа", position: "Касс", baseSalary: 1_500_000 });
  await tool("run_payroll", { period: PERIOD });
  await tool("create_payroll_voucher", { period: PERIOD });

  // Ноорог журнал → илгээхгүй.
  const draftReport = await asOrg(() => getPayslipReport(PERIOD));
  assert.equal(draftReport.payslips.length, 2);
  assert.match(draftReport.email.blocker ?? "", /ноорог/);
  const env = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL };
  process.env.RESEND_API_KEY = "re_test_dummy";
  process.env.RESEND_FROM_EMAIL = "payroll@example.mn";
  const realFetch = globalThis.fetch;
  const sent: SentMail[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("api.resend.com")) return realFetch(input, init);
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: `mail-${sent.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    if (env.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = env.key;
    if (env.from === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = env.from;
  });

  const blocked = await asOrg(() => sendPayslipEmails(PERIOD));
  assert.match(blocked.error ?? "", /ноорог/);
  assert.equal(sent.length, 0);

  // Журнал батлах → илгээнэ.
  const run = await db.query.payrollRuns.findFirst({
    where: and(eq(payrollRuns.organizationId, orgId), eq(payrollRuns.periodMonth, PERIOD)),
  });
  const posted = await asOrg(() => postVoucher(run!.voucherId!));
  assert.equal(posted.error, undefined, posted.error);

  const result = await asOrg(() => sendPayslipEmails(PERIOD));
  assert.ok(result.error === undefined, result.error);
  assert.deepEqual(result.sent.map((row) => row.email), [`bat-${STAMP}@example.mn`]);
  assert.deepEqual(result.skipped.map((row) => [row.employeeName, row.reason]), [["Сараа", "И-мэйл хаяг бүртгэгдээгүй"]]);
  assert.equal(result.failed.length, 0);

  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.to, `bat-${STAMP}@example.mn`);
  assert.match(mail.subject, /Цалингийн хуудас — 2026 оны 8-р сар/);
  for (const text of [mail.subject, mail.text]) assert.doesNotMatch(text, /₮|\d{1,3}(,\d{3})+/);
  assert.equal(mail.attachments[0].filename, `payslip-${PERIOD}.pdf`);
  assert.equal(Buffer.from(mail.attachments[0].content, "base64").subarray(0, 4).toString(), "%PDF");

  const audits = await db.query.auditEvents.findMany({
    where: and(eq(auditEvents.organizationId, orgId), eq(auditEvents.entityType, "payslip")),
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "email");
  assert.doesNotMatch(audits[0].summary, /\d{1,3}(,\d{3})+|2000000/);

  // Дахин илгээлт — аудитад «дахин», «Илгээсэн» огноо харагдана.
  const after = await asOrg(() => getPayslipReport(PERIOD));
  assert.equal(after.email.blocker, null);
  const bat = after.payslips.find((slip) => slip.employeeName === "Дорж Бат")!;
  assert.ok(after.email.delivery[bat.employeeId].lastSentAt);
  const again = await asOrg(() => sendPayslipEmails(PERIOD, [bat.employeeId]));
  assert.ok(again.error === undefined, again.error);
  assert.equal(again.sent.length, 1);
  assert.equal(again.skipped.length, 0, "сонгоогүй ажилтан алгасалтад орохгүй");
  const resent = await db.query.auditEvents.findMany({
    where: and(eq(auditEvents.organizationId, orgId), eq(auditEvents.entityType, "payslip")),
  });
  assert.equal(resent.length, 2);
  assert.ok(resent.some((row) => row.summary.includes("дахин илгээв")));
});

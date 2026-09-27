// АР нэхэмжлэх → eBarimt НЭХЭМЖЛЭХ (docs/pos/05 Шат 2) — батлахад дараалалд орж,
// worker хуурамч PosAPI руу B2B_INVOICE (төлбөр PAY) илгээж, ДДТД-г нэхэмжлэх дээр
// бичнэ. Тохиргоо унтраалттай бол юу ч явахгүй; ТТД-гүй байгууллагад ил алдаа
// (failed + шалтгаан), ТТД нэмээд «Дахин илгээх» → sent. POS-ийн дараалал
// хөндөгдөхгүй. DATABASE_URL байхгүй бол алгасна.

import "./helpers/load-env";

import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
import { syncStandardAccounts } from "../lib/actions/gl";
import { getPosSettings } from "../lib/actions/pos";
import { resendArapEbarimt } from "../lib/actions/arap";
import { processPendingEbarimt } from "../lib/ebarimt/worker";
import { loadEbarimtDocuments } from "../lib/ebarimt/list-data";
import { db } from "../lib/db";
import {
  arApDocuments,
  counterparties,
  memberships,
  organizationProfile,
  organizations,
  posEbarimtSubmissions,
  posSettings,
  users,
  vatSettings,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, input: unknown, mode: "draft" | "post" = "draft") =>
  asOrg(() => executeAiTool(userId, name, input, mode));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result;
}

/** Хуурамч PosAPI — POST /rest/receipt-ийг бичиж ДДТД буцаана. */
const received: Record<string, unknown>[] = [];
let server: Server | null = null;
let posApiUrl = "";
let counter = 0;

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

async function startFakePosApi() {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.method === "POST" && req.url === "/rest/receipt") {
      received.push(JSON.parse(body));
      counter += 1;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          id: `0379008467880010976${String(counter).padStart(14, "0")}`,
          status: "SUCCESS",
          date: "2026-09-27 12:00:00",
          lottery: "",
          qrData: "",
          version: "3.2.50",
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  posApiUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

async function invoice(ref: string, counterparty: string) {
  ok(
    await tool(
      "create_arap_invoice",
      {
        documentType: "ar_invoice",
        counterparty,
        date: "2026-09-10",
        dueDate: "2026-09-30",
        description: `Зөвлөх үйлчилгээ ${ref}`,
        externalRef: `${ref}-${STAMP}`,
        vatMode: "exclusive",
        lines: [{ account: "51100000", amount: 1_000_000, description: "Зөвлөх үйлчилгээ" }],
      },
      "post"
    )
  );
  const doc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `${ref}-${STAMP}`)),
  });
  assert.equal(doc?.status, "posted");
  return doc!;
}

/** Батлалтын hook-ийн fire-and-forget worker-тэй давхцахгүйн тулд төлөв тогтох хүртэл. */
async function settle(documentId: string, want: string[]) {
  for (let i = 0; i < 50; i += 1) {
    await processPendingEbarimt(10);
    const doc = await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, documentId) });
    if (doc && want.includes(doc.ebarimtStatus ?? "")) return doc;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, documentId) });
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

test("АР нэхэмжлэх → eBarimt B2B_INVOICE (PAY), ТТД-гүй бол ил алдаа → засаад дахин илгээх", { skip: !DB_READY }, async () => {
  await startFakePosApi();
  const [user] = await db
    .insert(users)
    .values({ name: `ea-${STAMP}`, email: `ea-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `АР eBarimt ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `АР eBarimt ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
  await db.insert(vatSettings).values({ userId, organizationId: orgId, isVatPayer: true });

  ok(await tool("create_counterparty", { name: `Тест ХХК ${STAMP}`, counterpartyType: "customer", tin: "61200064714" }));
  ok(await tool("create_counterparty", { name: `ТТДгүй ХХК ${STAMP}`, counterpartyType: "customer" }));

  // eBarimt асаалттай, «АР нэхэмжлэх» УНТРААЛТТАЙ → нэхэмжлэх явахгүй (анхдагч).
  const settings = await asOrg(() => getPosSettings());
  assert.ok(!settings.error, settings.error);
  await db
    .update(posSettings)
    .set({
      ebarimtEnabled: true,
      ebarimtMerchantTin: "37900846788",
      ebarimtBranchNo: "001",
      ebarimtDistrictCode: "2301",
      ebarimtPosNo: "10001",
      ebarimtPosApiUrl: posApiUrl,
      ebarimtMode: "server",
    })
    .where(eq(posSettings.organizationId, orgId));
  const off = await invoice("OFF", `Тест ХХК ${STAMP}`);
  await processPendingEbarimt(10);
  const offAfter = await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, off.id) });
  assert.equal(offAfter?.ebarimtStatus, null, "тохиргоо унтраалттай — илгээхгүй");
  assert.equal(received.length, 0);

  // Асаана: төлбөрийн код + анхдагч ангиллын код.
  await db
    .update(posSettings)
    .set({ ebarimtArapEnabled: true, ebarimtArapPaymentCode: "INVOICE", ebarimtArapClassificationCode: "8311100" })
    .where(eq(posSettings.organizationId, orgId));

  const sent = await invoice("B2B", `Тест ХХК ${STAMP}`);
  const sentAfter = await settle(sent.id, ["sent", "failed"]);
  assert.equal(sentAfter?.ebarimtStatus, "sent", `eBarimt төлөв: ${sentAfter?.ebarimtStatus}`);
  assert.match(sentAfter?.ebarimtId ?? "", /^\d{33}$/);
  assert.equal(sentAfter?.ebarimtType, "B2B_INVOICE");
  const request = received.at(-1)!;
  assert.equal(request.type, "B2B_INVOICE");
  assert.equal(request.customerTin, "61200064714");
  assert.equal(request.totalAmount, 1_100_000);
  assert.equal(request.totalVAT, 100_000);
  assert.deepEqual(request.payments, [{ code: "INVOICE", status: "PAY", paidAmount: 1_100_000 }]);
  assert.match(String(request.billIdSuffix), /^8\d{7}$/);

  // ТТД-гүй байгууллага → failed + шалтгаан (ЗОХИОХГҮЙ), батлалт өөрөө амжилттай.
  const noTin = await invoice("NOTIN", `ТТДгүй ХХК ${STAMP}`);
  const failed = await settle(noTin.id, ["failed"]);
  assert.equal(failed?.ebarimtStatus, "failed");
  const submission = await db.query.posEbarimtSubmissions.findFirst({
    where: and(eq(posEbarimtSubmissions.organizationId, orgId), eq(posEbarimtSubmissions.arapDocumentId, noTin.id)),
  });
  assert.match(submission?.lastError ?? "", /ТТД/);
  assert.equal(submission?.saleId, null);

  // ТТД нэмээд «Дахин илгээх» → sent.
  await db
    .update(counterparties)
    .set({ tin: "61200064715" })
    .where(and(eq(counterparties.organizationId, orgId), eq(counterparties.name, `ТТДгүй ХХК ${STAMP}`)));
  const resend = await asOrg(() => resendArapEbarimt(noTin.id));
  assert.ok(!resend.error, resend.error);
  const resent = await settle(noTin.id, ["sent"]);
  assert.equal(resent?.ebarimtStatus, "sent");
  assert.equal(received.at(-1)!.customerTin, "61200064715");
  // Failed мөрийг дахин ашиглана — ТЕГ-д ДДТД үүсээгүй тул ижил suffix (PosAPI давхардлыг таних).
  assert.equal(received.filter((r) => r.customerTin === "61200064715").length, 1);

  // Илгээгдсэнийг дахин илгээхгүй.
  const again = await asOrg(() => resendArapEbarimt(sent.id));
  assert.match(again.error ?? "", /аль хэдийн/);

  // Нэгдсэн жагсаалт (/tax/ebarimt): илгээгдсэн 2 нэхэмжлэх, дүн/НӨАТ нь ИЛГЭЭСЭН payload-оос;
  // тохиргоо унтраалттай үеийн нэхэмжлэх (eBarimt төлөвгүй) орохгүй; эрхгүй эх хасагдана.
  const list = await loadEbarimtDocuments(orgId, { from: "2026-09-01", to: "2026-09-30" }, ["pos", "arap"]);
  assert.equal(list.truncated, false);
  assert.deepEqual(list.rows.map((row) => row.id).sort(), [sent.id, noTin.id].sort());
  const b2b = list.rows.find((row) => row.id === sent.id)!;
  assert.equal(b2b.source, "arap");
  assert.equal(b2b.status, "sent");
  assert.equal(b2b.ebarimtType, "B2B_INVOICE");
  assert.equal(b2b.customerTin, "61200064714");
  assert.equal(b2b.total, 1_100_000);
  assert.equal(b2b.vat, 100_000);
  assert.equal(b2b.lastError, null);
  const posOnly = await loadEbarimtDocuments(orgId, { from: "2026-09-01", to: "2026-09-30" }, ["pos"]);
  assert.equal(posOnly.rows.length, 0);

  // Дүн = ТЕГ-д очсон СҮҮЛИЙН receipt (засвар/inactiveId-ийн дараах — POS хэсэгчилсэн
  // буцаалттай ижил дүрэм); хүлээгдэж буй шинэ илгээлт тоонд нөлөөлөхгүй.
  const range = { from: "2026-09-01", to: "2026-09-30" };
  const corrected = { type: "B2B_INVOICE", customerTin: "61200064714", totalAmount: 550_000, totalVAT: 50_000, totalCityTax: 0 };
  await db.insert(posEbarimtSubmissions).values({
    organizationId: orgId,
    arapDocumentId: sent.id,
    kind: "cancel",
    status: "sent",
    payload: { request: { ...corrected, inactiveId: sentAfter?.ebarimtId } },
    sentAt: new Date(),
    createdAt: new Date(Date.now() + 1_000),
  });
  await db.insert(posEbarimtSubmissions).values({
    organizationId: orgId,
    arapDocumentId: sent.id,
    kind: "send",
    status: "pending",
    payload: { request: { ...corrected, totalAmount: 999, totalVAT: 99 } },
    createdAt: new Date(Date.now() + 2_000),
  });
  const afterCorrection = (await loadEbarimtDocuments(orgId, range, ["arap"])).rows.find((row) => row.id === sent.id)!;
  assert.equal(afterCorrection.total, 550_000);
  assert.equal(afterCorrection.vat, 50_000);

  // Илгээлт бэлтгэгдээгүй валютын нэхэмжлэх → нэхэмжлэхийн MNT дүн (баримтын валютаар БИШ).
  await db
    .update(arApDocuments)
    .set({ ebarimtStatus: "failed", totalAmount: "1000", baseTotalAmount: "3450000" })
    .where(eq(arApDocuments.id, off.id));
  const fx = (await loadEbarimtDocuments(orgId, range, ["arap"])).rows.find((row) => row.id === off.id)!;
  assert.equal(fx.total, 3_450_000);
  assert.equal(fx.vat, 0);
});

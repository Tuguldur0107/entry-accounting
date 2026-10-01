// POS баримтын цонх ↔ eBarimt: (1) B2B худалдан авагчийн ТТД + НЭР баримтад
// (ХСН №16) — нэр ТЕГ-ийн лавлахаас, борлуулалтад хадгалагдаж дахин хэвлэхэд ч гарна;
// (2) шууд илгээлт ТЕГ-д татгалзагдвал баримт `pending` + АЛДААНЫ ТЕКСТТЭЙ ирнэ
// (чимээгүй «илгээж байна» биш), «Дахин илгээх» (sendPosSaleEbarimtNow) амжвал
// сугалаа/QR ТҮР буцна — DB-д хадгалагдахгүй. Хуурамч PosAPI + лавлах.
// DATABASE_URL байхгүй бол алгасна.

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
import { sendPosSaleEbarimtNow } from "../lib/actions/ebarimt";
import { createPosSale, getPosReceipt } from "../lib/actions/pos";
import { db } from "../lib/db";
import {
  inventoryItems,
  memberships,
  organizationProfile,
  organizations,
  posPaymentMethods,
  posSales,
  posSettings,
  posShifts,
  users,
  vatSettings,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const BUYER_TIN = "90201194984";
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

/** Хуурамч PosAPI (`/rest/receipt`) + ТЕГ-ийн лавлах (`/teg/getInfo`). */
let rejectAll = true;
let server: Server | null = null;
let baseUrl = "";
let counter = 0;

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

async function startFakeServer() {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/teg/getInfo")) {
      res.end(JSON.stringify({ status: 200, data: { name: "Гарааны хос хас технологи", found: true, vatPayer: true } }));
      return;
    }
    if (req.url === "/rest/receipt" && req.method === "POST") {
      JSON.parse(body);
      if (rejectAll) {
        res.end(JSON.stringify({ status: "ERROR", message: "Худалдан авагчийн ТТД буруу (туршилт)" }));
        return;
      }
      counter += 1;
      res.end(
        JSON.stringify({
          id: `0379008467880020976${String(counter).padStart(14, "0")}`,
          status: "SUCCESS",
          date: "2026-09-28 12:00:00",
          lottery: "AB 12345678",
          qrData: "QR-TEST-DATA",
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const previousLookupBase = process.env.EBARIMT_PUBLIC_API_BASE;
test.after(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  if (previousLookupBase === undefined) delete process.env.EBARIMT_PUBLIC_API_BASE;
  else process.env.EBARIMT_PUBLIC_API_BASE = previousLookupBase;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

test("POS баримт: B2B худалдан авагчийн нэр, eBarimt алдааг ил гаргаж «Дахин илгээх»-ээр сугалаа/QR", { skip: !DB_READY }, async () => {
  await startFakeServer();
  process.env.EBARIMT_PUBLIC_API_BASE = `${baseUrl}/teg`;
  const [user] = await db
    .insert(users)
    .values({ name: `rr-${STAMP}`, email: `rr-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `Баримт ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `Баримт ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
  await db.insert(vatSettings).values({ userId, organizationId: orgId, isVatPayer: true });

  ok(await tool("create_warehouse", { code: "WH1", name: "Дэлгүүр" }));
  ok(await tool("create_inventory_item", { code: "OIL", name: "Тос", unit: "ш", salesPrice: 9_800 }));
  await db
    .update(inventoryItems)
    .set({ ebarimtClassificationCode: "1051100" })
    .where(and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.code, "OIL")));
  ok(await tool("create_cash_account", { name: "Касс", accountType: "cash", currency: "MNT", glAccount: "10000001" }));
  ok(await tool("update_pos_settings", { allowNegativeStock: true }));
  await db
    .update(posSettings)
    .set({
      ebarimtEnabled: true,
      ebarimtMerchantTin: "37900846788",
      ebarimtBranchNo: "001",
      ebarimtDistrictCode: "2301",
      ebarimtPosNo: "10001",
      ebarimtPosApiUrl: baseUrl,
      ebarimtMode: "server",
    })
    .where(eq(posSettings.organizationId, orgId));
  ok(await tool("open_pos_shift", { cashAccount: "Касс", warehouseCode: "WH1" }, "post"));

  const shift = await db.query.posShifts.findFirst({ where: eq(posShifts.organizationId, orgId) });
  const item = await db.query.inventoryItems.findFirst({
    where: and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.code, "OIL")),
  });
  const cash = await db.query.posPaymentMethods.findFirst({
    where: and(eq(posPaymentMethods.organizationId, orgId), eq(posPaymentMethods.code, "CASH")),
  });
  assert.ok(shift && item && cash, "ээлж, бараа, бэлэн хэлбэр");

  // 1) ТЕГ татгалзана → баримт pending + алдааны текст; худалдан авагчийн нэр, ТТД баримтад.
  const sale = await asOrg(() =>
    createPosSale({
      shiftId: shift.id,
      lines: [{ itemId: item.id, quantity: 1 }],
      payments: [{ paymentMethodId: cash.id, amount: 9_800 }],
      ebarimtCustomerTin: BUYER_TIN,
    })
  );
  assert.ok(!sale.error && sale.receipt, sale.error);
  const receipt = sale.receipt;
  assert.deepEqual(receipt.buyer, { tin: BUYER_TIN, regNo: null, name: "Гарааны хос хас технологи" });
  assert.equal(receipt.ebarimtStatus, "pending", "backoff-оор дахин оролдоно — чимээгүй биш");
  assert.match(receipt.ebarimtError ?? "", /ТТД буруу/);
  assert.equal(receipt.ebarimtLottery, null);

  const stored = await db.query.posSales.findFirst({ where: eq(posSales.id, receipt.saleId) });
  assert.equal(stored?.ebarimtCustomerName, "Гарааны хос хас технологи");

  // 2) Засагдсан → «Дахин илгээх»: сугалаа/QR ТҮР буцна, DB-д хадгалагдахгүй.
  rejectAll = false;
  const retry = await asOrg(() => sendPosSaleEbarimtNow(receipt.saleId));
  assert.ok(!retry.error, retry.error);
  assert.equal(retry.status, "sent");
  assert.equal(retry.ebarimtLottery, "AB 12345678");
  assert.equal(retry.ebarimtQrData, "QR-TEST-DATA");
  assert.equal(retry.reason, null);
  const sent = await db.query.posSales.findFirst({ where: eq(posSales.id, receipt.saleId) });
  assert.equal(sent?.ebarimtStatus, "sent");
  assert.equal(sent?.ebarimtId, retry.ebarimtId);

  // 3) Дахин дарвал давхар илгээхгүй; дахин хэвлэхэд нэр, ТТД хэвээр, сугалаа/QR үгүй.
  const again = await asOrg(() => sendPosSaleEbarimtNow(receipt.saleId));
  assert.equal(again.status, "sent");
  assert.equal(again.ebarimtLottery, null);
  assert.equal(counter, 1, "PosAPI-д нэг л удаа амжилттай илгээсэн");
  const reprint = await asOrg(() => getPosReceipt(receipt.saleId));
  assert.ok(!reprint.error && reprint.receipt, reprint.error);
  assert.equal(reprint.receipt.buyer?.name, "Гарааны хос хас технологи");
  assert.equal(reprint.receipt.ebarimtLottery, null);
});

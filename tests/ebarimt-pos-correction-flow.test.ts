// POS eBarimt: ТЕГ-д БҮРТГЭЛТЭЙ дүн баримт дээрээ (markSent) ба буцаалтын засварын
// төлөв (ebarimtCorrection). Хэсэгчилсэн буцаалтын засвар ТЕГ-д татгалзагдвал баримт
// `sent` хэвээр ч «Анхаарах»-д ил (чимээгүй биш), дүн нь буцаалтаас ӨМНӨХ ТЕГ-ийн
// дүн; дахин илгээж амжвал ҮЛДСЭН дүн. Гараар ДДТД бичсэн борлуулалтын буцаалт →
// «manual» засвар. Хуурамч PosAPI. DATABASE_URL байхгүй бол алгасна.

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
import { resendEbarimt } from "../lib/actions/ebarimt";
import { updateSaleEbarimt } from "../lib/actions/pos";
import { loadEbarimtDocuments } from "../lib/ebarimt/list-data";
import { summarizeEbarimtRows } from "../lib/ebarimt/list-types";
import { processPendingEbarimt } from "../lib/ebarimt/worker";
import { db } from "../lib/db";
import {
  inventoryItems,
  memberships,
  organizationProfile,
  organizations,
  posEbarimtSubmissions,
  posSales,
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

/** Хуурамч PosAPI — `rejectEdits` үед inactiveId-тай (засварын) receipt-ийг татгалзана. */
const received: Record<string, unknown>[] = [];
let rejectEdits = false;
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
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/rest/receipt" && req.method === "POST") {
      const json = JSON.parse(body) as Record<string, unknown>;
      received.push(json);
      if (rejectEdits && json.inactiveId) {
        res.end(JSON.stringify({ status: "ERROR", message: "inactiveId олдсонгүй (туршилт)" }));
        return;
      }
      counter += 1;
      res.end(
        JSON.stringify({
          id: `0379008467880020976${String(counter).padStart(14, "0")}`,
          status: "SUCCESS",
          date: "2026-09-27 12:00:00",
          lottery: "",
          qrData: "",
        })
      );
      return;
    }
    if (req.url === "/rest/receipt" && req.method === "DELETE") {
      res.end(JSON.stringify({ status: "SUCCESS" }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  posApiUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

async function saleByNo(documentNo: string) {
  const sale = await db.query.posSales.findFirst({
    where: and(eq(posSales.organizationId, orgId), eq(posSales.documentNo, documentNo)),
  });
  assert.ok(sale, documentNo);
  return sale;
}

/** Fire-and-forget worker-тэй давхцахгүйн тулд нөхцөл биелэх хүртэл. */
async function settle(documentNo: string, done: (sale: typeof posSales.$inferSelect) => boolean) {
  for (let i = 0; i < 50; i += 1) {
    await processPendingEbarimt(10);
    const sale = await saleByNo(documentNo);
    if (done(sale)) return sale;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return saleByNo(documentNo);
}

async function sell(quantity: number): Promise<string> {
  const result = ok(
    await tool(
      "create_pos_sale",
      { lines: [{ itemCode: "MILK", quantity }], payments: [{ method: "CASH", amount: 1_100 * quantity }] },
      "post"
    )
  );
  const documentNo = result.resultText.match(/POS-\d{4}-\d{4}/)?.[0];
  assert.ok(documentNo, result.resultText);
  return documentNo;
}

const range = { from: "2026-01-01", to: "2026-12-31" };
async function listRow(saleId: string) {
  const { rows } = await loadEbarimtDocuments(orgId, range, ["pos"]);
  const row = rows.find((entry) => entry.id === saleId);
  assert.ok(row, "жагсаалтад мөр");
  return { row, rows };
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

test("POS: ТЕГ-д бүртгэлтэй дүн баримт дээр, амжилтгүй засвар «Анхаарах»-д, гараар ДДТД-ийн буцаалт", { skip: !DB_READY }, async () => {
  await startFakePosApi();
  const [user] = await db
    .insert(users)
    .values({ name: `ec-${STAMP}`, email: `ec-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `eBarimt засвар ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `eBarimt засвар ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
  await db.insert(vatSettings).values({ userId, organizationId: orgId, isVatPayer: true });

  ok(await tool("create_warehouse", { code: "WH1", name: "Дэлгүүр" }));
  ok(await tool("create_inventory_item", { code: "MILK", name: "Сүү", unit: "ш", salesPrice: 1_100 }));
  await db
    .update(inventoryItems)
    .set({ ebarimtClassificationCode: "1051100" })
    .where(and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.code, "MILK")));
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
      ebarimtPosApiUrl: posApiUrl,
      ebarimtMode: "server",
    })
    .where(eq(posSettings.organizationId, orgId));
  ok(await tool("open_pos_shift", { cashAccount: "Касс", warehouseCode: "WH1" }, "post"));

  // 1) Борлуулалт 3 × 1,100 → ТЕГ-д 3,300 / НӨАТ 300 баримт дээр хадгалагдана.
  const saleNo = await sell(3);
  const sent = await settle(saleNo, (sale) => sale.ebarimtStatus === "sent");
  assert.equal(sent.ebarimtStatus, "sent");
  assert.equal(Number(sent.ebarimtTotal), 3_300);
  assert.equal(Number(sent.ebarimtVat), 300);
  const originalId = sent.ebarimtId;

  // 2) Хэсэгчилсэн буцаалт, ТЕГ засварыг ТАТГАЛЗАНА → sent хэвээр, засвар pending
  //    (backoff-оор дахин оролдоно), ТЕГ-ийн дүн буцаалтаас ӨМНӨХ (3,300) — «Анхаарах»-д
  //    ил, алдааны шалтгаантай. Дээд оролдлогод хүрвэл failed.
  rejectEdits = true;
  ok(await tool("return_pos_sale", { sale: saleNo, lines: [{ itemCode: "MILK", quantity: 1 }], reason: "туршилт" }, "post"));
  const rejected = await settle(saleNo, (sale) => sale.ebarimtCorrection !== null);
  assert.equal(rejected.ebarimtStatus, "sent");
  assert.equal(rejected.ebarimtCorrection, "pending");
  assert.equal(rejected.ebarimtId, originalId, "ТЕГ-д хуучин ДДТД хүчинтэй хэвээр");
  let afterFail = await listRow(rejected.id);
  for (let i = 0; i < 50 && !afterFail.row.lastError; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    afterFail = await listRow(rejected.id);
  }
  assert.equal(afterFail.row.correction, "pending");
  assert.equal(afterFail.row.partiallyReturned, true);
  assert.equal(afterFail.row.total, 3_300);
  assert.match(afterFail.row.lastError ?? "", /inactiveId олдсонгүй/);
  assert.equal(summarizeEbarimtRows(afterFail.rows).attention, 1);
  assert.equal(summarizeEbarimtRows(afterFail.rows).reported.total, 3_300, "ТЕГ-д одоо бүртгэлтэй = хуучин баримт");

  // Дээд оролдлогод хүрэв → засвар failed (баримт sent хэвээр).
  await db
    .update(posEbarimtSubmissions)
    .set({ attempts: 19, nextAttemptAt: new Date() })
    .where(and(eq(posEbarimtSubmissions.saleId, rejected.id), eq(posEbarimtSubmissions.kind, "cancel")));
  const failed = await settle(saleNo, (sale) => sale.ebarimtCorrection === "failed");
  assert.equal(failed.ebarimtCorrection, "failed");
  assert.equal(failed.ebarimtStatus, "sent");

  // 3) Засварыг дахин илгээж амжив → засвар цэвэрлэгдэж, ТЕГ-д ҮЛДСЭН 2,200 / 200.
  rejectEdits = false;
  const resend = await asOrg(() => resendEbarimt(failed.id, "cancel"));
  assert.ok(!resend.error, resend.error);
  const fixed = await settle(saleNo, (sale) => sale.ebarimtCorrection === null && Number(sale.ebarimtTotal) === 2_200);
  assert.equal(fixed.ebarimtStatus, "sent", "засвар дахин илгээхэд баримт pending болохгүй");
  assert.equal(fixed.ebarimtCorrection, null);
  assert.notEqual(fixed.ebarimtId, originalId, "засварын шинэ ДДТД");
  assert.equal(Number(fixed.ebarimtVat), 200);
  const afterFix = await listRow(fixed.id);
  assert.equal(afterFix.row.correction, null);
  assert.equal(afterFix.row.total, 2_200);
  assert.equal(afterFix.row.lastError, null);
  assert.equal(summarizeEbarimtRows(afterFix.rows).attention, 0);

  // 4) Бүтэн буцаалт (үлдсэн 2) → DELETE → cancelled, ТЕГ-д бүртгэлтэй дүн 0.
  ok(await tool("return_pos_sale", { sale: saleNo, lines: [{ itemCode: "MILK", quantity: 2 }], reason: "туршилт" }, "post"));
  const cancelled = await settle(saleNo, (sale) => sale.ebarimtStatus === "cancelled");
  assert.equal(cancelled.ebarimtStatus, "cancelled");
  assert.equal(Number(cancelled.ebarimtTotal), 0);
  assert.equal(cancelled.ebarimtCorrection, null);

  // 5) eBarimt УНТРААЛТТАЙ үед буцаавал засвар дараалалд ОРОХГҮЙ — тэмдэггүй ч ТЕГ ↔
  //    Entry тулгалтаар «mismatch» болж «Анхаарах»-д ил; асаагаад «Засвар илгээх» → засагдана.
  const driftNo = await sell(2);
  const driftSent = await settle(driftNo, (sale) => sale.ebarimtStatus === "sent");
  assert.equal(Number(driftSent.ebarimtTotal), 2_200);
  await db.update(posSettings).set({ ebarimtEnabled: false }).where(eq(posSettings.organizationId, orgId));
  ok(await tool("return_pos_sale", { sale: driftNo, lines: [{ itemCode: "MILK", quantity: 1 }], reason: "туршилт" }, "post"));
  const drifted = await saleByNo(driftNo);
  assert.equal(drifted.ebarimtCorrection, null, "дараалалд ороогүй — тэмдэг байхгүй");
  const driftRow = await listRow(drifted.id);
  assert.equal(driftRow.row.correction, "mismatch");
  assert.equal(driftRow.row.total, 2_200, "ТЕГ-д одоо бүртгэлтэй = буцаалтаас өмнөх");
  await db.update(posSettings).set({ ebarimtEnabled: true }).where(eq(posSettings.organizationId, orgId));
  const sendFix = await asOrg(() => resendEbarimt(drifted.id, "cancel"));
  assert.ok(!sendFix.error, sendFix.error);
  const driftFixed = await settle(driftNo, (sale) => Number(sale.ebarimtTotal) === 1_100 && sale.ebarimtCorrection === null);
  assert.equal(Number(driftFixed.ebarimtTotal), 1_100);
  assert.equal((await listRow(drifted.id)).row.correction, null);

  // 6) Гараар ДДТД бичсэн борлуулалт → ТЕГ-д бүтэн дүн; Entry-д буцаахад ТЕГ-д
  //    хүрэхгүй тул «manual» засвар (Анхаарах), дүн нь ТЕГ-д бүртгэлтэй хэвээр.
  await db.update(posSettings).set({ ebarimtEnabled: false }).where(eq(posSettings.organizationId, orgId));
  const manualNo = await sell(2);
  const manualSale = await saleByNo(manualNo);
  const manual = await asOrg(() => updateSaleEbarimt(manualSale.id, { ebarimtId: "0".repeat(33) }));
  assert.ok(!manual.error, manual.error);
  ok(await tool("return_pos_sale", { sale: manualNo, lines: [{ itemCode: "MILK", quantity: 1 }], reason: "туршилт" }, "post"));
  const manualRow = await listRow(manualSale.id);
  assert.equal(manualRow.row.status, "manual");
  assert.equal(manualRow.row.correction, "manual");
  assert.equal(manualRow.row.total, 2_200);
  const summary = summarizeEbarimtRows(manualRow.rows);
  assert.equal(summary.attention, 1);
  assert.equal(summary.reported.total, 2_200 + 1_100, "ТЕГ-д бүртгэлтэй: гараар 2,200 + засагдсан 1,100 (цуцлагдсан 0)");
});

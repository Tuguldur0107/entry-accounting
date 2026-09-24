// ENT-029 — кредит нэхэмжлэл / дебит нэхэмжлэхийн DB integration тест.
// DATABASE_URL шаарддаг: түр байгууллага үүсгэж, төгсгөлд нь purgeOrganization.
//
// Урсгал: АР нэхэмжлэх (бараа + үйлчилгээ + НӨАТ) батлах → хэсэгчилсэн кредит
// (эх нэхэмжлэхэд автоматаар тооцогдоно) → GL/НӨАТ/хөдөлгөөн → кредит буцаах
// (тооцоо сэргэнэ) → эх нэхэмжлэх бүрэн төлөгдсөний дараах кредит (илүүдэл =
// харилцагчийн кредит) → дараагийн нэхэмжлэхтэй суутгах → АП дебит нэхэмжлэх.

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
import { syncStandardAccounts } from "../lib/actions/gl";
import {
  createArApDocument,
  deleteArApDocument,
  reverseArApDocument,
  reverseArApOffset,
  settleArApOffset,
} from "../lib/actions/arap";
import { createCreditNote, getCreditNoteSource } from "../lib/actions/arap-credit-note";
import { db } from "../lib/db";
import { loadArApDocumentDetail } from "../lib/arap/load-data";
import {
  arApDocuments,
  arApSettlements,
  cashDocuments,
  counterparties,
  inventoryItems,
  inventoryMovements,
  journalLines,
  memberships,
  organizations,
  users,
  warehouses,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

function asOrg<T>(fn: () => Promise<T>) {
  return runAsOrg({ userId, orgId }, fn);
}
function tool(name: string, input: unknown, mode: "draft" | "post" = "draft") {
  return asOrg(() => executeAiTool(userId, name, input, mode));
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `cn-${STAMP}`, email: `cn-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `Кредит тест ${STAMP}` })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
  await tool("create_warehouse", { code: "WH1", name: "Төв агуулах" });
  await tool("create_inventory_item", { code: "ITM-A", name: "Бараа А", unit: "ш" });
  await tool("create_counterparty", { name: "Худалдан авагч Б", counterpartyType: "customer" });
  await tool("create_counterparty", { name: "Нийлүүлэгч В", counterpartyType: "supplier" });
}

async function idOf<T extends { id: string }>(rows: Promise<T | undefined>) {
  const row = await rows;
  assert.ok(row, "fixture олдсонгүй");
  return row.id;
}

async function arInvoice(amounts: { goods: number; qty: number; service: number }, date: string) {
  const customerId = await idOf(
    db.query.counterparties.findFirst({
      where: and(eq(counterparties.organizationId, orgId), eq(counterparties.name, "Худалдан авагч Б")),
    })
  );
  const itemId = await idOf(
    db.query.inventoryItems.findFirst({
      where: and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.code, "ITM-A")),
    })
  );
  const warehouseId = await idOf(
    db.query.warehouses.findFirst({
      where: and(eq(warehouses.organizationId, orgId), eq(warehouses.code, "WH1")),
    })
  );
  const vat = Math.round((amounts.goods + amounts.service) * 0.1 * 100) / 100;
  const created = await asOrg(() =>
    createArApDocument({
      documentType: "ar_invoice",
      counterpartyId: customerId,
      date,
      dueDate: date,
      controlAccountNumber: "13110000",
      description: "Борлуулалт",
      postNow: true,
      lines: [
        { account: "51100000", description: "Бараа А", amount: amounts.goods, itemId, quantity: amounts.qty, warehouseId, unitPrice: amounts.goods / amounts.qty },
        { account: "51100000", description: "Суурилуулалт", amount: amounts.service },
        { account: "31410000", description: "НӨАТ 10%", amount: vat },
      ],
    })
  );
  assert.ok(!created.error, `АР нэхэмжлэх: ${created.error}`);
  return created.id!;
}

async function doc(id: string) {
  const row = await db.query.arApDocuments.findFirst({ where: eq(arApDocuments.id, id) });
  assert.ok(row);
  return row;
}

async function voucherTotals(voucherId: string) {
  const lines = await db.query.journalLines.findMany({ where: eq(journalLines.voucherId, voucherId) });
  const byMain = new Map<string, number>();
  for (const line of lines) {
    const main = line.accountNumber.split(".").length === 10 ? line.accountNumber.split(".")[2] : line.accountNumber;
    byMain.set(main, Math.round(((byMain.get(main) ?? 0) + Number(line.debit) - Number(line.credit)) * 100) / 100);
  }
  return byMain;
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

test("ENT-029: хэсэгчилсэн кредит нэхэмжлэл — GL, эх нэхэмжлэхэд тооцох, return_in, буцаалт", { skip: !DB_READY }, async () => {
  await setupOrg();
  // 10 ш × 1,000 + үйлчилгээ 500 + НӨАТ 1,050 = 11,550
  const invoiceId = await arInvoice({ goods: 10_000, qty: 10, service: 500 }, "2025-04-10");

  const sourceView = await asOrg(() => getCreditNoteSource(invoiceId));
  assert.ok(!sourceView.error, sourceView.error);
  const goodsLine = sourceView.source!.lines.find((l) => l.description === "Бараа А")!;
  assert.equal(sourceView.source!.lines.find((l) => l.description === "НӨАТ 10%")!.isVat, true);

  // 3 ширхэг буцаалт → 3,000 + НӨАТ хувиар 300 (3,000/10,500 × 1,050)
  const cn = await asOrg(() =>
    createCreditNote({
      sourceDocumentId: invoiceId,
      date: "2025-04-15",
      reason: "Гэмтэлтэй бараа",
      lines: [{ sourceLineId: goodsLine.id, quantity: 3 }],
      postNow: true,
    })
  );
  assert.ok(!cn.error && !cn.postError, `кредит: ${cn.error ?? cn.postError}`);
  assert.equal(cn.total, 3300);
  assert.match(cn.documentNo!, /^CN-20250415-/);

  const credit = await doc(cn.id!);
  assert.equal(credit.documentType, "ar_credit_note");
  assert.equal(credit.status, "paid", "эх нэхэмжлэхэд бүрэн тооцогдоно");
  const source = await doc(invoiceId);
  assert.equal(Number(source.paidAmount), 3300);
  assert.equal(source.status, "partially_paid");

  // GL: Dr 51900001 3,000 + Dr 31410000 300 / Cr 13110000 3,300
  const gl = await voucherTotals(credit.voucherId!);
  assert.equal(gl.get("51900001"), 3000);
  assert.equal(gl.get("31410000"), 300);
  assert.equal(gl.get("13110000"), -3300);

  // Бараа буцаалтын НООРОГ return_in хөдөлгөөн (3 ш)
  const creditLines = await db.query.arApDocumentLines.findMany({
    where: (l, { eq: e }) => e(l.documentId, cn.id!),
  });
  const movement = await db.query.inventoryMovements.findFirst({
    where: and(eq(inventoryMovements.sourceType, "arap_line"), eq(inventoryMovements.sourceId, creditLines.find((l) => l.itemId)!.id)),
  });
  assert.equal(movement?.movementType, "return_in");
  assert.equal(Number(movement?.quantity), 3);

  // Панелийн өгөгдөл: кредит → эх нэхэмжлэх, эх → кредитүүд (self relation)
  const creditDetail = await loadArApDocumentDetail(orgId, cn.id!);
  assert.equal(creditDetail?.sourceDocumentNo, source.documentNo);
  const sourceDetail = await loadArApDocumentDetail(orgId, invoiceId);
  assert.deepEqual(sourceDetail?.creditDocuments.map((d) => d.documentNo), [cn.documentNo]);
  assert.equal(sourceDetail?.sourceDocumentId, null);

  // Эх мөрийн үлдэгдлээс хэтрэхгүй (7 үлдсэн)
  const over = await asOrg(() =>
    createCreditNote({ sourceDocumentId: invoiceId, date: "2025-04-16", lines: [{ sourceLineId: goodsLine.id, quantity: 8 }] })
  );
  assert.match(over.error ?? "", /CREDIT_QTY_EXCEEDS/);

  // Эх нэхэмжлэх идэвхтэй кредиттэй — буцаагдахгүй, суутгалын тооцоо буцаагдахгүй
  assert.match((await asOrg(() => reverseArApDocument(invoiceId))).error ?? "", /Төлөлттэй|HAS_CREDIT_NOTES/);
  assert.match((await asOrg(() => reverseArApOffset(credit.voucherId!))).error ?? "", /CREDIT_OWN_APPLICATION/);
  assert.match((await asOrg(() => deleteArApDocument(cn.id!))).error ?? "", /CREDIT_DELETE_POSTED/);

  // Кредит буцаах → тооцоо сэргэнэ, ноорог хөдөлгөөн устна
  const reversed = await asOrg(() => reverseArApDocument(cn.id!));
  assert.ok(!reversed.error, reversed.error);
  const restored = await doc(invoiceId);
  assert.equal(Number(restored.paidAmount), 0);
  assert.equal(restored.status, "posted");
  assert.equal((await doc(cn.id!)).status, "reversed");
  assert.equal(
    (await db.query.arApSettlements.findMany({ where: eq(arApSettlements.voucherId, credit.voucherId!) })).length,
    0
  );
  assert.equal(
    (await db.query.inventoryMovements.findFirst({ where: eq(inventoryMovements.id, movement!.id) })),
    undefined
  );
  // Буцаагдсан кредит үлдэгдэлд тооцогдохгүй — бүтэн буцаалт бүх мөрийг авна
  const again = await asOrg(() => getCreditNoteSource(invoiceId));
  assert.equal(again.source!.lines.find((l) => l.id === goodsLine.id)!.remainingQuantity, 10);
});

test("ENT-029: төлөгдсөн нэхэмжлэхийн кредит → харилцагчийн кредит → дараагийн нэхэмжлэхтэй суутгах", { skip: !DB_READY }, async () => {
  await setupOrg();
  const invoiceId = await arInvoice({ goods: 2_000, qty: 2, service: 0.01 }, "2025-05-02");
  // Бүрэн төлөгдсөн гэж тэмдэглэхийн оронд бодит кассын баримт
  const cash = await tool(
    "create_cash_account",
    { name: `Касс ${STAMP}`, accountType: "bank", currency: "MNT", glAccount: "11000001" }
  );
  assert.ok(!cash.resultText.startsWith("Алдаа"), cash.resultText);
  const sourceBefore = await doc(invoiceId);
  const pay = await tool(
    "pay_arap_document",
    { documentId: sourceBefore.documentNo, amount: Number(sourceBefore.totalAmount), date: "2025-05-03", cashAccount: `Касс ${STAMP}` },
    "post"
  );
  assert.ok(!pay.resultText.startsWith("Алдаа"), pay.resultText);
  assert.equal((await doc(invoiceId)).status, "paid");

  const cn = await asOrg(() => createCreditNote({ sourceDocumentId: invoiceId, date: "2025-05-05", postNow: true }));
  assert.ok(!cn.error && !cn.postError, cn.error ?? cn.postError);
  const credit = await doc(cn.id!);
  assert.equal(credit.status, "posted", "төлөгдсөн эх нэхэмжлэхэд тооцох үлдэгдэлгүй — кредит нээлттэй");
  assert.equal(Number(credit.totalAmount), 2200.01);

  // Дараагийн нэхэмжлэхтэй суутгах (нэхэмжлэл ↔ кредит нэхэмжлэл)
  const next = await arInvoice({ goods: 5_000, qty: 5, service: 0 }, "2025-05-10");
  const offset = await asOrg(() =>
    settleArApOffset({ arDocumentId: cn.id!, apDocumentId: next, date: "2025-05-10" })
  );
  assert.ok(!offset.error, offset.error);
  assert.equal((await doc(cn.id!)).status, "paid");
  assert.equal(Number((await doc(next)).paidAmount), 2200.01);
  const gl = await voucherTotals(offset.voucherId!);
  assert.equal(gl.get("13110000"), 0, "нэг хяналтын данс дотор Dr/Cr тэнцэнэ");

  // Кредит баримтыг суутгалтай үед буцаахгүй
  assert.match((await asOrg(() => reverseArApDocument(cn.id!))).error ?? "", /суутгасан/);
  const undo = await asOrg(() => reverseArApOffset(offset.voucherId!));
  assert.ok(!undo.error, undo.error);
  assert.equal((await doc(cn.id!)).status, "posted");

  // Кредитийн илүүдлийг кассаар буцаан олгох — ЗАРЛАГА (Dr авлага / Cr банк)
  const refund = await tool(
    "pay_arap_document",
    { documentId: credit.documentNo, amount: 200, date: "2025-05-12", cashAccount: `Касс ${STAMP}` },
    "post"
  );
  assert.ok(!refund.resultText.startsWith("Алдаа"), refund.resultText);
  const afterRefund = await doc(cn.id!);
  assert.equal(afterRefund.status, "partially_paid");
  assert.equal(Number(afterRefund.paidAmount), 200);
  const refundDoc = await db.query.cashDocuments.findFirst({
    where: eq(cashDocuments.arApDocumentId, cn.id!),
  });
  assert.equal(refundDoc?.documentType, "payment");
  const refundGl = await voucherTotals(refundDoc!.voucherId!);
  assert.equal(refundGl.get("13110000"), 200, "авлагын данс Дт — кредит үлдэгдэл буурна");
  assert.equal(refundGl.get("11000001"), -200);
});

test("ENT-029: АП дебит нэхэмжлэх — эх данс, оролтын НӨАТ, return_out", { skip: !DB_READY }, async () => {
  await setupOrg();
  const bill = await tool(
    "create_arap_invoice",
    {
      documentType: "ap_bill",
      counterparty: "Нийлүүлэгч В",
      date: "2025-06-02",
      description: "Бараа татан авалт",
      vatMode: "exclusive",
      lines: [{ itemCode: "ITM-A", warehouseCode: "WH1", quantity: 10, unitPrice: 800, description: "Бараа А" }],
    },
    "post"
  );
  assert.ok(!bill.resultText.startsWith("Алдаа"), bill.resultText);
  const billDoc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.documentType, "ap_bill")),
  });
  assert.ok(billDoc);
  const view = await asOrg(() => getCreditNoteSource(billDoc.id));
  const goods = view.source!.lines.find((l) => !l.isVat)!;
  const dn = await asOrg(() =>
    createCreditNote({ sourceDocumentId: billDoc.id, date: "2025-06-05", lines: [{ sourceLineId: goods.id, quantity: 2 }], postNow: true })
  );
  assert.ok(!dn.error && !dn.postError, dn.error ?? dn.postError);
  const debit = await doc(dn.id!);
  assert.equal(debit.documentType, "ap_debit_note");
  assert.match(debit.documentNo, /^DN-/);
  const gl = await voucherTotals(debit.voucherId!);
  // Dr AP 1,760 / Cr клиринг 1,600 + Cr оролтын НӨАТ 160
  assert.equal(gl.get("13620000"), -160);
  assert.equal(Math.round([...gl.values()].reduce((a, b) => a + b, 0) * 100) / 100, 0);
  const apMain = billDoc.controlAccountNumber.split(".").length === 10 ? billDoc.controlAccountNumber.split(".")[2] : billDoc.controlAccountNumber;
  assert.equal(gl.get(apMain), 1760);
  assert.equal(Number((await doc(billDoc.id)).paidAmount), 1760);
  const dnLine = await db.query.arApDocumentLines.findFirst({
    where: (l, { and: a, eq: e, isNotNull }) => a(e(l.documentId, dn.id!), isNotNull(l.itemId)),
  });
  const movement = await db.query.inventoryMovements.findFirst({
    where: and(eq(inventoryMovements.sourceType, "arap_line"), eq(inventoryMovements.sourceId, dnLine!.id)),
  });
  assert.equal(movement?.movementType, "return_out");
});

test("ENT-029: AI create_credit_note — preview, lineNo-оор хэсэгчилсэн, post горимд батлагдана", { skip: !DB_READY }, async () => {
  await setupOrg();
  const invoiceId = await arInvoice({ goods: 4_000, qty: 4, service: 1_000 }, "2025-07-01");
  const source = await doc(invoiceId);
  const preview = await tool("create_credit_note", { sourceDocument: source.documentNo, preview: true });
  assert.match(preview.resultText, /#1 Бараа А/);
  assert.match(preview.resultText, /НӨАТ — автоматаар/);
  const created = await tool(
    "create_credit_note",
    { sourceDocument: source.documentNo, date: "2025-07-03", reason: "Буцаалт", lines: [{ lineNo: 1, quantity: 1 }] },
    "post"
  );
  assert.ok(!created.resultText.startsWith("Алдаа"), created.resultText);
  assert.match(created.resultText, /Кредит нэхэмжлэл үүслээ: CN-.*1,100₮.*батлагдсан/);
  assert.equal(Number((await doc(invoiceId)).paidAmount), 1100);
  // НӨАТ-ын мөрийг сонгоход ил алдаа
  const vatPick = await tool("create_credit_note", { sourceDocument: source.documentNo, lines: [{ lineNo: 3 }] });
  assert.match(vatPick.resultText, /CREDIT_VAT_AUTO/);
});

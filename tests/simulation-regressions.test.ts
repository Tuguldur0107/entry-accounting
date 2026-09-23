// SIM Trade ХХК симуляцийн олдворуудын (entry_simulation_issues.xlsx, ENT-xxx)
// DB integration регресс тест. DATABASE_URL шаарддаг (ai-tools-flow-тэй ижил
// хэв маяг): түр байгууллага үүсгэж, төгсгөлд нь cascade-аар устгана.

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
  // патчлагдахгүй орчинд okOrRevalidate fallback ажиллана
}

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { db } from "../lib/db";
import {
  arApDocuments,
  cashAccounts,
  cashDocuments,
  cashFxRevaluations,
  exchangeRates,
  costEntries,
  faDepreciationEntries,
  fixedAssets,
  goodsReceipts,
  inventoryMovements,
  journalLines,
  journalVouchers,
  memberships,
  organizations,
  purchaseOrders,
  users,
} from "../lib/db/schema";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const cleanup: (() => Promise<void>)[] = [];

let userId = "";
let orgId = "";

function okOrRevalidate(resultText: string): boolean {
  return !resultText.startsWith("Алдаа") || resultText.includes("static generation store");
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `sim-${STAMP}`, email: `sim-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `SIM регресс ${STAMP}` })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    // PO-той байгууллагын cascade устгалт RESTRICT FK-ийн дарааллаас болж
    // унадаг (purchase_order_lines.item_id, ar_ap_documents.purchase_order_id)
    // тул PO-гийн гинжийг эхлээд устгана.
    await db.transaction(async (tx) => {
      await tx.delete(cashDocuments).where(eq(cashDocuments.organizationId, org.id));
      await tx.delete(arApDocuments).where(eq(arApDocuments.organizationId, org.id));
      await tx.delete(goodsReceipts).where(eq(goodsReceipts.organizationId, org.id));
      await tx.delete(purchaseOrders).where(eq(purchaseOrders.organizationId, org.id));
    });
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  const sync = await runAsOrg({ userId, orgId }, () => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
}

export function tool(name: string, input: unknown, mode: "draft" | "post" = "draft") {
  return runAsOrg({ userId, orgId }, () => executeAiTool(userId, name, input, mode));
}

test("ENT-069: get_counterparty_balance SQL алдаагүй, asOf-оор үлдэгдэл/aging", { skip: !DB_READY }, async () => {
  await setupOrg();
  const cp = await tool("create_counterparty", { name: "Скай Трэйдинг", counterpartyType: "customer" });
  assert.ok(okOrRevalidate(cp.resultText), cp.resultText);
  const invoice = await tool(
    "create_arap_invoice",
    {
      documentType: "ar_invoice",
      counterparty: "Скай Трэйдинг",
      date: "2025-01-10",
      dueDate: "2025-02-09",
      description: "Борлуулалт",
      externalRef: `sim-${STAMP}-ar1`,
      lines: [{ account: "51100000", description: "Бараа", amount: 2_750_000 }],
    },
    "post"
  );
  assert.ok(okOrRevalidate(invoice.resultText), invoice.resultText);

  const balance = await tool("get_counterparty_balance", {
    counterparty: "Скай",
    asOf: "2025-03-31",
    aging: true,
  });
  assert.ok(!balance.resultText.startsWith("Алдаа"), balance.resultText);
  assert.match(balance.resultText, /2,750,000/);

  const before = await tool("get_counterparty_balance", { asOf: "2025-01-05" });
  assert.ok(!before.resultText.startsWith("Алдаа"), before.resultText);
  assert.doesNotMatch(before.resultText, /2,750,000/);
});

test("ENT-018 + ENT-043: PO-гүй АП орлого автоматаар капиталжиж, нэг блок бусдыг зогсоохгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  for (const [code, name] of [["WH1", "Төв агуулах"]])
    assert.ok(okOrRevalidate((await tool("create_warehouse", { code, name })).resultText));
  for (const [code, name] of [["ITM-A", "Цэнэглэгч 20W"], ["ITM-B", "Утасны гэр"]])
    assert.ok(okOrRevalidate((await tool("create_inventory_item", { code, name, unit: "ш" })).resultText));
  assert.ok(okOrRevalidate((await tool("create_counterparty", { name: "Нийлүүлэгч А", counterpartyType: "supplier" })).resultText));

  // PO-гүй АП нэхэмжлэх: 10 ш × 32,000
  const bill = await tool(
    "create_arap_invoice",
    {
      documentType: "ap_bill",
      counterparty: "Нийлүүлэгч А",
      date: "2025-03-05",
      description: "Бараа татан авалт",
      externalRef: `sim-${STAMP}-ap1`,
      lines: [{ itemCode: "ITM-A", warehouseCode: "WH1", quantity: 10, unitPrice: 32000, description: "Цэнэглэгч" }],
    },
    "post"
  );
  assert.ok(okOrRevalidate(bill.resultText), bill.resultText);

  const [draftMovement] = await db.query.inventoryMovements.findMany({
    where: and(eq(inventoryMovements.organizationId, orgId), eq(inventoryMovements.sourceType, "arap_line")),
  });
  assert.ok(draftMovement, "АП мөрөөс орлогын ноорог үүссэн байх ёстой");
  const confirm = await tool("confirm_inventory_movement", { movementId: draftMovement.id }, "post");
  assert.ok(okOrRevalidate(confirm.resultText), confirm.resultText);

  const [capitalized] = await db.query.costEntries.findMany({
    where: and(eq(costEntries.movementId, draftMovement.id), eq(costEntries.entryType, "receipt_capitalize")),
  });
  assert.ok(capitalized, "ENT-018: батлахад капитализацийн ноорог автоматаар үүснэ");
  assert.equal(Number(capitalized.unitCost), 32000);
  assert.equal(Number(capitalized.amount), 320000);
  assert.equal(capitalized.valuationSource, "ap_line");

  // ITM-B: өртөггүй гар орлого → тэр хүрээ блоклогдоно
  const manualIn = await tool(
    "create_inventory_movement",
    { movementType: "receipt", date: "2025-03-06", itemCode: "ITM-B", warehouseCode: "WH1", quantity: 5 },
    "post"
  );
  assert.ok(okOrRevalidate(manualIn.resultText), manualIn.resultText);
  for (const [itemCode, quantity] of [["ITM-A", 4], ["ITM-B", 2]] as const) {
    const out = await tool(
      "create_inventory_movement",
      { movementType: "issue", date: "2025-03-20", itemCode, warehouseCode: "WH1", quantity },
      "post"
    );
    assert.ok(okOrRevalidate(out.resultText), out.resultText);
  }

  const costing = await tool("run_monthly_costing", { period: "2025-03" });
  assert.ok(!costing.resultText.startsWith("Алдаа"), costing.resultText);
  assert.match(costing.resultText, /БЛОКЛОГДСОН/);
  // ENT-043: ITM-A-ийн зарлага 4 × 32,000 үнэлэгдэнэ (урьд нь 0)
  const issues = await db.query.costEntries.findMany({
    where: and(eq(costEntries.organizationId, orgId), eq(costEntries.entryType, "issue_cogs")),
  });
  assert.equal(issues.length, 1, costing.resultText);
  assert.equal(Number(issues[0].amount), 128000);
});

test("ENT-035/024: НӨАТ тооцооны журнал ҮЕИЙН СҮҮЛИЙН огноогоор, тайлан өөрчлөгдөхгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  assert.ok(okOrRevalidate((await tool("create_counterparty", { name: "НӨАТ Харилцагч", counterpartyType: "both" })).resultText));
  const sale = await tool(
    "create_arap_invoice",
    {
      documentType: "ar_invoice", counterparty: "НӨАТ Харилцагч", date: "2025-04-10",
      description: "НӨАТ-тай борлуулалт", externalRef: `sim-${STAMP}-vat-ar`, vatMode: "exclusive",
      lines: [{ account: "51100000", description: "Үйлчилгээ", amount: 1_000_000 }],
    },
    "post"
  );
  assert.ok(okOrRevalidate(sale.resultText), sale.resultText);
  const buy = await tool(
    "create_arap_invoice",
    {
      documentType: "ap_bill", counterparty: "НӨАТ Харилцагч", date: "2025-04-12",
      description: "НӨАТ-тай худалдан авалт", externalRef: `sim-${STAMP}-vat-ap`, vatMode: "exclusive",
      lines: [{ account: "73100001", description: "Зардал", amount: 2_000_000 }],
    },
    "post"
  );
  assert.ok(okOrRevalidate(buy.resultText), buy.resultText);

  const before = await tool("get_vat_return", { period: "2025-04" });
  assert.match(before.resultText, /Гаралтын НӨАТ \(борлуулалт\): 100,000/);
  const settle = await tool("create_vat_settlement", { period: "2025-04" });
  assert.ok(okOrRevalidate(settle.resultText), settle.resultText);
  const [voucher] = await db.query.journalVouchers.findMany({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.externalRef, "vat-settlement:2025-04")),
  });
  assert.ok(voucher, "тооцооны ноорог үүссэн байх ёстой");
  assert.equal(voucher.date, "2025-04-30");
  const posted = await tool("post_journal_voucher", { voucherId: voucher.id }, "post");
  assert.ok(okOrRevalidate(posted.resultText), posted.resultText);
  const after = await tool("get_vat_return", { period: "2025-04" });
  assert.match(after.resultText, /Гаралтын НӨАТ \(борлуулалт\): 100,000/);
  assert.match(after.resultText, /Дараа сард шилжүүлэх: 100,000/);
  // ENT-052: дараагийн сард 100,000 кредит шилжинэ
  const next = await tool("get_vat_return", { period: "2025-05" });
  assert.match(next.resultText, /шилжсэн оролтын НӨАТ: 100,000/);
});

test("ENT-027/028: байхгүй огноо татгалзаж, ирээдүйн сар ноорог үлдэнэ", { skip: !DB_READY }, async () => {
  await setupOrg();
  const lines = [
    { account: "73100001", debit: 50_000, description: "Зардал" },
    { account: "11000001", credit: 50_000, description: "Банк" },
  ];
  const invalid = await tool(
    "create_journal_voucher",
    { date: "2025-02-30", description: "Байхгүй огноо", externalRef: `sim-${STAMP}-bad-date`, lines },
    "post"
  );
  assert.match(invalid.resultText, /хуанлид байхгүй/);
  const bad = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.externalRef, `sim-${STAMP}-bad-date`)),
  });
  assert.equal(bad, undefined, "буруу огноотой журнал үүсэх ёсгүй");

  const future = await tool(
    "create_journal_voucher",
    { date: "2099-06-01", description: "Ирээдүйн", externalRef: `sim-${STAMP}-future`, lines },
    "post"
  );
  assert.ok(okOrRevalidate(future.resultText), future.resultText);
  assert.match(future.resultText, /ирээдүйн тайлант үе/);
  const draft = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.externalRef, `sim-${STAMP}-future`)),
  });
  assert.equal(draft?.status, "draft");
  const post = await tool("post_journal_voucher", { voucherId: draft!.id }, "post");
  assert.match(post.resultText, /ирээдүйн тайлант үе/);
  const still = await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, draft!.id) });
  assert.equal(still?.status, "draft");
});

test("ENT-011/012: валютын кассын нээлт — нээлтийн огноо, FC × ханш", { skip: !DB_READY }, async () => {
  await setupOrg();
  const missingDate = await tool("create_cash_account", {
    name: "Голомт USD огноогүй", accountType: "bank", currency: "USD", glAccount: "11000001", openingBalance: 12_000,
  });
  assert.match(missingDate.resultText, /НЭЭЛТИЙН ОГНОО/);

  const created = await tool("create_cash_account", {
    name: "Голомт банк USD", accountType: "bank", currency: "USD", glAccount: "11000001",
    openingBalance: 12_000, openingDate: "2024-12-31", openingRate: 3420.46,
  });
  assert.ok(okOrRevalidate(created.resultText), created.resultText);
  const account = await db.query.cashAccounts.findFirst({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.name, "Голомт банк USD")),
  });
  assert.equal(account?.openingDate, "2024-12-31");

  const fixed = await tool("fix_cash_opening_balance", { cashAccount: "Голомт банк USD" });
  assert.ok(okOrRevalidate(fixed.resultText), fixed.resultText);
  const voucher = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.externalRef, `cash-opening:${account!.id}`)),
  });
  assert.ok(voucher);
  assert.equal(voucher.date, "2024-12-31");
  assert.equal(voucher.currency, "USD");
  assert.equal(Number(voucher.exchangeRate), 3420.46);
  assert.equal(voucher.rateSource, "manual");
  const lines = await db.query.journalLines.findMany({ where: eq(journalLines.voucherId, voucher.id) });
  const cashLine = lines.find((line) => line.cashAccountId === account!.id);
  assert.equal(Number(cashLine?.debit), 41_045_520);
  assert.equal(Number(cashLine?.debitFc), 12_000);
  const counter = lines.find((line) => line.cashAccountId !== account!.id);
  assert.equal(Number(counter?.credit), 41_045_520);
  assert.equal(Number(counter?.creditFc), 12_000);
});

test("ENT-002/049/066/046/001: ҮХ-ийн нээлтийн хуримтлагдсан элэгдэл", { skip: !DB_READY }, async () => {
  await setupOrg();
  // ENT-046: нээлтийн журналын ҮХ-ийн мөр ноорог карт үүсгэхгүй
  const opening = await tool(
    "create_journal_voucher",
    {
      date: "2024-12-31",
      description: "[ОНБ] Нээлтийн үлдэгдэл 2024-12-31",
      externalRef: `opening-balance:2024-12-31-${STAMP}`,
      lines: [
        { account: "20000001", debit: 12_000_000, description: "ҮХ" },
        { account: "20000002", credit: 11_250_000, description: "Хуримт. элэгдэл" },
        { account: "41000001", credit: 750_000, description: "Эздийн өмч" },
      ],
    },
    "post"
  );
  assert.ok(okOrRevalidate(opening.resultText), opening.resultText);
  const drafts = await db.query.fixedAssets.findMany({
    where: and(eq(fixedAssets.organizationId, orgId), eq(fixedAssets.status, "draft")),
  });
  assert.equal(drafts.length, 0, "нээлтийн журнал ноорог карт үүсгэх ёсгүй");

  const created = await tool(
    "create_fixed_asset",
    {
      name: "Дэлгүүрийн тавиур", acquisitionDate: "2021-03-20", cost: 12_000_000, usefulLifeMonths: 48,
      custodian: "Б.Бат", depreciationStartMonth: "2021-04",
      openingAccumulatedDepreciation: 11_250_000, openingAsOf: "2024-12-31",
    },
    "post"
  );
  assert.ok(okOrRevalidate(created.resultText), created.resultText);
  const asset = await db.query.fixedAssets.findFirst({
    where: and(eq(fixedAssets.organizationId, orgId), eq(fixedAssets.name, "Дэлгүүрийн тавиур")),
  });
  assert.ok(asset);
  // ENT-001: биет ҮХ-ийн анхдагч хос
  assert.equal(asset.assetAccountNumber, "20000001");
  assert.equal(asset.accumDepAccountNumber, "20000002");

  for (const month of ["2025-01", "2025-02", "2025-03", "2025-04"]) {
    const ran = await tool("run_fa_depreciation", { month });
    assert.ok(okOrRevalidate(ran.resultText), ran.resultText);
    if (month !== "2025-04") {
      const posted = await tool("post_fa_depreciation", { month }, "post");
      assert.ok(okOrRevalidate(posted.resultText), posted.resultText);
    }
  }
  const entries = await db.query.faDepreciationEntries.findMany({
    where: eq(faDepreciationEntries.assetId, asset.id),
  });
  assert.deepEqual(
    entries.map((entry) => [entry.periodMonth, Number(entry.amount)]).sort(),
    [["2025-01", 250_000], ["2025-02", 250_000], ["2025-03", 250_000]],
    "хугацаа дууссан 2025-04-д элэгдэхгүй"
  );

  const disposed = await tool(
    "dispose_fixed_asset",
    {
      assetCode: asset.code, disposalType: "sale", date: "2025-10-15", proceeds: 500_000,
      proceedsAccount: "11000001", gainLossAccount: "87000004",
    },
    "post"
  );
  assert.ok(okOrRevalidate(disposed.resultText), disposed.resultText);
  const after = await db.query.fixedAssets.findFirst({ where: eq(fixedAssets.id, asset.id) });
  const lines = await db.query.journalLines.findMany({
    where: eq(journalLines.voucherId, after!.disposalVoucherId!),
  });
  const byMain = (main: string) =>
    lines
      .filter((line) => line.accountNumber.split(".")[2] === main || line.accountNumber === main)
      .reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0);
  assert.equal(byMain("20000002"), 12_000_000, "нээлт + системийн хуримтлагдсан хоёулаа хаагдана");
  assert.equal(byMain("87000004"), -500_000, "олз 500,000 (хиймэл гарз биш)");
});

test("ENT-023/020: ханшийн тэгшитгэл тэмдэггүй нээлтийн журналыг тооцно, тулгалт FC-г ₮-тэй хольохгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  const created = await tool("create_cash_account", {
    name: "Хаан банк USD", accountType: "bank", currency: "USD", glAccount: "11000002",
    openingBalance: 1_000, openingDate: "2024-12-31", openingRate: 3420.46,
  });
  assert.ok(okOrRevalidate(created.resultText), created.resultText);
  // Нээлтийг ГАРААР (cashAccountId тэмдэггүй) GL журналаар бичсэн — SIM-ийн хувилбар
  const opening = await tool(
    "create_journal_voucher",
    {
      date: "2024-12-31", description: "Нээлт USD", externalRef: `sim-${STAMP}-usd-open`,
      lines: [
        { account: "11000002", debit: 3_420_460, description: "Хаан USD 1,000 × 3,420.46" },
        { account: "41000001", credit: 3_420_460, description: "Эздийн өмч" },
      ],
    },
    "post"
  );
  assert.ok(okOrRevalidate(opening.resultText), opening.resultText);

  const reconcile = await tool("reconcile_modules", { from: "2024-12-01", to: "2024-12-31" });
  assert.match(reconcile.resultText, /OK Хаан банк USD \[1,000 USD\]: 3,420,460/);

  const reval = await tool(
    "run_fx_revaluation",
    { valuationDate: "2025-01-31", cashAccount: "Хаан банк USD", rate: 3448.24, manualReason: "Регресс тест" },
    "post"
  );
  assert.ok(okOrRevalidate(reval.resultText), reval.resultText);
  const account = await db.query.cashAccounts.findFirst({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.name, "Хаан банк USD")),
  });
  const row = await db.query.cashFxRevaluations.findFirst({
    where: eq(cashFxRevaluations.cashAccountId, account!.id),
  });
  assert.equal(Number(row?.carryingAmount), 3_420_460);
  assert.equal(Number(row?.adjustmentAmount), 27_780, "зөв зөрүү 1,000 × (3,448.24 − 3,420.46)");
});

test("ENT-038/071/037: USD PO-гийн ₮ гаалийн нэхэмжлэх MNT, валютын данснаас төлөхөд ханш автомат", { skip: !DB_READY }, async () => {
  await setupOrg();
  // Store-first: тухайн өдрийн албан ханшийг агуулахад бэлдэнэ (сүлжээ хөндөхгүй).
  const inserted = await db
    .insert(exchangeRates)
    .values({ source: "mongolbank", date: "2025-02-10", currency: "USD", officialRate: "3450" })
    .onConflictDoNothing()
    .returning({ id: exchangeRates.id });
  cleanup.push(async () => {
    for (const row of inserted) await db.delete(exchangeRates).where(eq(exchangeRates.id, row.id));
  });

  assert.ok(okOrRevalidate((await tool("create_counterparty", { name: "USD Нийлүүлэгч", counterpartyType: "supplier", currency: "USD" })).resultText));
  assert.ok(okOrRevalidate((await tool("create_counterparty", { name: "Гаалийн газар", counterpartyType: "supplier" })).resultText));
  assert.ok(okOrRevalidate((await tool("save_cost_component", { code: "CUSTOMS", name: "Гаалийн татвар" })).resultText));
  const po = await tool("create_purchase_order", {
    supplier: "USD Нийлүүлэгч", date: "2025-02-05", currency: "USD", exchangeRate: 3440,
    description: "Импорт", documentNo: `PO-SIM-${STAMP}`, warehouseCode: "WH1",
    lines: [{ itemCode: "ITM-A", quantity: 10, unitPrice: 100 }],
  });
  assert.ok(okOrRevalidate(po.resultText), po.resultText);
  const approved = await tool("approve_purchase_order", { purchaseOrderId: `PO-SIM-${STAMP}`, exchangeRate: 3440 }, "post");
  assert.ok(okOrRevalidate(approved.resultText), approved.resultText);

  const customs = await tool("create_arap_invoice", {
    documentType: "ap_bill", counterparty: "Гаалийн газар", date: "2025-02-10",
    purchaseOrder: `PO-SIM-${STAMP}`, description: "Гаалийн татвар", externalRef: `sim-${STAMP}-customs`,
    lines: [{ amount: 500_000, costComponentCode: "CUSTOMS", description: "Гааль" }],
  });
  assert.ok(okOrRevalidate(customs.resultText), customs.resultText);
  const doc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `sim-${STAMP}-customs`)),
  });
  assert.equal(doc?.currency, "MNT", "гаалийн ₮ нэхэмжлэх PO-гийн USD-г өвлөхгүй");

  // ENT-037: USD нэхэмжлэхийг USD данснаас ханшгүйгээр төлөхөд албан ханш автомат
  const bill = await tool(
    "create_arap_invoice",
    {
      documentType: "ap_bill", counterparty: "USD Нийлүүлэгч", date: "2025-02-10", currency: "USD",
      exchangeRate: 3450, description: "Үйлчилгээ", externalRef: `sim-${STAMP}-usd-bill`,
      lines: [{ account: "73100001", amount: 100, description: "Үйлчилгээ" }],
    },
    "post"
  );
  assert.ok(okOrRevalidate(bill.resultText), bill.resultText);
  const usdBill = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `sim-${STAMP}-usd-bill`)),
  });
  const paid = await tool("pay_arap_document", {
    documentId: usdBill!.documentNo, cashAccount: "Хаан банк USD", date: "2025-02-10",
  });
  assert.ok(okOrRevalidate(paid.resultText), paid.resultText);
  assert.match(paid.resultText, /ханш 3450/);
});

test("цэвэрлэгээ", { skip: !DB_READY }, async () => {
  for (const fn of cleanup.reverse()) await fn();
});

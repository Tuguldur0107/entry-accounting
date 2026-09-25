// SIM Trade ХХК симуляцийн олдворуудын (entry_simulation_issues.xlsx, ENT-xxx)
// DB integration регресс тест. DATABASE_URL шаарддаг (ai-tools-flow-тэй ижил
// хэв маяг): түр байгууллага үүсгэж, төгсгөлд нь бодит устгалтын замаар (purgeOrganization) устгана.

import "./helpers/load-env";

import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";

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
import { createArApDocument } from "../lib/actions/arap";
import { updateCashAccount } from "../lib/actions/cash";
import { runCosting } from "../lib/actions/costing";
import { deleteOrganizationForUser } from "../lib/actions/org";
import { db } from "../lib/db";
import {
  accountingPeriods,
  arApDocuments,
  auditEvents,
  cashAccounts,
  cashFxRevaluations,
  exchangeRates,
  costEntries,
  faDepreciationEntries,
  fixedAssets,
  inventoryItems,
  inventoryMovements,
  journalLines,
  journalVouchers,
  memberships,
  organizations,
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
    // Бодит устгалтын замаар (owner + нэр): цалин, POS, PO, АР/АП төлбөр,
    // касс, өртөг бүгдтэй байгууллага RESTRICT FK-д гацахгүй устах ёстой.
    // Тест дундаа нэрийг сольдог (компанийн мэдээлэл) тул одоогийн нэрээр.
    const current = await db.query.organizations.findFirst({
      where: eq(organizations.id, org.id),
      columns: { name: true },
    });
    assert.ok(current, "байгууллага цэвэрлэгээнээс өмнө байх ёстой");
    await deleteOrganizationForUser({
      orgId: org.id,
      userId: user.id,
      confirmName: current.name,
    });
    const left = await db.query.organizations.findFirst({
      where: eq(organizations.id, org.id),
      columns: { id: true },
    });
    assert.equal(left, undefined, "байгууллага устсан байх ёстой");
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

  // Хасалтын журнал 12.5 сая ₮ (өртөг + олз) > 10 саяын анхдагч хязгаар —
  // вэбээс хүн хязгаарыг өсгөснийг дуурайна (tool-оор өсгөх боломжгүй, §9).
  const setLimit = (value: string | null) =>
    db.execute(sql`insert into company_settings (user_id, organization_id, ai_post_limit_mnt)
      values (${userId}, ${orgId}, ${value}) on conflict (organization_id)
      do update set ai_post_limit_mnt = excluded.ai_post_limit_mnt`);
  const overLimit = await tool(
    "dispose_fixed_asset",
    {
      assetCode: asset.code, disposalType: "sale", date: "2025-10-15", proceeds: 500_000,
      proceedsAccount: "11000001", gainLossAccount: "87000004",
    },
    "post"
  );
  assert.match(overLimit.resultText, /12,500,000₮ нь 10,000,000₮-ийн хязгаараас их/);
  await setLimit("50000000");
  const disposed = await tool(
    "dispose_fixed_asset",
    {
      assetCode: asset.code, disposalType: "sale", date: "2025-10-15", proceeds: 500_000,
      proceedsAccount: "11000001", gainLossAccount: "87000004",
    },
    "post"
  );
  await setLimit(null);
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

test("ENT-031/036/033/010: чиглэл, унасан батлалт ноорог үлдээхгүй, дугаараар хайх, мессеж", { skip: !DB_READY }, async () => {
  await setupOrg();
  // ENT-031: «Авлага» төрөлтэй харилцагч дээр АП нэхэмжлэх үүсэхгүй
  const wrong = await tool("create_arap_invoice", {
    documentType: "ap_bill", counterparty: "Скай Трэйдинг", date: "2025-05-05", description: "Буруу чиглэл",
    externalRef: `sim-${STAMP}-dir`, lines: [{ account: "73100001", amount: 10_000, description: "x" }],
  });
  assert.match(wrong.resultText, /COUNTERPARTY_DIRECTION/);

  // ENT-036: батлагдах боломжгүй зарлага ноорог үлдээхгүй
  const before = await db.query.inventoryMovements.findMany({ where: eq(inventoryMovements.organizationId, orgId) });
  const issue = await tool(
    "create_inventory_movement",
    { movementType: "issue", date: "2025-05-06", itemCode: "ITM-B", warehouseCode: "WH1", quantity: 99_999 },
    "post"
  );
  assert.ok(issue.resultText.startsWith("Алдаа"), issue.resultText);
  const after = await db.query.inventoryMovements.findMany({ where: eq(inventoryMovements.organizationId, orgId) });
  assert.equal(after.length, before.length, "унасан батлалт ноорог үлдээх ёсгүй");

  // ENT-033: ДУГААРААР олно (ID угтвар биш), ENT-010: мессеж төлөвөөр
  const receipt = await tool("create_inventory_movement", {
    movementType: "receipt", date: "2025-05-06", itemCode: "ITM-B", warehouseCode: "WH1", quantity: 3,
  });
  assert.ok(okOrRevalidate(receipt.resultText), receipt.resultText);
  const draft = (await db.query.inventoryMovements.findMany({
    where: and(eq(inventoryMovements.organizationId, orgId), eq(inventoryMovements.status, "draft")),
  })).find((row) => row.date === "2025-05-06");
  assert.ok(draft);
  const confirmed = await tool("confirm_inventory_movement", { movementId: draft.documentNo }, "post");
  assert.ok(okOrRevalidate(confirmed.resultText), confirmed.resultText);
  const deleted = await tool("delete_inventory_movement", { movementId: draft.documentNo }, "post");
  assert.match(deleted.resultText, /^Баталгаажсан хөдөлгөөн устгагдлаа/);
});

test("ENT-068: AI шууд батлах хязгаараа 1 тэрбум ₮-өөс дээш өсгөж чадахгүй, бууруулж болно", { skip: !DB_READY }, async () => {
  await setupOrg();
  const named = await tool("update_company_settings", { name: "SIM Trade ХХК" });
  assert.ok(okOrRevalidate(named.resultText), named.resultText);
  // #113: tool-оор AI_POST_LIMIT_TOOL_MAX_MNT (1 тэрбум) хүртэл өсгөж болно
  const raise = await tool("update_company_settings", { aiPostLimitMnt: 50_000_000 });
  assert.ok(okOrRevalidate(raise.resultText), raise.resultText);
  const overCap = await tool("update_company_settings", { aiPostLimitMnt: 2_000_000_000 });
  assert.match(overCap.resultText, /HUMAN_REQUIRED/);
  const lower = await tool("update_company_settings", { aiPostLimitMnt: 5_000_000 });
  assert.ok(okOrRevalidate(lower.resultText), lower.resultText);
  // Дараагийн тестүүд анхдагч 10 сая ₮-ийн хязгаар дээр ажиллана
  const back = await tool("update_company_settings", { aiPostLimitMnt: 10_000_000 });
  assert.ok(okOrRevalidate(back.resultText), back.resultText);
});

test("ENT-013/014/045/030/057: валютын журнал, кассын үлдэгдэл, хөдөлгөөний шүүлт, мөрийн алдаа, линк", { skip: !DB_READY }, async () => {
  await setupOrg();
  // ENT-013: USD журнал — мөрийн дүн валютаар, ₮ ханшаар
  const fx = await tool(
    "create_journal_voucher",
    {
      date: "2025-02-10", description: "USD зардал", currency: "USD", exchangeRate: 3450,
      externalRef: `sim-${STAMP}-fxj`,
      lines: [
        { account: "73100001", debit: 100, description: "Зардал" },
        { account: "11000002", credit: 100, description: "Банк USD" },
      ],
    },
    "post"
  );
  assert.ok(okOrRevalidate(fx.resultText), fx.resultText);
  const voucher = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.externalRef, `sim-${STAMP}-fxj`)),
    with: { lines: true },
  });
  assert.equal(voucher?.currency, "USD");
  assert.equal(voucher?.status, "posted");
  const expense = voucher!.lines.find((line) => line.accountNumber.includes("73100001"));
  assert.equal(Number(expense?.debit), 345_000);
  assert.equal(Number(expense?.debitFc), 100);

  // ENT-014: үлдэгдэл харагдана
  const listed = await tool("list_cash_accounts", {});
  assert.match(listed.resultText, /Хаан банк USD — .*үлдэгдэл .* USD .*нээлт 1,000 USD \(2024-12-31\) · GL 11000002/);

  // ENT-045: огноо + төрөл + бараагаар шүүнэ
  const filtered = await tool("list_inventory_movements", {
    from: "2025-03-01", to: "2025-03-31", itemCode: "ITM-A", movementType: "receipt",
  });
  assert.ok(!filtered.resultText.startsWith("Алдаа"), filtered.resultText);
  for (const line of filtered.resultText.split("\n")) assert.match(line, /^2025-03-\d\d · .* · орлого · ITM-A/);

  // ENT-030: 0 / сөрөг мөр индекстэй алдаа
  const bad = await tool("create_arap_invoice", {
    documentType: "ar_invoice", counterparty: "Скай Трэйдинг", date: "2025-05-05", description: "Сөрөг",
    lines: [
      { account: "51100000", amount: 100_000, description: "Зөв" },
      { account: "51100000", amount: -118_000, description: "Хасалт" },
    ],
  });
  assert.match(bad.resultText, /INVALID_LINE\] Мөр #2 \(«Хасалт»\)/);

  // ENT-057: төлөгдсөн нэхэмжлэлд ч линк үүснэ (undefined биш)
  const ar = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `sim-${STAMP}-ar1`)),
  });
  await db.update(arApDocuments).set({ status: "paid" }).where(eq(arApDocuments.id, ar!.id));
  const link = await tool("create_invoice_link", { documentId: ar!.documentNo });
  assert.doesNotMatch(link.resultText, /undefined/);
  assert.match(link.resultText, /\/invoice\//);
  await db.update(arApDocuments).set({ status: ar!.status }).where(eq(arApDocuments.id, ar!.id));
});

test("Аудит hotfix: хуучин касс, хаагдсан үеийн өртөг, АР/АП валют, ирээдүйн шууд батлалт", { skip: !DB_READY }, async () => {
  await setupOrg();
  const as = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);

  // (1) opening_date нэмэгдэхээс ӨМНӨХ огноогүй данс — нэр засахад гацахгүй
  const [legacy] = await db
    .insert(cashAccounts)
    .values({
      userId, organizationId: orgId, name: "Хуучин касс", accountType: "cash",
      currency: "MNT", glAccountNumber: "11210000", openingBalance: "5000000",
    })
    .returning();
  const renamed = await as(() =>
    updateCashAccount({
      id: legacy.id, name: "Хуучин касс (засав)", accountType: "cash",
      currency: "MNT", glAccountNumber: "11210000", openingBalance: 5_000_000,
    })
  );
  assert.equal(renamed.error, undefined, renamed.error);
  // Үлдэгдлийг СОЛИХОД огноо нэхсээр
  const rebalanced = await as(() =>
    updateCashAccount({
      id: legacy.id, name: "Хуучин касс (засав)", accountType: "cash",
      currency: "MNT", glAccountNumber: "11210000", openingBalance: 6_000_000,
    })
  );
  assert.match(rebalanced.error ?? "", /НЭЭЛТИЙН ОГНОО/);

  // (3) Хаагдсан үеийн (2025-07) ба asOfDate-ээс хойшхи (2025-09) АП орлого
  //     run-аар капиталжихгүй — засварын өмнөх (капитализацигүй) орлогыг дуурайна.
  const receiptOn = async (date: string, ref: string) => {
    const bill = await tool(
      "create_arap_invoice",
      {
        documentType: "ap_bill", counterparty: "Нийлүүлэгч А", date, currency: "MNT",
        description: "Хуучин орлого", externalRef: `sim-${STAMP}-${ref}`,
        lines: [{ itemCode: "ITM-A", warehouseCode: "WH1", quantity: 2, unitPrice: 30000, description: "Цэнэглэгч" }],
      },
      "post"
    );
    assert.ok(okOrRevalidate(bill.resultText), bill.resultText);
    const movement = (
      await db.query.inventoryMovements.findMany({
        where: and(
          eq(inventoryMovements.organizationId, orgId),
          eq(inventoryMovements.sourceType, "arap_line"),
          eq(inventoryMovements.date, date)
        ),
      })
    )[0];
    assert.ok(movement, `${date} орлого`);
    const confirm = await tool("confirm_inventory_movement", { movementId: movement.id }, "post");
    assert.ok(okOrRevalidate(confirm.resultText), confirm.resultText);
    await db.delete(costEntries).where(eq(costEntries.movementId, movement.id));
    return movement.id;
  };
  const julyMovement = await receiptOn("2025-07-15", "jul");
  const septMovement = await receiptOn("2025-09-10", "sep");
  const [closedJuly] = await db
    .insert(accountingPeriods)
    .values({ userId, organizationId: orgId, code: "2025-07", startDate: "2025-07-01", endDate: "2025-07-31", status: "closed" })
    .returning({ id: accountingPeriods.id });
  try {
    const run = await as(() => runCosting({ asOfDate: "2025-08-31" }));
    assert.equal(run.error, undefined, run.error);
    const entriesFor = (movementId: string) =>
      db.query.costEntries.findMany({ where: eq(costEntries.movementId, movementId) });
    assert.equal((await entriesFor(julyMovement)).length, 0, "хаагдсан үе рүү бичихгүй");
    assert.equal((await entriesFor(septMovement)).length, 0, "asOfDate-ээс хойш үнэлэхгүй");
    const later = await as(() => runCosting({ asOfDate: "2025-09-30" }));
    assert.equal(later.error, undefined, later.error);
    assert.equal((await entriesFor(septMovement)).length, 1, "нээлттэй үед нөхөж капиталжина");
    assert.equal((await entriesFor(julyMovement)).length, 0);
  } finally {
    await db.delete(accountingPeriods).where(eq(accountingPeriods.id, closedJuly.id));
  }

  // (4) PO-гүй нэхэмжлэх валютаа харилцагчийн анхдагчаас авна
  assert.ok(okOrRevalidate((await tool("create_counterparty", { name: "USD Нийлүүлэгч", counterpartyType: "supplier", currency: "USD" })).resultText));
  const usdBill = await tool("create_arap_invoice", {
    documentType: "ap_bill", counterparty: "USD Нийлүүлэгч", date: "2025-05-10", exchangeRate: 3450,
    description: "Үйлчилгээ", externalRef: `sim-${STAMP}-usd-default`,
    lines: [{ account: "73100001", description: "Зөвлөх", amount: 1_000 }],
  });
  assert.ok(okOrRevalidate(usdBill.resultText), usdBill.resultText);
  const usdDoc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `sim-${STAMP}-usd-default`)),
  });
  assert.equal(usdDoc?.currency, "USD");
  assert.equal(Number(usdDoc?.exchangeRate), 3450);

  // (5) postNow нь ирээдүйн сарын хоригийг тойрохгүй
  const cp = await db.query.counterparties.findFirst({
    where: (row, { and: both, eq: equals }) => both(equals(row.organizationId, orgId), equals(row.name, "НӨАТ Харилцагч")),
  });
  assert.ok(cp);
  const future = await as(() =>
    createArApDocument({
      documentType: "ar_invoice", counterpartyId: cp.id, date: "2099-06-01", dueDate: "2099-07-01",
      controlAccountNumber: "13110000", description: "Ирээдүйн шууд батлалт",
      externalRef: `sim-${STAMP}-future-arap`, postNow: true,
      lines: [{ account: "51100000", description: "Үйлчилгээ", amount: 10_000 }],
    })
  );
  assert.match(future.error ?? "", /ирээдүйн тайлант үе/, "ирээдүйн сарын баримт шууд батлагдах ёсгүй");
  const futureDoc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `sim-${STAMP}-future-arap`)),
  });
  assert.equal(futureDoc, undefined);
});

test("Аудит hotfix 2: dispose_fixed_asset батлах хязгаар, AI-ийн менежерийн зөвшөөрөл аудитад", { skip: !DB_READY }, async () => {
  await setupOrg();

  // dispose_fixed_asset — анхны өртөг 10 сая ₮-ийн анхдагч хязгаараас их
  const big = await tool(
    "create_fixed_asset",
    {
      name: "Агуулахын барилга (туршилт)", acquisitionDate: "2020-01-10", cost: 15_000_000, usefulLifeMonths: 240,
      custodian: "Б.Бат", depreciationStartMonth: "2020-02", openingAccumulatedDepreciation: 3_000_000, openingAsOf: "2024-12-31",
    },
    "post"
  );
  assert.ok(okOrRevalidate(big.resultText), big.resultText);
  const bigAsset = await db.query.fixedAssets.findFirst({
    where: and(eq(fixedAssets.organizationId, orgId), eq(fixedAssets.name, "Агуулахын барилга (туршилт)")),
  });
  assert.ok(bigAsset);
  const blocked = await tool(
    "dispose_fixed_asset",
    { assetCode: bigAsset.code, disposalType: "scrap", date: "2025-10-20", gainLossAccount: "87000004" },
    "post"
  );
  assert.match(blocked.resultText, /хязгаараас их/);
  const still = await db.query.fixedAssets.findFirst({ where: eq(fixedAssets.id, bigAsset.id) });
  assert.equal(still?.disposalVoucherId ?? null, null, "хязгаараас их хасалт GL-д бичигдэх ёсгүй");

  // create_pos_sale — 15% гар хөнгөлөлт (зөвшөөрөл шаардана) managerApproval-аар
  const cashAccount = await tool("create_cash_account", {
    name: "Дэлгүүрийн касс", accountType: "cash", currency: "MNT", glAccount: "10000001",
  });
  assert.ok(okOrRevalidate(cashAccount.resultText), cashAccount.resultText);
  const priced = await tool("update_inventory_item", { itemCode: "ITM-A", salesPrice: 50_000 });
  assert.ok(okOrRevalidate(priced.resultText), priced.resultText);
  const shift = await tool("open_pos_shift", { cashAccount: "Дэлгүүрийн касс", warehouseCode: "WH1" }, "post");
  assert.ok(okOrRevalidate(shift.resultText), shift.resultText);
  const saleInput = {
    lines: [{ itemCode: "ITM-A", quantity: 1, discountPercent: 15 }],
    payments: [{ method: "CASH", amount: 42_500 }],
  };
  const refused = await tool("create_pos_sale", saleInput, "post");
  assert.match(refused.resultText, /APPROVAL_REQUIRED/);
  const sold = await tool("create_pos_sale", { ...saleInput, managerApproval: true }, "post");
  assert.ok(okOrRevalidate(sold.resultText), sold.resultText);
  const events = await db.query.auditEvents.findMany({
    where: and(eq(auditEvents.organizationId, orgId), eq(auditEvents.entityType, "pos_sale")),
  });
  const approval = events.find((event) => event.action === "manager_approval");
  assert.ok(approval, "AI-ийн managerApproval аудитад ТУСДАА бичигдэнэ");
  assert.match(approval.summary, /AI\/MCP-ийн managerApproval/);
  const created = events.find((event) => event.action === "create_posted");
  assert.match(created?.summary ?? "", /менежерийн зөвшөөрөл/);
});

test("Аудит M1: буцаасан нээлтийн журналын дараа fix_cash_opening_balance дахин ажиллана", { skip: !DB_READY }, async () => {
  await setupOrg();
  const account = await db.query.cashAccounts.findFirst({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.name, "Голомт банк USD")),
  });
  assert.ok(account, "ENT-011 тестийн данс");
  const first = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.externalRef, `cash-opening:${account.id}`)),
  });
  assert.ok(first);
  // 41 сая ₮-ийн журнал — вэбээс хүн хязгаарыг өсгөснийг дуурайна (§9), дараа нь сэргээнэ.
  const settingsRow = await db.execute(
    sql`select ai_post_limit_mnt as "limit" from company_settings where organization_id = ${orgId}`
  );
  const previousLimit = (settingsRow as unknown as { limit: string | null }[])[0]?.limit ?? null;
  const setLimit = (value: string | null) =>
    db.execute(sql`insert into company_settings (user_id, organization_id, ai_post_limit_mnt)
      values (${userId}, ${orgId}, ${value}) on conflict (organization_id)
      do update set ai_post_limit_mnt = excluded.ai_post_limit_mnt`);
  await setLimit("100000000");
  try {
    if (first.status === "draft") {
      const posted = await tool("post_journal_voucher", { voucherId: first.id }, "post");
      assert.ok(okOrRevalidate(posted.resultText), posted.resultText);
    }
    const blocked = await tool("fix_cash_opening_balance", { cashAccount: "Голомт банк USD" });
    assert.match(blocked.resultText, /аль хэдийн батлагдсан/);
    const reversed = await tool("reverse_journal_voucher", { voucherId: first.id }, "post");
    assert.ok(okOrRevalidate(reversed.resultText), reversed.resultText);
  } finally {
    await setLimit(previousLimit);
  }
  const again = await tool("fix_cash_opening_balance", { cashAccount: "Голомт банк USD" });
  assert.ok(okOrRevalidate(again.resultText), again.resultText);
  const redo = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.externalRef, `cash-opening:${account.id}:2`)),
  });
  assert.ok(redo, "дахин үүссэн нээлт шинэ ref-тэй");
  assert.equal(redo.date, "2024-12-31");
});

test("Аудит тест дутуу: ENT-062/032/039/026", { skip: !DB_READY }, async () => {
  await setupOrg();
  const as = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);

  // ENT-062 — зарлагын дараа данс хасах үлдэгдэлтэй болбол ИЛ анхааруулна
  const pay = await tool(
    "create_cash_transaction",
    {
      documentType: "payment", date: "2026-09-02", cashAccount: "Дэлгүүрийн касс", counterAccount: "73100001",
      amount: 1_000_000, description: "Түрээс (хасах үлдэгдэл шалгах)", externalRef: `sim-${STAMP}-neg-cash`,
    },
    "post"
  );
  assert.ok(okOrRevalidate(pay.resultText), pay.resultText);
  assert.match(pay.resultText, /ХАСАХ үлдэгдэлтэй болов/);

  // ENT-032 — батлагдсан нэхэмжлэх устгахад «Ноорог» гэж худал хэлэхгүй
  const inv = await tool(
    "create_arap_invoice",
    {
      documentType: "ar_invoice", counterparty: "Скай Трэйдинг", date: "2025-06-10", description: "Устгах туршилт",
      externalRef: `sim-${STAMP}-del-ar`, lines: [{ account: "51100000", description: "Үйлчилгээ", amount: 10_000 }],
    },
    "post"
  );
  assert.ok(okOrRevalidate(inv.resultText), inv.resultText);
  const doc = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `sim-${STAMP}-del-ar`)),
  });
  assert.equal(doc?.status, "posted");
  const deleted = await tool("delete_arap_document", { documentId: doc!.id }, "post");
  assert.match(deleted.resultText, /Батлагдсан нэхэмжлэх GL-тэй нь хамт устгагдлаа/);

  // ENT-039 — бараатай мөр агуулахгүй бол сервер ТАТГАЛЗАНА (trust boundary)
  const item = await db.query.inventoryItems.findFirst({
    where: and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.code, "ITM-A")),
  });
  const customer = await db.query.counterparties.findFirst({
    where: (row, { and: both, eq: equals }) => both(equals(row.organizationId, orgId), equals(row.name, "Скай Трэйдинг")),
  });
  const noWarehouse = await as(() =>
    createArApDocument({
      documentType: "ar_invoice", counterpartyId: customer!.id, date: "2025-06-11", dueDate: "2025-07-11",
      controlAccountNumber: "13110000", description: "Агуулахгүй бараа",
      lines: [{ account: "51100000", description: "Цэнэглэгч", amount: 50_000, itemId: item!.id, quantity: 1 }],
    })
  );
  assert.match(noWarehouse.error ?? "", /агуулах заавал/);

  // ENT-026 — цалингийн журналын ДУГААР хариунд
  assert.ok(okOrRevalidate((await tool("create_employee", { name: "Болд", lastName: "Дорж", baseSalary: 2_000_000 })).resultText));
  const run = await tool("run_payroll", { period: "2025-06" });
  assert.ok(okOrRevalidate(run.resultText), run.resultText);
  const voucher = await tool("create_payroll_voucher", { period: "2025-06" });
  assert.ok(okOrRevalidate(voucher.resultText), voucher.resultText);
  assert.match(voucher.resultText, /PAY-25-\d{6}/);
});

test("цэвэрлэгээ", { skip: !DB_READY }, async () => {
  for (const fn of cleanup.reverse()) await fn();
});

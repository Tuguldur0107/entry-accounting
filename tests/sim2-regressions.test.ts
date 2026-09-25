// Сим 2.0-ийн олдворуудын (entry_sim2_tracker.xlsx, SIM2-xxx) DB integration
// регресс тест. DATABASE_URL шаарддаг: түр байгууллага, төгсгөлд purgeOrganization.

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
import { syncStandardAccounts, updateVoucher } from "../lib/actions/gl";
import { backfillCashDraftsForUser } from "../lib/cash/sync-voucher";
import { getPayrollRunData } from "../lib/actions/payroll";
import { db } from "../lib/db";
import {
  accountingPeriods,
  arApDocuments,
  cashAccounts,
  cashDocuments,
  chartOfAccounts,
  costEntries,
  employees,
  goodsReceipts,
  journalLines,
  journalVouchers,
  memberships,
  organizations,
  purchaseOrders,
  users,
  warehouses,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

export function asOrg<T>(fn: () => Promise<T>) {
  return runAsOrg({ userId, orgId }, fn);
}
export function tool(name: string, input: unknown, mode: "draft" | "post" = "draft") {
  return asOrg(() => executeAiTool(userId, name, input, mode));
}
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result;
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `sim2-${STAMP}`, email: `sim2-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `SIM2 регресс ${STAMP}` })
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
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

test("SIM2-019/020: сарын дунд орсон/гарсан ажилтны цалин хувь тэнцүүлэгдэнэ, гарсны дараа бодогдохгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("create_employee", { name: "Шинэ-Инженер", position: "Инженер", baseSalary: 3_000_000, hireDate: "2025-08-18" }));
  ok(await tool("create_employee", { name: "Багш06", position: "Багш", baseSalary: 1_800_000, hireDate: "2024-01-01" }));
  ok(await tool("create_employee", { name: "Бүтэн", position: "Нягтлан", baseSalary: 2_000_000, hireDate: "2024-01-01" }));

  // 2025-07: Шинэ-Инженер хараахан ороогүй
  ok(await tool("run_payroll", { period: "2025-07" }));
  const jul = await asOrg(() => getPayrollRunData("2025-07"));
  assert.deepEqual(jul.lines.map((l) => l.employeeName).sort(), ["Багш06", "Бүтэн"]);

  // 2025-08: 3,000,000 × 10/21 = 1,428,571 (цалингийн тооцоо бүхэл төгрөгөөр)
  const augText = ok(await tool("run_payroll", { period: "2025-08" })).resultText;
  assert.match(augText, /Шинэ-Инженер \[хэсэгчилсэн сар 10\/21/);
  const aug = await asOrg(() => getPayrollRunData("2025-08"));
  const eng = aug.lines.find((l) => l.employeeName === "Шинэ-Инженер")!;
  assert.equal(eng.earnings, 1_428_571);
  assert.equal(aug.lines.find((l) => l.employeeName === "Бүтэн")!.earnings, 2_000_000);

  // Багш06 2025-09-15-нд гарав → идэвхгүй, 9-р сар 11/22, 10-р сард бодогдохгүй
  ok(await tool("update_employee", { employee: "Багш06", terminationDate: "2025-09-15" }));
  const teacher = await db.query.employees.findFirst({
    where: and(eq(employees.organizationId, orgId), eq(employees.name, "Багш06")),
  });
  assert.equal(teacher?.isActive, false, "гарсан огноо өнгөрсөн тул идэвхгүй");
  ok(await tool("run_payroll", { period: "2025-09" }));
  const sep = await asOrg(() => getPayrollRunData("2025-09"));
  assert.equal(sep.lines.find((l) => l.employeeName === "Багш06")!.earnings, 900_000);
  ok(await tool("run_payroll", { period: "2025-10" }));
  const oct = await asOrg(() => getPayrollRunData("2025-10"));
  assert.equal(oct.lines.some((l) => l.employeeName === "Багш06"), false);
  assert.match((await tool("list_employees", { includeInactive: true })).resultText, /Багш06.*ГАРСАН 2025-09-15/);
});

async function setupProcurement() {
  await setupOrg();
  if (await db.query.warehouses.findFirst({ where: and(eq(warehouses.organizationId, orgId), eq(warehouses.code, "WH1")) }))
    return;
  ok(await tool("create_warehouse", { code: "WH1", name: "Төв агуулах" }));
  ok(await tool("create_inventory_item", { code: "ITM-A", name: "Импортын бараа", unit: "ш" }));
  ok(await tool("create_counterparty", { name: "Нийлүүлэгч MNT", counterpartyType: "supplier" }));
  ok(await tool("create_counterparty", { name: "Нийлүүлэгч USD", counterpartyType: "supplier", currency: "USD" }));
  ok(await tool("create_counterparty", { name: "Гаалийн газар", counterpartyType: "supplier" }));
  ok(await tool("save_cost_component", { code: "CUSTOMS", name: "Гаалийн татвар" }));
}

test("SIM2-023: хэсэгчлэн хүлээн авсан PO — анхдагч хориг, «warn» горимд сар хаагдана", { skip: !DB_READY }, async () => {
  await setupProcurement();
  // PO-2501-001: 40+30 захиалснаас 25 ирсэн
  ok(await tool("create_purchase_order", {
    supplier: "Нийлүүлэгч MNT", date: "2025-01-05", description: "Импорт", documentNo: `PO-2501-${STAMP}`, warehouseCode: "WH1",
    lines: [{ itemCode: "ITM-A", quantity: 40, unitPrice: 10_000 }, { itemCode: "ITM-A", quantity: 30, unitPrice: 10_000 }],
  }));
  ok(await tool("approve_purchase_order", { purchaseOrderId: `PO-2501-${STAMP}` }, "post"));
  const po = await db.query.purchaseOrders.findFirst({
    where: and(eq(purchaseOrders.organizationId, orgId), eq(purchaseOrders.documentNo, `PO-2501-${STAMP}`)),
    with: { lines: true },
  });
  const firstLine = po!.lines.find((line) => Number(line.quantity) === 40)!;
  ok(await tool(
    "create_goods_receipt",
    { purchaseOrderId: `PO-2501-${STAMP}`, date: "2025-01-20", lines: [{ purchaseOrderLineId: firstLine.id, quantity: 25 }] },
    "post"
  ));

  const blocked = await tool("close_period", { code: "2025-01" }, "post");
  assert.match(blocked.resultText, /НЭЭЛТТЭЙ захиалга/, "анхдагч OD-011 хориг хэвээр");

  ok(await tool("update_costing_accounts", { openPoCloseMode: "warn" }));
  ok(await tool("close_period", { code: "2025-01" }, "post"));
  const period = await db.query.accountingPeriods.findFirst({
    where: and(eq(accountingPeriods.organizationId, orgId), eq(accountingPeriods.code, "2025-01")),
  });
  assert.equal(period?.status, "closed");
  // GRNI (бараа материалын түр данс) 25 × 10,000 балансад үлдэнэ
  const tb = ok(await tool("get_trial_balance", { from: "2025-01-01", to: "2025-01-31" })).resultText;
  assert.match(tb, /250,000/);

  ok(await tool("reopen_period", { code: "2025-01" }, "post"));
  ok(await tool("update_costing_accounts", { openPoCloseMode: "block" }));
});

test("SIM2-025/026: валютын PO ханшгүй цуцлагдана, ноорог GR устгагдана (мухардалгүй)", { skip: !DB_READY }, async () => {
  await setupProcurement();
  // PO-2502-001 (USD 385) → GR ноорог
  ok(await tool("create_purchase_order", {
    supplier: "Нийлүүлэгч USD", date: "2025-02-05", description: "Импорт", currency: "USD", exchangeRate: 3440,
    documentNo: `PO-2502-${STAMP}`, warehouseCode: "WH1", lines: [{ itemCode: "ITM-A", quantity: 11, unitPrice: 35 }],
  }));
  ok(await tool("approve_purchase_order", { purchaseOrderId: `PO-2502-${STAMP}`, exchangeRate: 3440 }, "post"));
  ok(await tool("create_goods_receipt", { purchaseOrderId: `PO-2502-${STAMP}`, date: "2025-02-10", exchangeRate: 3450, documentNo: `GR-2502-${STAMP}` }));

  // Ноорог GR-ийг буцаах гэвэл устгах замыг заана
  assert.match((await tool("reverse_goods_receipt", { receiptId: `GR-2502-${STAMP}` }, "post")).resultText, /delete_goods_receipt/);

  // SIM2-025 + 026: ханшгүйгээр цуцлагдаж, ноорог GR хамт устгагдана
  const cancelled = ok(await tool("cancel_purchase_order", { purchaseOrderId: `PO-2502-${STAMP}` }, "post"));
  assert.match(cancelled.resultText, /GR-2502/);
  const po = await db.query.purchaseOrders.findFirst({
    where: and(eq(purchaseOrders.organizationId, orgId), eq(purchaseOrders.documentNo, `PO-2502-${STAMP}`)),
  });
  assert.equal(po?.status, "cancelled");
  assert.equal(
    (await db.query.goodsReceipts.findMany({ where: eq(goodsReceipts.purchaseOrderId, po!.id) })).length,
    0
  );

  // delete_goods_receipt: ноорог GR шууд устана
  ok(await tool("create_purchase_order", {
    supplier: "Нийлүүлэгч MNT", date: "2025-02-06", description: "Импорт", documentNo: `PO-2502B-${STAMP}`, warehouseCode: "WH1",
    lines: [{ itemCode: "ITM-A", quantity: 5, unitPrice: 10_000 }],
  }));
  ok(await tool("approve_purchase_order", { purchaseOrderId: `PO-2502B-${STAMP}` }, "post"));
  ok(await tool("create_goods_receipt", { purchaseOrderId: `PO-2502B-${STAMP}`, date: "2025-02-11", documentNo: `GR-2502B-${STAMP}` }));
  ok(await tool("delete_goods_receipt", { receiptId: `GR-2502B-${STAMP}` }));
  assert.equal(
    await db.query.goodsReceipts.findFirst({
      where: and(eq(goodsReceipts.organizationId, orgId), eq(goodsReceipts.documentNo, `GR-2502B-${STAMP}`)),
    }),
    undefined
  );
  ok(await tool("cancel_purchase_order", { purchaseOrderId: `PO-2502B-${STAMP}` }, "post"));
});

test("SIM2-024: зарлагын COGS батлагдсаны ДАРАА хуваарилсан нэмэлт зардал → cogs_true_up залруулга", { skip: !DB_READY }, async () => {
  await setupProcurement();
  // Тусдаа бараа — бусад тестийн орлого сарын дунджид орохгүй
  ok(await tool("create_inventory_item", { code: "ITM-C", name: "Landed бараа", unit: "ш" }));
  ok(await tool("create_purchase_order", {
    supplier: "Нийлүүлэгч MNT", date: "2025-03-02", description: "Импорт", documentNo: `PO-2503-${STAMP}`, warehouseCode: "WH1",
    lines: [{ itemCode: "ITM-C", quantity: 10, unitPrice: 100_000 }],
  }));
  ok(await tool("approve_purchase_order", { purchaseOrderId: `PO-2503-${STAMP}` }, "post"));
  ok(await tool("create_goods_receipt", { purchaseOrderId: `PO-2503-${STAMP}`, date: "2025-03-05" }, "post"));
  ok(await tool("create_inventory_movement",
    { movementType: "issue", date: "2025-03-10", itemCode: "ITM-C", warehouseCode: "WH1", quantity: 4 }, "post"));

  // 1) Сарын дундуур өртөг тооцоод COGS батлав: 4 × 100,000
  ok(await tool("run_monthly_costing", { period: "2025-03" }));
  ok(await tool("post_cost_entries", { month: "2025-03" }, "post"));

  // 2) Дараа нь гааль 50,000 → хуваарилав, батлав
  ok(await tool("create_arap_invoice", {
    documentType: "ap_bill", counterparty: "Гаалийн газар", date: "2025-03-25", purchaseOrder: `PO-2503-${STAMP}`,
    description: "Гааль", externalRef: `sim2-${STAMP}-customs`,
    lines: [{ amount: 50_000, costComponentCode: "CUSTOMS", description: "Гааль" }],
  }, "post"));
  const bill = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.externalRef, `sim2-${STAMP}-customs`)),
    with: { lines: true },
  });
  ok(await tool("create_cost_allocation", { allocationBase: "value", sourceLine: bill!.lines[0].id }));
  ok(await tool("post_cost_entries", { month: "2025-03" }, "post"));

  // 3) Дахин тооцоход: дундаж 105,000 → COGS 420,000, залруулга +20,000
  const rerun = ok(await tool("run_monthly_costing", { period: "2025-03" })).resultText;
  assert.match(rerun, /COGS залруулга/);
  const trueUps = await db.query.costEntries.findMany({
    where: and(eq(costEntries.organizationId, orgId), eq(costEntries.entryType, "cogs_true_up"), eq(costEntries.periodCode, "2025-03")),
  });
  assert.equal(trueUps.length, 1);
  assert.equal(Number(trueUps[0].amount), 20_000);
  assert.equal(trueUps[0].status, "draft");

  // Идемпотент: дахин ажиллуулахад давхардахгүй; батласны дараа залруулга алга
  ok(await tool("run_monthly_costing", { period: "2025-03" }));
  ok(await tool("post_cost_entries", { month: "2025-03" }, "post"));
  const again = ok(await tool("run_monthly_costing", { period: "2025-03" })).resultText;
  assert.doesNotMatch(again, /COGS залруулга/);
  const all = await db.query.costEntries.findMany({
    where: and(eq(costEntries.organizationId, orgId), eq(costEntries.entryType, "cogs_true_up")),
  });
  assert.equal(all.length, 1);
});

// ── Бүлэг 2: нэвтрүүлэлт / касс ─────────────────────────────────────────────

/** Вэбийн журнал засварын форм шиг — мөрүүдийг дахин илгээж батална. */
async function postOpeningViaWebForm(voucherId: string) {
  const voucher = await db.query.journalVouchers.findFirst({
    where: eq(journalVouchers.id, voucherId),
    with: { lines: true },
  });
  const result = await asOrg(() =>
    updateVoucher(voucherId, {
      date: voucher!.date,
      description: voucher!.description,
      currency: voucher!.currency,
      exchangeRate: Number(voucher!.exchangeRate),
      rateSource: voucher!.rateSource,
      rateDate: voucher!.rateDate,
      status: "posted",
      lines: voucher!.lines
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((line) => ({
          account: line.accountNumber,
          debit: Number(line.debit),
          credit: Number(line.credit),
          debitFc: Number(line.debitFc),
          creditFc: Number(line.creditFc),
          description: line.description ?? "",
        })),
    })
  );
  assert.ok(!result.error, result.error);
}

async function openingVoucherOf(accountName: string) {
  const account = await db.query.cashAccounts.findFirst({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.name, accountName)),
  });
  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.organizationId, orgId),
      eq(journalVouchers.externalRef, `cash-opening:${account!.id}`)
    ),
  });
  return { account: account!, voucher: voucher! };
}

test("SIM2-011/008/013/005: нээлтийн журнал вэбээс батлахад толин баримт үүсэхгүй, нэг GL-ийн олон касс зөв тулгагдана", { skip: !DB_READY }, async () => {
  await setupOrg();
  // C: Касс MNT 4.2M, Касс дэлгүүр №1 0.8M, №2 0.65M — гурвуулаа 10000001
  for (const [name, opening] of [["Касс MNT", 4_200_000], ["Касс дэлгүүр №1", 800_000], ["Касс дэлгүүр №2", 650_000]] as const) {
    ok(await tool("create_cash_account", {
      name, accountType: "cash", glAccount: "10000001", openingBalance: opening, openingDate: "2024-12-31",
    }));
    ok(await tool("fix_cash_opening_balance", { cashAccount: name, date: "2024-12-31" }));
    await postOpeningViaWebForm((await openingVoucherOf(name)).voucher.id);
  }

  // SIM2-008/011: журнал засварт кассын тэмдэг хадгалагдаж, толин баримт үүсээгүй
  const { account: shop2, voucher: shop2Opening } = await openingVoucherOf("Касс дэлгүүр №2");
  const lines = await db.query.journalLines.findMany({ where: eq(journalLines.voucherId, shop2Opening.id) });
  assert.equal(lines.filter((line) => line.cashAccountId === shop2.id).length, 1);
  await backfillCashDraftsForUser(orgId);
  const mirrors = await db.query.cashDocuments.findMany({
    where: and(eq(cashDocuments.organizationId, orgId), eq(cashDocuments.sourceVoucherId, shop2Opening.id)),
  });
  assert.equal(mirrors.length, 0, "нээлтийн журналаас толин кассын баримт үүсэхгүй");

  // SIM2-005: 4.2M + 0.8M + 0.65M = 5.65M = GL — худал ЗӨРҮҮ гарахгүй
  const reconcile = ok(await tool("reconcile_modules", { from: "2024-12-01", to: "2024-12-31" })).resultText;
  assert.match(reconcile, /OK GL 10000001 \(3 данс\): Σ модуль 5,650,000 = GL/);
  assert.doesNotMatch(reconcile, /ЗӨРҮҮ Касс/);

  // Өмнөх хувилбарын өгөгдөл: толин НООРОГ баримт → батлахыг хориглоно, сар хаалтад цэвэрлэгдэнэ
  const [legacyDraft] = await db
    .insert(cashDocuments)
    .values({
      userId, organizationId: orgId, documentNo: `GL-LEGACY-${STAMP}`, documentType: "receipt" as const, date: "2024-12-31", description: "Нээлтийн үлдэгдэл (хуучин толь)",
      toCashAccountId: shop2.id, amount: "650000", baseAmount: "650000", currency: "MNT", exchangeRate: "1",
      status: "draft" as const, sourceVoucherId: shop2Opening.id,
    })
    .returning({ id: cashDocuments.id });
  const refused = await tool("post_cash_document", { documentId: legacyDraft.id }, "post");
  assert.match(refused.resultText, /OPENING_MIRROR/);
  const balances = ok(await tool("list_cash_accounts", {})).resultText;
  assert.match(balances, /Касс дэлгүүр №2[^\n]*650,000/, "үлдэгдэл давхардаагүй (6.3M биш)");
  ok(await tool("get_month_end_checklist", { period: "2024-12" }));
  assert.equal(await db.query.cashDocuments.findFirst({ where: eq(cashDocuments.id, legacyDraft.id) }), undefined);

  // SIM2-013: БАТЛАГДСАН толин баримтыг устгахад нээлтийн журнал хөндөгдөхгүй
  const [legacyPosted] = await db
    .insert(cashDocuments)
    .values({
      userId, organizationId: orgId, documentNo: `GL-LEGACY2-${STAMP}`, documentType: "receipt" as const, date: "2024-12-31", description: "Нээлтийн үлдэгдэл (хуучин толь)",
      toCashAccountId: shop2.id, amount: "650000", baseAmount: "650000", currency: "MNT", exchangeRate: "1",
      status: "posted" as const, sourceVoucherId: shop2Opening.id, voucherId: shop2Opening.id,
    })
    .returning({ id: cashDocuments.id });
  const doubled = ok(await tool("reconcile_modules", { from: "2024-12-01", to: "2024-12-31" })).resultText;
  assert.match(doubled, /ЗӨРҮҮ GL 10000001 \(3 данс\)[^\n]*зөрүү 650,000/);
  assert.match(doubled, /давхар тоолсон баримт GL-LEGACY2/);
  ok(await tool("delete_cash_document", { documentId: legacyPosted.id }, "post"));
  const stillThere = await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, shop2Opening.id) });
  assert.equal(stillThere?.status, "posted", "нээлтийн журнал устаагүй");
  assert.match(ok(await tool("reconcile_modules", { from: "2024-12-01", to: "2024-12-31" })).resultText, /OK GL 10000001/);
});

test("SIM2-006: валютын нээлт ханштай бичигдэж батлагдвал тулгалт тодорхой (тэмдэг алдагдсан ч)", { skip: !DB_READY }, async () => {
  await setupOrg();
  // C: Голомт USD 38,500 × 3420.46
  ok(await tool("create_cash_account", {
    name: "Голомт USD", accountType: "bank", currency: "USD", glAccount: "11000002",
    openingBalance: 38_500, openingDate: "2024-12-31",
  }));
  ok(await tool("fix_cash_opening_balance", { cashAccount: "Голомт USD", date: "2024-12-31", exchangeRate: 3420.46 }));
  const { account, voucher } = await openingVoucherOf("Голомт USD");
  assert.equal(Number(account.openingRate), 3420.46, "нээлтийн ханш дансанд хадгалагдсан");
  await postOpeningViaWebForm(voucher.id);
  // Хуучин хувилбараар засагдсан журнал шиг — мөрийн тэмдгийг арилгана
  await db.update(journalLines).set({ cashAccountId: null }).where(eq(journalLines.voucherId, voucher.id));
  await db.update(cashAccounts).set({ openingRate: null }).where(eq(cashAccounts.id, account.id));

  const text = ok(await tool("reconcile_modules", { from: "2024-12-01", to: "2024-12-31" })).resultText;
  assert.doesNotMatch(text, /ТОДОРХОЙГҮЙ Голомт USD/);
  // 38,500 × 3,420.46 = 131,687,710
  assert.match(text, /OK Голомт USD \[38,500 USD\]: 131,687,710/);
});

test("SIM2-014/004: S8 ангилал автоматаар, list_segment_values, sync_standard_accounts", { skip: !DB_READY }, async () => {
  await setupOrg();
  // B: cashFlowCode=1101 — S8 суугаагүй байгууллагад ч ажиллана
  ok(await tool("create_cash_account", { name: "Хаан банк MNT", accountType: "bank", glAccount: "11000001" }));
  ok(await tool("create_cash_transaction", {
    documentType: "receipt", date: "2025-07-05", cashAccount: "Хаан банк MNT", counterAccount: "51100000",
    amount: 120_000, description: "Борлуулалт", cashFlowCode: "1101",
  }));
  const s8 = ok(await tool("list_segment_values", { segment: 8 })).resultText;
  assert.match(s8, /1101 · /);
  const bad = await tool("create_cash_transaction", {
    documentType: "receipt", date: "2025-07-05", cashAccount: "Хаан банк MNT", counterAccount: "51100000",
    amount: 1, description: "x", cashFlowCode: "9999",
  });
  assert.match(bad.resultText, /CASH_FLOW_CODE_NOT_FOUND[^\n]*list_segment_values/);

  // SIM2-004: MCP-ээр стандарт мод — идемпотент, 44000098 байна
  await db.delete(chartOfAccounts).where(and(eq(chartOfAccounts.organizationId, orgId), eq(chartOfAccounts.number, "44000098")));
  assert.match(ok(await tool("sync_standard_accounts", {})).resultText, /Стандарт данс 1 нэмэгдлээ/);
  assert.match(ok(await tool("sync_standard_accounts", {})).resultText, /нэмэх зүйлгүй/);
  assert.match(ok(await tool("list_gl_accounts", { query: "44000098" })).resultText, /44000098/);
});

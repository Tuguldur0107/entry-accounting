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
import { syncStandardAccounts } from "../lib/actions/gl";
import { getPayrollRunData } from "../lib/actions/payroll";
import { db } from "../lib/db";
import {
  accountingPeriods,
  arApDocuments,
  costEntries,
  employees,
  goodsReceipts,
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

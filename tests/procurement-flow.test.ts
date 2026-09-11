// Хангамжийн модулийн ГҮЙЦЭД урсгалын integration тест (гэрээ §13).
// docs/procurement/00-proposal.md §4-ийн ТООН ЖИШЭЭГ бүтнээр давтана:
//
//   PO-2026-001 (USD): LT-01 100 × $400, MN-01 200 × $110 = $62,000
//   09-08 хүлээн авалт, МБ ханш 3,450 → Dr бараа 213,900,000 /
//                                       Cr бараа мат. түр данс 213,900,000
//   09-10 нийлүүлэгчийн нэхэмжлэх, ханш 3,470 → Dr өглөгийн түр данс
//                                       215,140,000 / Cr өглөг
//   09-12 гааль: татвар 10,695,000 (бүрэлдэхүүн) + импортын НӨАТ 22,459,500
//   09-12 хуваарилалт үнийн дүнгээр → LT-01 6,900,000 / MN-01 3,795,000
//   09-15 тээвэр 4,500,000 + НӨАТ 450,000; тоо хэмжээгээр → 1,500,000 / 3,000,000
//   09-20 PO хаалт → ханшийн гарз 1,240,000, хоёр түр данс 0
//   2026-09 сар хаалт: нээлттэй PO байхад "open-purchase-orders", PO
//                      хаагдсаны дараа хаагдана
//
// Ханшийг ИЛ өгнө — Монголбанк руу сүлжээний хандалт ХИЙХГҮЙ.
// DATABASE_URL шаарддаг (ai-tools-flow.test.ts-ийн scaffold): түр
// байгууллага үүсгэж, төгсгөлд нь тооцооны дарааллаар устгана.
//
// Алхам бүтэлгүйтвэл дараагийн алхмууд t.skip-ээр алгасагдана — үндсэн
// шалтгаан НЭГ л удаа, тодорхой харагдана.
//
// ⚠️ ОДООГООР ТУСГАГДААГҮЙ ХЭРЭГЖҮҮЛЭЛТ (тестийг НУУГААГҮЙ, ил үлдээв):
// "гаалийн нэхэмжлэх (ӨӨР харилцагч, MNT)" алхам
// `lib/actions/arap.ts` → `assertPurchaseOrderLines` дээр унана —
// тэр функц PO-той нэхэмжлэх БҮРД харилцагч ба валютыг захиалгатай
// тааруулахыг шаарддаг. Дизайн §4 АП-002/АП-003 (Гааль, Монгол Транс — MNT,
// USD PO-той) ба `lib/ai/tools.ts` ⑧ мөн ӨӨР харилцагчийн MNT зардлын
// нэхэмжлэхийг PO-д холбохыг заадаг. Шалгалтууд нь ЗӨВХӨН PO мөртэй
// холбогдсон БАРААТАЙ мөр байхад хамаарах ёстой (бүрэлдэхүүнтэй/капиталжихгүй
// мөрүүдэд биш). Тэр нэг засвар орсноор доорх БҮХ алхам (хуваарилалт, өртгийн
// бичилт, PO хаалт 229,095,000 / 230,335,000 / ханшийн гарз 1,240,000,
// сар хаалт) дамждаг нь шалгагдсан.

import "./helpers/load-env";

import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";

// revalidatePath нь request-ийн гадна шиддэг — action-ууд дуудахаас өмнө
// no-op болгоно (tsx CJS interop: экспортын объектын талбар тул call-time
// lookup хийгддэг). Патч амжилтгүй бол (ESM frozen) тестүүд "static
// generation store" текстийг амжилт гэж үзэх fallback-тай.
const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд fallback ажиллана
}

import {
  createArApDocument,
  createCounterparty,
} from "../lib/actions/arap";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { createInventoryItem, createWarehouse } from "../lib/actions/inventory";
import { saveCostComponent } from "../lib/actions/costing-master";
import { postCostEntries } from "../lib/actions/costing";
import {
  createCostAllocation,
  loadPoAllocationTargets,
} from "../lib/actions/cost-allocation";
import { closePeriod } from "../lib/actions/periods";
import {
  approvePurchaseOrder,
  closePurchaseOrder,
  confirmGoodsReceipt,
  createApInvoiceFromPo,
  createGoodsReceipt,
  createPurchaseOrder,
  getLandedCostSummary,
} from "../lib/actions/procurement";
import { loadCostingAccountSettings } from "../lib/costing/master-data";
import {
  loadPurchaseOrderDetail,
  loadUnallocatedCostLines,
} from "../lib/procurement/load-data";
import { extractMainAccount } from "../lib/reports/balances";
import { db } from "../lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  costAllocations,
  costComponents,
  costEntries,
  counterparties,
  goodsReceiptLines,
  goodsReceipts,
  inventoryItems,
  inventoryMovements,
  journalLines,
  journalVouchers,
  memberships,
  organizations,
  purchaseOrders,
  users,
  warehouses,
} from "../lib/db/schema";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const cleanup: (() => Promise<void>)[] = [];

// ── §4-ийн тоонууд (тестийн ЦОРЫН ГАНЦ эх сурвалж) ──────────────────────────
const RATE_RECEIPT = 3450; // 2026-09-08 МБ албан ханш
const RATE_INVOICE = 3470; // 2026-09-10 МБ албан ханш
const LT_QTY = 100;
const LT_PRICE = 400;
const MN_QTY = 200;
const MN_PRICE = 110;
const LT_CAPITALIZED = LT_QTY * LT_PRICE * RATE_RECEIPT; // 138,000,000
const MN_CAPITALIZED = MN_QTY * MN_PRICE * RATE_RECEIPT; //  75,900,000
const RECEIPT_TOTAL = LT_CAPITALIZED + MN_CAPITALIZED; //   213,900,000
const PO_USD_TOTAL = LT_QTY * LT_PRICE + MN_QTY * MN_PRICE; //     $62,000
const INVOICE_MNT = PO_USD_TOTAL * RATE_INVOICE; //        215,140,000
const CUSTOMS_DUTY = 10_695_000; // 5% × 213,900,000
const IMPORT_VAT = 22_459_500; // 10% × (213,900,000 + 10,695,000)
const FREIGHT = 4_500_000;
const FREIGHT_VAT = 450_000;
const CUSTOMS_LT = 6_900_000; // үнийн дүнгээр: 138,000,000 / 213,900,000
const CUSTOMS_MN = 3_795_000; // үнийн дүнгээр:  75,900,000 / 213,900,000
const FREIGHT_LT = 1_500_000; // тоо хэмжээгээр: 100 / 300
const FREIGHT_MN = 3_000_000; // тоо хэмжээгээр: 200 / 300
const FX_LOSS = 1_240_000; // $62,000 × (3,470 − 3,450)
const LT_UNIT_LANDED = 1_464_000; // 146,400,000 / 100
const MN_UNIT_LANDED = 413_475; //   82,695,000 / 200
const INV_CLEARING_CREDIT = RECEIPT_TOTAL + CUSTOMS_DUTY + FREIGHT; // 229,095,000
const AP_CLEARING_DEBIT = INVOICE_MNT + CUSTOMS_DUTY + FREIGHT; //      230,335,000

/** Импортын НӨАТ авлага ба гаалийн татварын өглөг — стандарт дансны каталогоос. */
const VAT_INPUT_ACCOUNT = "13620000";
const CUSTOMS_PAYABLE_ACCOUNT = "31000006";
const AP_CONTROL_ACCOUNT = "31000001";
const INVENTORY_ACCOUNT = "14000001";

let userId = "";
let orgId = "";
let supplierId = "";
let customsCounterpartyId = "";
let freightCounterpartyId = "";
let warehouseId = "";
let ltItemId = "";
let mnItemId = "";
let customsComponentId = "";
let freightComponentId = "";
let purchaseOrderId = "";
let ltLineId = "";
let mnLineId = "";
let customsLineId = "";
let freightLineId = "";
let ltMovementId = "";
let mnMovementId = "";
let allocationsDone = false;
let costEntriesPosted = false;
let poClosed = false;

const roles = {
  clearing: "",
  apClearing: "",
  fxGain: "",
  fxLoss: "",
};

function asOrg<T>(fn: () => Promise<T>): Promise<T> {
  return runAsOrg({ userId, orgId }, fn);
}

/** ActionResult → өгөгдөл (алдаа бол тестийг унагана). */
function ok<T extends { error?: string }>(
  result: T,
  label: string
): Extract<T, { error?: undefined }> {
  assert.equal(result.error, undefined, `${label}: ${result.error}`);
  return result as Extract<T, { error?: undefined }>;
}

/** Хүлээгдэж байсан алдааны мессеж (wrapper нь код агуулсан текст буцаана). */
function errorOf(result: { error?: string }, label: string): string {
  const message = result.error;
  assert.ok(message, `${label}: алдаа гарах ёстой байсан`);
  return message;
}

/** Өмнөх алхам бүтээгүй бол тестийг алгасна (нэг үндсэн шалтгаан л харагдана). */
function needs(t: TestContext, ready: boolean, label: string): boolean {
  if (ready) return true;
  t.skip(`${label} бүтээгүй тул алгаслаа`);
  return false;
}

/**
 * Тухайн PO-гийн журналын мөрүүдээс үндсэн дансаар Σ(Dr − Cr).
 * Клирингийн үлдэгдэл `journal_lines.businessObjectType/Id`-аар
 * тодорхойлогдоно; posted + reversed хоёулаа (буцаалт нь эсрэг мөрөөр шинэ
 * журналд бичигддэг тул эх журналыг хасахгүй).
 */
async function poBalances(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      accountNumber: journalLines.accountNumber,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalLines.voucherId))
    .where(
      and(
        eq(journalVouchers.organizationId, orgId),
        inArray(journalVouchers.status, ["posted", "reversed"]),
        eq(journalLines.businessObjectType, "purchase_order"),
        eq(journalLines.businessObjectId, purchaseOrderId)
      )
    );
  const balances = new Map<string, number>();
  for (const row of rows) {
    const main = extractMainAccount(row.accountNumber);
    const next =
      (balances.get(main) ?? 0) + Number(row.debit) - Number(row.credit);
    balances.set(main, Math.round(next * 100) / 100);
  }
  return balances;
}

/**
 * Цэвэрлэгээ — мастер дата руу RESTRICT FK-тай мөрүүдийг ТООЦООНЫ ДАРААЛЛААР
 * устгаад дараа нь байгууллагыг (бусад нь cascade). Зөвхөн cascade-д найдвал
 * `purchase_order_lines.item_id` (restrict) зэрэг зөрчил гардаг.
 */
async function purgeOrg(targetOrgId: string) {
  await db
    .delete(costAllocations)
    .where(eq(costAllocations.organizationId, targetOrgId));
  await db.delete(costEntries).where(eq(costEntries.organizationId, targetOrgId));
  await db
    .delete(goodsReceipts)
    .where(eq(goodsReceipts.organizationId, targetOrgId));
  await db
    .delete(inventoryMovements)
    .where(eq(inventoryMovements.organizationId, targetOrgId));
  await db
    .delete(arApDocuments)
    .where(eq(arApDocuments.organizationId, targetOrgId));
  await db
    .delete(purchaseOrders)
    .where(eq(purchaseOrders.organizationId, targetOrgId));
  await db.delete(organizations).where(eq(organizations.id, targetOrgId));
}

async function setupOrg() {
  const [user] = await db
    .insert(users)
    .values({
      name: `proc-flow-${STAMP}`,
      email: `proc-flow-${STAMP}@test.local`,
      passwordHash: "x",
    })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `Procurement Flow Test ${STAMP}` })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({
    organizationId: org.id,
    userId: user.id,
    role: "owner",
  });
  cleanup.push(async () => {
    await purgeOrg(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс сеедлэгдэх ёстой: ${sync.error}`);

  // Дансны РОЛЬ тохиргооноос (JPR-006) — тестэд ч дугаар хатуу бичихгүй.
  const settings = await loadCostingAccountSettings(orgId, userId);
  roles.clearing = settings.clearingAccountNumber;
  roles.apClearing = settings.apClearingAccountNumber;
  roles.fxGain = settings.fxGainAccountNumber;
  roles.fxLoss = settings.fxLossAccountNumber;
}

test(
  "мастер дата — нийлүүлэгч, бараа, агуулах, өртгийн бүрэлдэхүүн",
  { skip: !DB_READY },
  async () => {
    await setupOrg();

    supplierId = (
      await asOrg(() =>
        createCounterparty({
          name: `Shenzhen Tech ${STAMP}`,
          counterpartyType: "supplier",
          defaultCurrency: "USD",
          paymentTermsDays: 15,
        })
      )
    ).id;
    customsCounterpartyId = (
      await asOrg(() =>
        createCounterparty({
          name: `Гаалийн газар ${STAMP}`,
          counterpartyType: "supplier",
          defaultPayableAccountNumber: CUSTOMS_PAYABLE_ACCOUNT,
        })
      )
    ).id;
    freightCounterpartyId = (
      await asOrg(() =>
        createCounterparty({
          name: `Монгол Транс ${STAMP}`,
          counterpartyType: "supplier",
        })
      )
    ).id;

    await asOrg(() =>
      createInventoryItem({
        code: `LT-01-${STAMP}`,
        name: "Зөөврийн компьютер",
        unit: "ш",
      })
    );
    await asOrg(() =>
      createInventoryItem({ code: `MN-01-${STAMP}`, name: "Монитор", unit: "ш" })
    );
    await asOrg(() =>
      createWarehouse({ code: `WH-${STAMP}`, name: "Үндсэн агуулах" })
    );

    const items = await db.query.inventoryItems.findMany({
      where: eq(inventoryItems.organizationId, orgId),
    });
    const ltItem = items.find((item) => item.code.startsWith("LT-01"));
    const mnItem = items.find((item) => item.code.startsWith("MN-01"));
    assert.ok(ltItem && mnItem, "хоёр бараа бүртгэгдэх ёстой");
    ltItemId = ltItem.id;
    mnItemId = mnItem.id;

    const [warehouse] = await db.query.warehouses.findMany({
      where: eq(warehouses.organizationId, orgId),
    });
    assert.ok(warehouse, "агуулах бүртгэгдэх ёстой");
    warehouseId = warehouse.id;

    for (const component of [
      { code: "CUSTOMS", name: "Гаалийн татвар" },
      { code: "FREIGHT", name: "Тээвэр" },
    ]) {
      const saved = await asOrg(() =>
        saveCostComponent({
          code: component.code,
          name: component.name,
          classification: "Худалдан авалтын нэмэлт зардал",
          accountNumber: "",
        })
      );
      assert.equal(
        saved.ok,
        true,
        `${component.code} бүрэлдэхүүн хадгалагдах ёстой`
      );
    }
    const components = await db.query.costComponents.findMany({
      where: eq(costComponents.organizationId, orgId),
    });
    const customs = components.find((row) => row.code === "CUSTOMS");
    const freight = components.find((row) => row.code === "FREIGHT");
    assert.ok(customs && freight, "бүрэлдэхүүн лавлах бүрдэх ёстой");
    customsComponentId = customs.id;
    freightComponentId = freight.id;
  }
);

test(
  "PO үүсгэх + батлах — GL бичилт ҮГҮЙ, дүн $62,000",
  { skip: !DB_READY },
  async (t) => {
    if (!needs(t, !!ltItemId, "мастер дата")) return;

    const created = ok(
      await asOrg(() =>
        createPurchaseOrder({
          counterpartyId: supplierId,
          date: "2026-09-03",
          currency: "USD",
          warehouseId,
          description: "Импортын худалдан авалт (дизайн §4)",
          lines: [
            { itemId: ltItemId, quantity: LT_QTY, unitPrice: LT_PRICE },
            { itemId: mnItemId, quantity: MN_QTY, unitPrice: MN_PRICE },
          ],
        })
      ),
      "createPurchaseOrder"
    );
    purchaseOrderId = created.id;

    const [order] = await db.query.purchaseOrders.findMany({
      where: eq(purchaseOrders.id, purchaseOrderId),
    });
    assert.equal(order.status, "draft");
    assert.equal(order.currency, "USD");
    assert.equal(Number(order.totalAmount), PO_USD_TOTAL);

    // Захиалга нь гүйлгээ БИШ — GL бичилт гарахгүй.
    assert.equal((await poBalances()).size, 0, "PO үүсгэхэд GL бичилт гарахгүй");

    ok(
      await asOrg(() => approvePurchaseOrder({ id: purchaseOrderId })),
      "approvePurchaseOrder"
    );
    const detail = await loadPurchaseOrderDetail(orgId, purchaseOrderId);
    assert.ok(detail, "PO дэлгэрэнгүй уншигдах ёстой");
    assert.equal(detail.status, "open");
    assert.equal((await poBalances()).size, 0, "батлахад ч GL бичилт гарахгүй");

    const ltLine = detail.lines.find((line) => line.itemId === ltItemId);
    const mnLine = detail.lines.find((line) => line.itemId === mnItemId);
    assert.ok(ltLine && mnLine, "PO мөрүүд байх ёстой");
    ltLineId = ltLine.id;
    mnLineId = mnLine.id;
    assert.equal(ltLine.amount, LT_QTY * LT_PRICE);
    assert.equal(mnLine.amount, MN_QTY * MN_PRICE);
  }
);

test(
  "хүлээн авалт (ханш 3,450 ИЛ) — receipt_capitalize = тоо × PO үнэ × ханш",
  { skip: !DB_READY },
  async (t) => {
    if (!needs(t, !!purchaseOrderId, "PO батлах")) return;

    const receipt = ok(
      await asOrg(() =>
        createGoodsReceipt({
          purchaseOrderId,
          date: "2026-09-08",
          warehouseId,
          // Ханшийг ИЛ өгнө — Монголбанк руу хандахгүй.
          exchangeRate: RATE_RECEIPT,
          description: "Бараа хүлээн авав",
        })
      ),
      "createGoodsReceipt"
    );

    const confirmed = ok(
      await asOrg(() => confirmGoodsReceipt({ id: receipt.id })),
      "confirmGoodsReceipt"
    );
    assert.equal(confirmed.amountMnt, RECEIPT_TOTAL, "капитализацийн нийт дүн");
    assert.ok(confirmed.voucherId, "капитализацийн журнал үүсэх ёстой");

    // cost_entries — receipt_capitalize, valuationSource "po_receipt".
    const entries = await db.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        eq(costEntries.entryType, "receipt_capitalize")
      ),
    });
    assert.equal(entries.length, 2, "бараа бүрд нэг капитализаци");
    const ltEntry = entries.find((entry) => entry.itemId === ltItemId);
    const mnEntry = entries.find((entry) => entry.itemId === mnItemId);
    assert.ok(ltEntry && mnEntry, "бараа бүрийн бичилт байх ёстой");
    assert.equal(Number(ltEntry.amount), LT_CAPITALIZED);
    assert.equal(Number(mnEntry.amount), MN_CAPITALIZED);
    assert.equal(Number(ltEntry.unitCost), LT_PRICE * RATE_RECEIPT);
    assert.equal(Number(mnEntry.unitCost), MN_PRICE * RATE_RECEIPT);
    for (const entry of entries) {
      assert.equal(entry.status, "posted");
      assert.equal(entry.valuationSource, "po_receipt");
      assert.equal(entry.businessObjectType, "purchase_order");
      assert.equal(entry.businessObjectId, purchaseOrderId);
      assert.equal(entry.periodCode, "2026-09");
      assert.equal(
        entry.creditAccountNumber,
        roles.clearing,
        "Cr бараа материалын түр данс"
      );
      assert.equal(entry.debitAccountNumber, INVENTORY_ACCOUNT, "Dr барааны нөөц");
    }

    // inventory_movements.sourceType = "po_receipt".
    const movements = await db.query.inventoryMovements.findMany({
      where: eq(inventoryMovements.organizationId, orgId),
    });
    assert.equal(movements.length, 2);
    for (const movement of movements) {
      assert.equal(movement.sourceType, "po_receipt");
      assert.equal(movement.status, "confirmed");
      assert.equal(movement.movementType, "receipt");
      assert.equal(movement.warehouseId, warehouseId);
    }
    const ltMovement = movements.find((movement) => movement.itemId === ltItemId);
    const mnMovement = movements.find((movement) => movement.itemId === mnItemId);
    assert.ok(ltMovement && mnMovement, "бараа бүрд орлого үүсэх ёстой");
    ltMovementId = ltMovement.id;
    mnMovementId = mnMovement.id;

    const receiptLines = await db.query.goodsReceiptLines.findMany({
      where: eq(goodsReceiptLines.receiptId, receipt.id),
    });
    assert.equal(
      receiptLines.filter((line) => line.movementId).length,
      2,
      "хүлээн авалтын мөр бүр орлогын хөдөлгөөнтэй холбогдоно"
    );

    // GL: Dr барааны нөөц / Cr бараа материалын түр данс (PO объектоор).
    const balances = await poBalances();
    assert.equal(balances.get(roles.clearing), -RECEIPT_TOTAL);
    assert.equal(balances.get(INVENTORY_ACCOUNT), RECEIPT_TOTAL);
  }
);

test(
  "нийлүүлэгчийн нэхэмжлэх (ханш 3,470) + илүү тоогоор [OVER_INVOICED]",
  { skip: !DB_READY },
  async (t) => {
    if (!needs(t, !!ltMovementId, "хүлээн авалт")) return;

    const invoice = ok(
      await asOrg(() =>
        createApInvoiceFromPo({
          purchaseOrderId,
          date: "2026-09-10",
          exchangeRate: RATE_INVOICE,
          description: "Нийлүүлэгчийн нэхэмжлэх",
          postNow: true,
        })
      ),
      "createApInvoiceFromPo"
    );

    const [document] = await db.query.arApDocuments.findMany({
      where: eq(arApDocuments.id, invoice.id),
      with: { lines: true },
    });
    assert.equal(document.status, "posted");
    assert.equal(document.currency, "USD");
    assert.equal(Number(document.exchangeRate), RATE_INVOICE);
    assert.equal(Number(document.totalAmount), PO_USD_TOTAL);
    assert.equal(Number(document.baseTotalAmount), INVOICE_MNT);
    assert.equal(document.purchaseOrderId, purchaseOrderId);
    for (const line of document.lines) {
      assert.equal(
        extractMainAccount(line.accountNumber),
        roles.apClearing,
        "PO-той нэхэмжлэхийн бараатай мөр өглөгийн түр дансанд суух ёстой"
      );
      assert.ok(line.purchaseOrderLineId, "мөр PO мөртэй холбогдоно");
    }

    // Нэхэмжлэх орлогын хөдөлгөөн ҮҮСГЭХГҮЙ (орлого нь хүлээн авалтаас).
    const movements = await db.query.inventoryMovements.findMany({
      where: eq(inventoryMovements.organizationId, orgId),
    });
    assert.equal(movements.length, 2, "нэхэмжлэх шинэ хөдөлгөөн үүсгэхгүй");

    // GL: Dr өглөгийн түр данс / Cr өглөг.
    const balances = await poBalances();
    assert.equal(balances.get(roles.apClearing), INVOICE_MNT);

    // Илүү тоогоор дахин нэхэмжлэх → [OVER_INVOICED].
    const over = await asOrg(() =>
      createApInvoiceFromPo({
        purchaseOrderId,
        date: "2026-09-11",
        exchangeRate: RATE_INVOICE,
        description: "Илүү нэхэмжлэх",
        lines: [{ purchaseOrderLineId: ltLineId, quantity: 1 }],
      })
    );
    assert.match(
      errorOf(over, "илүү нэхэмжлэх"),
      /\[OVER_INVOICED\]/,
      "PO мөрийн үлдэгдлээс илүү нэхэмжлэхийг таслана"
    );
  }
);

test(
  "гаалийн нэхэмжлэх (ӨӨР харилцагч, MNT) — бүрэлдэхүүнтэй мөр + импортын НӨАТ",
  { skip: !DB_READY },
  async (t) => {
    if (!needs(t, !!ltMovementId, "хүлээн авалт")) return;

    const customs = await asOrg(() =>
      createArApDocument({
        documentType: "ap_bill",
        counterpartyId: customsCounterpartyId,
        date: "2026-09-12",
        dueDate: "2026-09-20",
        currency: "MNT",
        controlAccountNumber: CUSTOMS_PAYABLE_ACCOUNT,
        description: "Гаалийн татвар ба импортын НӨАТ",
        purchaseOrderId,
        lines: [
          {
            account: roles.apClearing,
            description: "Гаалийн татвар 5%",
            amount: CUSTOMS_DUTY,
            costComponentId: customsComponentId,
          },
          {
            account: VAT_INPUT_ACCOUNT,
            description: "Импортын НӨАТ 10%",
            amount: IMPORT_VAT,
          },
        ],
        postNow: true,
      })
    );
    assert.equal(
      customs.error,
      undefined,
      "дизайн §4 АП-002: ГААЛЬ бол PO-гийн нийлүүлэгчээс ӨӨР харилцагч, " +
        "нэхэмжлэх нь MNT — гэхдээ мөр нь PO-той холбогдож өглөгийн түр " +
        "дансанд суух ёстой (lib/ai/tools.ts ⑧ мөн ингэж заадаг). " +
        `Алдаа: ${customs.error}`
    );

    const [document] = await db.query.arApDocuments.findMany({
      where: eq(arApDocuments.id, customs.id ?? ""),
      with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
    });
    assert.equal(document.status, "posted");
    assert.equal(document.purchaseOrderId, purchaseOrderId);
    assert.equal(Number(document.baseTotalAmount), CUSTOMS_DUTY + IMPORT_VAT);

    const componentLine = document.lines.find((line) => line.costComponentId);
    const vatLine = document.lines.find((line) => !line.costComponentId);
    assert.ok(componentLine && vatLine, "бүрэлдэхүүнтэй + НӨАТ мөр байх ёстой");
    customsLineId = componentLine.id;
    assert.equal(Number(componentLine.amount), CUSTOMS_DUTY);
    assert.equal(
      extractMainAccount(componentLine.accountNumber),
      roles.apClearing,
      "гаалийн татвар өглөгийн түр дансанд (капиталжина)"
    );
    assert.equal(Number(vatLine.amount), IMPORT_VAT);
    assert.equal(
      extractMainAccount(vatLine.accountNumber),
      VAT_INPUT_ACCOUNT,
      "импортын НӨАТ капиталжихгүй — НӨАТ авлагын данс"
    );

    // Нэхэмжлэх өөрөө хуваарилалт/өртгийн бичилт үүсгэхгүй.
    const landed = await db.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        eq(costEntries.entryType, "landed_cost")
      ),
    });
    assert.equal(landed.length, 0, "хуваарилалт нь тусдаа алхам");

    const balances = await poBalances();
    assert.equal(balances.get(roles.apClearing), INVOICE_MNT + CUSTOMS_DUTY);
    // Импортын НӨАТ нь PO-гийн lineage-тай (аудит) ч КАПИТАЛЖИХГҮЙ —
    // НӨАТ авлагын дансанд дебетлэгдэж, барааны дүнд орохгүй.
    assert.equal(balances.get(VAT_INPUT_ACCOUNT), IMPORT_VAT);
    assert.equal(
      balances.get(INVENTORY_ACCOUNT),
      RECEIPT_TOTAL,
      "импортын НӨАТ барааны нөөцөд ОРОХГҮЙ"
    );
    assert.equal(
      balances.get(roles.clearing),
      -RECEIPT_TOTAL,
      "импортын НӨАТ бараа мат. түр дансыг хөндөхгүй"
    );
  }
);

test(
  "тээврийн нэхэмжлэх (ӨӨР харилцагч, MNT) — бүрэлдэхүүн + НӨАТ",
  { skip: !DB_READY },
  async (t) => {
    if (!needs(t, !!customsLineId, "гаалийн нэхэмжлэх")) return;

    const freight = ok(
      await asOrg(() =>
        createArApDocument({
          documentType: "ap_bill",
          counterpartyId: freightCounterpartyId,
          date: "2026-09-15",
          dueDate: "2026-09-30",
          currency: "MNT",
          controlAccountNumber: AP_CONTROL_ACCOUNT,
          description: "Тээврийн зардал",
          purchaseOrderId,
          lines: [
            {
              account: roles.apClearing,
              description: "Тээвэр",
              amount: FREIGHT,
              costComponentId: freightComponentId,
            },
            {
              account: VAT_INPUT_ACCOUNT,
              description: "НӨАТ 10%",
              amount: FREIGHT_VAT,
            },
          ],
          postNow: true,
        })
      ),
      "тээврийн нэхэмжлэх"
    );

    const [document] = await db.query.arApDocuments.findMany({
      where: eq(arApDocuments.id, freight.id),
      with: { lines: true },
    });
    assert.equal(document.status, "posted");
    const componentLine = document.lines.find((line) => line.costComponentId);
    assert.ok(componentLine, "бүрэлдэхүүнтэй мөр байх ёстой");
    freightLineId = componentLine.id;

    const balances = await poBalances();
    assert.equal(balances.get(roles.apClearing), AP_CLEARING_DEBIT);
    assert.equal(
      balances.get(VAT_INPUT_ACCOUNT),
      IMPORT_VAT + FREIGHT_VAT,
      "НӨАТ капиталжихгүй — авлагын дансанд"
    );

    // Worklist — хоёр зардлын мөр бүтнээрээ хуваарилагдаагүй.
    const worklist = await loadUnallocatedCostLines(orgId, { purchaseOrderId });
    assert.equal(worklist.length, 2);
    const remaining = new Map(
      worklist.map((row) => [row.costComponentName, row.remainingMnt])
    );
    assert.equal(remaining.get("Гаалийн татвар"), CUSTOMS_DUTY);
    assert.equal(remaining.get("Тээвэр"), FREIGHT);
  }
);

test(
  'хаалтын хориг — хуваарилагдаагүй зардалтай PO [PO_NOT_READY], сар "open-purchase-orders"',
  { skip: !DB_READY },
  async (t) => {
    if (!needs(t, !!freightLineId, "тээврийн нэхэмжлэх")) return;

    const detail = await loadPurchaseOrderDetail(orgId, purchaseOrderId);
    assert.ok(detail);
    assert.equal(detail.blockers.length, 1, JSON.stringify(detail.blockers));
    assert.match(detail.blockers[0], /Хуваарилагдаагүй нэмэлт зардал/);

    const premature = await asOrg(() =>
      closePurchaseOrder({ id: purchaseOrderId, closeDate: "2026-09-20" })
    );
    assert.match(
      errorOf(premature, "хуваарилагдаагүй зардалтай PO-г хаах"),
      /\[PO_NOT_READY\]/
    );

    // Тэр сард батлагдсан хүлээн авалттай НЭЭЛТТЭЙ PO байвал сар хаагдахгүй.
    const blocked = await asOrg(() => closePeriod("2026-09"));
    assert.equal(blocked.ok, false, "нээлттэй PO-той сар хаагдах ёсгүй");
    if (!blocked.ok) assert.equal(blocked.code, "open-purchase-orders");
  }
);

test(
  "хуваарилалт — үнийн дүнгээр, тоо хэмжээгээр, Σ хэтрэхэд [ALLOCATION_EXCEEDS_LINE]",
  { skip: !DB_READY },
  async (t) => {
    if (!needs(t, !!freightLineId, "зардлын нэхэмжлэхүүд")) return;

    const targets = await asOrg(() => loadPoAllocationTargets(purchaseOrderId));
    assert.equal(targets.length, 2, "PO-гийн хоёр хүлээн авалт зорилт болно");
    const ltTarget = targets.find((target) => target.movementId === ltMovementId);
    const mnTarget = targets.find((target) => target.movementId === mnMovementId);
    assert.ok(ltTarget && mnTarget, "зорилтууд PO-гийн орлогууд байна");
    // D6 = (а): жин нь ЗӨВХӨН receipt_capitalize дүн (landed_cost орохгүй).
    assert.equal(ltTarget.value, LT_CAPITALIZED);
    assert.equal(mnTarget.value, MN_CAPITALIZED);

    // ① Гааль — үнийн дүнгээр.
    const customsAlloc = await asOrg(() =>
      createCostAllocation({
        date: "2026-09-12",
        costComponentId: customsComponentId,
        totalAmount: CUSTOMS_DUTY,
        allocationBase: "value",
        sourceLineId: customsLineId,
        targets: [{ movementId: ltMovementId }, { movementId: mnMovementId }],
      })
    );
    assert.equal(
      customsAlloc.ok,
      true,
      `гаалийн хуваарилалт: ${customsAlloc.ok ? "" : customsAlloc.message}`
    );

    // ② Тээвэр — тоо хэмжээгээр.
    const freightAlloc = await asOrg(() =>
      createCostAllocation({
        date: "2026-09-15",
        costComponentId: freightComponentId,
        totalAmount: FREIGHT,
        allocationBase: "quantity",
        sourceLineId: freightLineId,
        targets: [{ movementId: ltMovementId }, { movementId: mnMovementId }],
      })
    );
    assert.equal(
      freightAlloc.ok,
      true,
      `тээврийн хуваарилалт: ${freightAlloc.ok ? "" : freightAlloc.message}`
    );

    const landed = await db.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        eq(costEntries.entryType, "landed_cost")
      ),
    });
    assert.equal(landed.length, 4, "2 зардал × 2 бараа");
    const amountOf = (itemId: string, componentId: string) =>
      landed
        .filter(
          (entry) => entry.itemId === itemId && entry.costComponentId === componentId
        )
        .reduce((sum, entry) => sum + Number(entry.amount), 0);
    assert.equal(amountOf(ltItemId, customsComponentId), CUSTOMS_LT);
    assert.equal(amountOf(mnItemId, customsComponentId), CUSTOMS_MN);
    assert.equal(amountOf(ltItemId, freightComponentId), FREIGHT_LT);
    assert.equal(amountOf(mnItemId, freightComponentId), FREIGHT_MN);
    for (const entry of landed) {
      assert.equal(entry.status, "draft", "хуваарилалт НООРОГ бичилт үүсгэнэ");
      assert.equal(entry.valuationSource, "ap_line");
      assert.equal(entry.businessObjectType, "purchase_order");
      assert.equal(entry.businessObjectId, purchaseOrderId);
      assert.equal(Number(entry.quantity), 0, "дүн л нэмэгдэнэ (IAS 2.11)");
    }

    // ③ Мөрийн MNT дүнг хэтрүүлсэн нэмэлт хуваарилалт → [ALLOCATION_EXCEEDS_LINE].
    const excess = await asOrg(() =>
      createCostAllocation({
        date: "2026-09-15",
        costComponentId: freightComponentId,
        totalAmount: 1,
        allocationBase: "quantity",
        sourceLineId: freightLineId,
        targets: [{ movementId: ltMovementId }, { movementId: mnMovementId }],
      })
    );
    assert.equal(excess.ok, false, "Σ хуваарилалт мөрийн дүнг хэтрэхгүй");
    if (!excess.ok)
      assert.match(excess.message ?? "", /\[ALLOCATION_EXCEEDS_LINE\]/);

    // Хуваарилагдсаны дараа worklist хоосон.
    const worklist = await loadUnallocatedCostLines(orgId, { purchaseOrderId });
    assert.equal(worklist.length, 0, "бүх зардал хуваарилагдав");
    allocationsDone = true;
  }
);

test(
  "өртгийн бичилт батлах — Dr барааны нөөц / Cr бараа мат. түр данс",
  { skip: !DB_READY },
  async (t) => {
    if (!needs(t, allocationsDone, "хуваарилалт")) return;

    const drafts = await db.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        eq(costEntries.entryType, "landed_cost"),
        eq(costEntries.status, "draft")
      ),
      columns: { id: true },
    });
    const result = await asOrg(() =>
      postCostEntries(drafts.map((entry) => entry.id))
    );
    assert.deepEqual(result.failures, [], "өртгийн бичилт батлагдах ёстой");
    assert.equal(result.posted, 4);

    const posted = await db.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        eq(costEntries.entryType, "landed_cost")
      ),
    });
    for (const entry of posted) {
      assert.equal(entry.status, "posted");
      assert.equal(
        entry.creditAccountNumber,
        roles.clearing,
        "PO-той landed_cost нь бараа мат. түр дансаар кредитлэгдэнэ"
      );
      assert.equal(entry.debitAccountNumber, INVENTORY_ACCOUNT);
    }

    const balances = await poBalances();
    assert.equal(balances.get(roles.clearing), -INV_CLEARING_CREDIT);
    assert.equal(balances.get(INVENTORY_ACCOUNT), INV_CLEARING_CREDIT);
    assert.equal(balances.get(roles.apClearing), AP_CLEARING_DEBIT);

    // Landed cost нэгж өртөг (§4): LT-01 1,464,000 / MN-01 413,475.
    const summary = ok(
      await asOrg(() => getLandedCostSummary({ purchaseOrderId })),
      "getLandedCostSummary"
    );
    const unitById = new Map(
      summary.items.map((item) => [item.itemId, item.unitLanded])
    );
    assert.equal(unitById.get(ltItemId), LT_UNIT_LANDED);
    assert.equal(unitById.get(mnItemId), MN_UNIT_LANDED);
    costEntriesPosted = true;
  }
);

test(
  "PO хаах — ханшийн зөрүү 1,240,000 гарз, хоёр түр данс 0",
  { skip: !DB_READY },
  async (t) => {
    if (!needs(t, costEntriesPosted, "өртгийн бичилт батлах")) return;

    const detail = await loadPurchaseOrderDetail(orgId, purchaseOrderId);
    assert.ok(detail);
    assert.deepEqual(detail.blockers, [], "хаалтын нөхцөл биелсэн байх ёстой");
    assert.equal(detail.clearing.inventory, -INV_CLEARING_CREDIT);
    assert.equal(detail.clearing.payable, AP_CLEARING_DEBIT);

    const closed = ok(
      await asOrg(() =>
        closePurchaseOrder({ id: purchaseOrderId, closeDate: "2026-09-20" })
      ),
      "closePurchaseOrder"
    );
    assert.ok(closed.voucherId);

    const [voucher] = await db.query.journalVouchers.findMany({
      where: eq(journalVouchers.id, closed.voucherId),
      with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
    });
    assert.equal(voucher.status, "posted");
    assert.equal(voucher.date, "2026-09-20");
    const closeLines = new Map(
      voucher.lines.map((line) => [
        extractMainAccount(line.accountNumber),
        { debit: Number(line.debit), credit: Number(line.credit) },
      ])
    );
    assert.equal(
      closeLines.get(roles.clearing)?.debit,
      INV_CLEARING_CREDIT,
      "Dr бараа материалын түр данс 229,095,000"
    );
    assert.equal(
      closeLines.get(roles.apClearing)?.credit,
      AP_CLEARING_DEBIT,
      "Cr өглөгийн түр данс 230,335,000"
    );
    assert.equal(
      closeLines.get(roles.fxLoss)?.debit,
      FX_LOSS,
      "ханшийн гарз = $62,000 × (3,470 − 3,450)"
    );
    assert.equal(closeLines.has(roles.fxGain), false, "олз гарахгүй");
    for (const line of voucher.lines) {
      assert.equal(line.businessObjectType, "purchase_order");
      assert.equal(line.businessObjectId, purchaseOrderId);
    }

    // Хоёр түр данс PO объектоороо 0.
    const balances = await poBalances();
    assert.equal(balances.get(roles.clearing), 0, "бараа мат. түр данс 0");
    assert.equal(balances.get(roles.apClearing), 0, "өглөгийн түр данс 0");

    const [order] = await db.query.purchaseOrders.findMany({
      where: eq(purchaseOrders.id, purchaseOrderId),
    });
    assert.equal(order.status, "closed");
    assert.equal(order.closeVoucherId, closed.voucherId);

    // Хаагдсан PO-д нэхэмжлэх нэмэгдэхгүй.
    const afterClose = await asOrg(() =>
      createApInvoiceFromPo({
        purchaseOrderId,
        date: "2026-09-21",
        exchangeRate: RATE_INVOICE,
        lines: [{ purchaseOrderLineId: mnLineId, quantity: 1 }],
      })
    );
    assert.match(errorOf(afterClose, "хаагдсан PO-д нэхэмжлэх"), /\[PO_CLOSED\]/);
    poClosed = true;
  }
);

test(
  "сар хаалт — PO хаагдсаны дараа 2026-09 хаагдана",
  { skip: !DB_READY },
  async (t) => {
    if (!needs(t, poClosed, "PO хаах")) return;
    const result = await asOrg(() => closePeriod("2026-09"));
    assert.equal(result.ok, true, `сар хаагдах ёстой: ${JSON.stringify(result)}`);
  }
);

test("цэвэрлэгээ", { skip: !DB_READY }, async () => {
  for (const fn of cleanup.reverse()) await fn();
  const leftoverOrg = await db.query.organizations.findMany({
    where: eq(organizations.id, orgId),
  });
  assert.equal(leftoverOrg.length, 0);
  const leftoverOrders = await db.query.purchaseOrders.findMany({
    where: eq(purchaseOrders.organizationId, orgId),
  });
  assert.equal(leftoverOrders.length, 0);
  const leftoverCounterparties = await db.query.counterparties.findMany({
    where: eq(counterparties.organizationId, orgId),
  });
  assert.equal(leftoverCounterparties.length, 0);
  const leftoverLines = await db
    .select({ id: arApDocumentLines.id })
    .from(arApDocumentLines)
    .innerJoin(arApDocuments, eq(arApDocuments.id, arApDocumentLines.documentId))
    .where(eq(arApDocuments.organizationId, orgId));
  assert.equal(leftoverLines.length, 0);
});

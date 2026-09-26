// НХАТ (нийслэлийн албан татвар) — POS борлуулалт → GL-д Cr НХАТ өглөг, мөр/баримтад
// cityTaxAmount; буцаалт → Dr НХАТ өглөг. Хувь нь pos_settings.cityTaxPercent (байгууллага
// өөрөө бичнэ), зөвхөн cityTaxable бараанд. DATABASE_URL байхгүй бол алгасна.

import "./helpers/load-env";

import assert from "node:assert/strict";
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
import { db } from "../lib/db";
import {
  journalLines,
  journalVouchers,
  memberships,
  organizationProfile,
  organizations,
  posSaleLines,
  posSales,
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
const main = (code: string) => (code.split(".").length === 10 ? code.split(".")[2] : code);

async function voucherLines(externalRef: string) {
  const voucher = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.externalRef, externalRef)),
  });
  assert.ok(voucher, `журнал ${externalRef}`);
  const lines = await db.select().from(journalLines).where(eq(journalLines.voucherId, voucher.id));
  const debit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.credit), 0);
  assert.ok(Math.abs(debit - credit) < 0.005, `${externalRef}: Дт ${debit} ≠ Кт ${credit}`);
  const byAccount = (account: string, side: "debit" | "credit") =>
    lines.filter((line) => main(line.accountNumber) === account).reduce((sum, line) => sum + Number(line[side]), 0);
  return { byAccount };
}

test("НХАТ: POS борлуулалт ба буцаалт — Cr/Dr 31440000, мөрийн задаргаа, тэнцвэр", { skip: !DB_READY }, async () => {
  const [user] = await db
    .insert(users)
    .values({ name: `ct-${STAMP}`, email: `ct-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `НХАТ ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `НХАТ ${STAMP}` });
  const sync = await asOrg(() => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
  // НӨАТ төлөгч байгууллага (ресторан) — НӨАТ ба НХАТ хоёулаа ногдоно.
  await db.insert(vatSettings).values({ userId, organizationId: orgId, isVatPayer: true });

  ok(await tool("create_warehouse", { code: "WH1", name: "Ресторан" }));
  ok(await tool("create_inventory_item", { code: "BEER", name: "Пиво", unit: "ш", salesPrice: 11_200, cityTaxable: true }));
  ok(await tool("create_inventory_item", { code: "BREAD", name: "Талх", unit: "ш", salesPrice: 3_300 }));
  ok(await tool("create_cash_account", { name: "Касс", accountType: "cash", currency: "MNT", glAccount: "10000001" }));
  // Үлдэгдэлгүй туршилт — хасах үлдэгдлийг зөвшөөрнө; НХАТ-ын хувийг байгууллага өөрөө бичнэ.
  ok(await tool("update_pos_settings", { allowNegativeStock: true, cityTaxPercent: 2 }));
  ok(await tool("open_pos_shift", { cashAccount: "Касс", warehouseCode: "WH1" }, "post"));

  const sold = ok(
    await tool(
      "create_pos_sale",
      {
        lines: [
          { itemCode: "BEER", quantity: 2 },
          { itemCode: "BREAD", quantity: 1 },
        ],
        payments: [{ method: "CASH", amount: 25_700 }],
      },
      "post"
    )
  );
  assert.match(sold.resultText, /НХАТ 400/);

  const sale = await db.query.posSales.findFirst({
    where: and(eq(posSales.organizationId, orgId), eq(posSales.isReturn, false)),
  });
  assert.ok(sale);
  // 2 × 11,200 = 22,400 → цэвэр 20,000 + НӨАТ 2,000 + НХАТ 400; талх 3,300 → 3,000 + 300
  assert.equal(Number(sale.total), 25_700);
  assert.equal(Number(sale.cityTaxAmount), 400);
  assert.equal(Number(sale.vatAmount), 2_300);
  assert.equal(Number(sale.netAmount), 23_000);
  const lines = await db.select().from(posSaleLines).where(eq(posSaleLines.saleId, sale.id));
  const beer = lines.find((line) => line.description === "Пиво");
  const bread = lines.find((line) => line.description === "Талх");
  assert.equal(Number(beer?.cityTaxAmount), 400);
  assert.equal(Number(bread?.cityTaxAmount), 0);

  const saleGl = await voucherLines(`pos-sale:${sale.id}`);
  assert.equal(saleGl.byAccount("31440000", "credit"), 400);
  assert.equal(saleGl.byAccount("31410000", "credit"), 2_300);

  // Буцаалт — нэг пиво: НХАТ 200 Дт, НӨАТ 1,000 Дт
  ok(await tool("return_pos_sale", { sale: sale.documentNo, lines: [{ itemCode: "BEER", quantity: 1 }], reason: "туршилт" }, "post"));
  const ret = await db.query.posSales.findFirst({
    where: and(eq(posSales.organizationId, orgId), eq(posSales.isReturn, true)),
  });
  assert.ok(ret);
  assert.equal(Number(ret.cityTaxAmount), 200);
  assert.equal(Number(ret.total), 11_200);
  const returnGl = await voucherLines(`pos-return:${ret.id}`);
  assert.equal(returnGl.byAccount("31440000", "debit"), 200);
  assert.equal(returnGl.byAccount("31410000", "debit"), 1_000);

  // НХАТ 0 бол бодохгүй — хувь ЗОХИОХГҮЙ
  ok(await tool("update_pos_settings", { cityTaxPercent: 0 }));
  ok(await tool("create_pos_sale", { lines: [{ itemCode: "BEER", quantity: 1 }], payments: [{ method: "CASH", amount: 11_200 }] }, "post"));
  const sales = await db.query.posSales.findMany({
    where: and(eq(posSales.organizationId, orgId), eq(posSales.isReturn, false)),
    orderBy: (row, { desc }) => [desc(row.soldAt)],
  });
  assert.equal(Number(sales[0].cityTaxAmount), 0);
  assert.equal(Number(sales[0].vatAmount), 1_018.18);
});

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

// Бараа материалын МАСТЕР ДАТА — integration тест (DATABASE_URL шаарддаг).
//  • Олон түвшинтэй ангилал: эцэг оноох, цикл/гүн хориг, устгах хориг,
//    түвшний нэр (хамгийн багадаа 1, ашиглагдаж буй гүнээс доош хасахгүй)
//  • Барааны дэлгэрэнгүй карт: баркодын төрөл, брэнд … хадгалагдана
//  • Харилцагчийн ДИНАМИК төрөл: нэмэх, харилцагчид оноох, систем төрөл
//    устгагдахгүй, хэрэглэгдэж буй төрөл устгагдахгүй
// Түр байгууллага үүсгэж, төгсгөлд нь устгана (байгууллагын cascade устгал
// ангиллын модтой ч ажиллахыг давхар батална).

import "./helpers/load-env";

import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчин
}

import { runAsOrg } from "../lib/auth";
import { db } from "../lib/db";
import {
  counterparties,
  inventoryCategories,
  inventoryItems,
  memberships,
  organizations,
  users,
} from "../lib/db/schema";
import {
  createInventoryCategory,
  createInventoryItem,
  deleteInventoryCategory,
  saveInventoryCategoryLevels,
  updateInventoryCategory,
  updateInventoryItem,
} from "../lib/actions/inventory";
import {
  createCounterparty,
  deleteCounterpartyEntityKind,
  saveCounterpartyEntityKind,
  updateCounterparty,
} from "../lib/actions/arap";
import { loadCategoryLevels, loadInventoryBase } from "../lib/inventory/load-data";
import { loadArApCounterparties } from "../lib/arap/load-data";
import { loadEbarimtReadiness } from "../lib/ebarimt/queue";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);

async function categoryId(code: string) {
  const row = await db.query.inventoryCategories.findFirst({
    where: (c, { and, eq: eqOp }) => and(eqOp(c.organizationId, orgId), eqOp(c.code, code)),
    columns: { id: true },
  });
  assert.ok(row, `${code} ангилал олдох ёстой`);
  return row.id;
}

test("бэлтгэл — түр байгууллага", { skip: !DB_READY }, async () => {
  const [user] = await db
    .insert(users)
    .values({ name: `inv-md-${STAMP}`, email: `inv-md-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `Inventory MD Test ${STAMP}` })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  userId = user.id;
  orgId = org.id;
});

test("ангилал: 3 түвшний мод, цикл ба гүний хориг", { skip: !DB_READY }, async () => {
  assert.deepEqual(await loadCategoryLevels(orgId), ["Ерөнхий ангилал", "Үндсэн ангилал", "Дэд ангилал"]);

  assert.equal((await asOrg(() => createInventoryCategory({ code: "FOOD", name: "Хүнс" }))).error, undefined);
  const food = await categoryId("FOOD");
  assert.equal(
    (await asOrg(() => createInventoryCategory({ code: "DAIRY", name: "Сүү", parentId: food, ebarimtClassificationCode: null }))).error,
    undefined
  );
  const dairy = await categoryId("DAIRY");
  assert.equal(
    (await asOrg(() => createInventoryCategory({ code: "TARAG", name: "Тараг", parentId: dairy }))).error,
    undefined
  );
  const tarag = await categoryId("TARAG");

  // 4-р түвшин (3 түвшинтэй модонд) → хориг
  const tooDeep = await asOrg(() => createInventoryCategory({ code: "X", name: "X", parentId: tarag }));
  assert.match(tooDeep.error ?? "", /4-р түвшин/);

  // Цикл: Хүнсийг Тарагийн доор зөөх → хориг
  const cycle = await asOrg(() => updateInventoryCategory(food, { name: "Хүнс", parentId: tarag }));
  assert.match(cycle.error ?? "", /цикл/);

  // Давхардсан код
  const dup = await asOrg(() => createInventoryCategory({ code: "FOOD", name: "Дахин" }));
  assert.match(dup.error ?? "", /бүртгэгдсэн/);
});

test("түвшин: ашиглагдаж буй гүнээс доош хасахгүй, нэмбэл гүн мод үүснэ", { skip: !DB_READY }, async () => {
  const shrink = await asOrg(() => saveInventoryCategoryLevels(["Нэг", "Хоёр"]));
  assert.match(shrink.error ?? "", /3-р түвшний/);
  const empty = await asOrg(() => saveInventoryCategoryLevels([]));
  assert.match(empty.error ?? "", /хамгийн багадаа 1/i);

  assert.equal(
    (await asOrg(() => saveInventoryCategoryLevels(["Салбар", "Бүлэг", "Дэд бүлэг", "Төрөл"]))).error,
    undefined
  );
  assert.deepEqual(await loadCategoryLevels(orgId), ["Салбар", "Бүлэг", "Дэд бүлэг", "Төрөл"]);
  const tarag = await categoryId("TARAG");
  assert.equal(
    (await asOrg(() => createInventoryCategory({ code: "TARAG-F", name: "Жимстэй", parentId: tarag }))).error,
    undefined
  );
});

test("бараа: дэлгэрэнгүй карт + eBarimt ангилал эцэг ангиллаас өвлөнө", { skip: !DB_READY }, async () => {
  const food = await categoryId("FOOD");
  await asOrg(() => updateInventoryCategory(food, { name: "Хүнс", ebarimtClassificationCode: "2399990" }));

  const created = await asOrg(() =>
    createInventoryItem({
      code: "T-001",
      name: "Тараг 500мл",
      unit: "ш",
      categoryCode: "TARAG-F",
      barcode: "8650000000017",
      barcodeType: "gs1",
      brand: "Сүү ХК",
      manufacturer: "Сүү ХК",
      originCountry: "Монгол",
      description: "Хөргөгчинд хадгална",
    })
  );
  assert.equal(created.error, undefined);
  const { itemViews } = await loadInventoryBase(orgId);
  const item = itemViews.find((entry) => entry.code === "T-001")!;
  assert.equal(item.barcodeType, "GS1");
  assert.equal(item.brand, "Сүү ХК");
  assert.equal(item.originCountry, "Монгол");
  assert.equal(item.description, "Хөргөгчинд хадгална");

  // Буруу баркодын төрөл
  const bad = await asOrg(() => updateInventoryItem(item.id, { name: item.name, unit: item.unit, barcodeType: "EAN13" }));
  assert.match(bad.error ?? "", /Баркодын төрөл/);

  // eBarimt: барааны код хоосон → Жимстэй → Тараг → Сүү → Хүнс (2399990) өвлөнө
  const readiness = await loadEbarimtReadiness(orgId);
  assert.equal(readiness.items.count, 0, `ангиллаас өвлөх ёстой: ${readiness.problems.join("; ")}`);
});

test("ангилал устгах: хүүхэд/бараатай бол хориг, хоосон нь устгагдана", { skip: !DB_READY }, async () => {
  const food = await categoryId("FOOD");
  const withChildren = await asOrg(() => deleteInventoryCategory(food));
  assert.match(withChildren.error ?? "", /дэд ангилал/);
  const leaf = await categoryId("TARAG-F");
  const withItem = await asOrg(() => deleteInventoryCategory(leaf));
  assert.match(withItem.error ?? "", /1 бараа/);

  await asOrg(() => createInventoryCategory({ code: "EMPTY", name: "Хоосон" }));
  const emptyId = await categoryId("EMPTY");
  assert.equal((await asOrg(() => deleteInventoryCategory(emptyId))).error, undefined);
});

test("харилцагчийн динамик төрөл: нэмэх, оноох, устгах хориг", { skip: !DB_READY }, async () => {
  const added = await asOrg(() =>
    saveCounterpartyEntityKind({ name: "Гадаадын иргэн", baseKind: "individual" })
  );
  assert.equal(added.error, undefined);
  const code = added.code!;
  assert.match(code, /^kind_\d+$/);

  const duplicate = await asOrg(() => saveCounterpartyEntityKind({ name: "гадаадын ИРГЭН", baseKind: "individual" }));
  assert.match(duplicate.error ?? "", /бүртгэгдсэн/);

  const cp = await asOrg(() =>
    createCounterparty({ name: `Жон Смит ${STAMP}`, counterpartyType: "customer", entityKind: code })
  );
  assert.equal(cp.error, undefined);
  const views = await loadArApCounterparties(orgId);
  const view = views.find((entry) => entry.id === cp.id)!;
  assert.equal(view.entityKind, code);
  assert.equal(view.entityKindName, "Гадаадын иргэн");
  assert.equal(view.entityKindBase, "individual");

  // Бүртгэлгүй төрөл → алдаа
  const unknown = await asOrg(() =>
    createCounterparty({ name: `Алга ${STAMP}`, counterpartyType: "customer", entityKind: "kind_999" })
  );
  assert.match(unknown.error ?? "", /бүртгэлд алга/);

  // Хэрэглэгдэж буй төрөл устгагдахгүй; систем төрөл устгагдахгүй
  assert.match((await asOrg(() => deleteCounterpartyEntityKind(code))).error ?? "", /устгах боломжгүй/);
  assert.match((await asOrg(() => deleteCounterpartyEntityKind("organization"))).error ?? "", /Системийн/);

  // Идэвхгүй болгосон төрлийг харилцагч хэвээр үлдээж засаж болно
  await asOrg(() => saveCounterpartyEntityKind({ code, name: "Гадаадын иргэн", baseKind: "individual", isActive: false }));
  const edited = await asOrg(() =>
    updateCounterparty(cp.id!, { name: `Жон Смит ${STAMP}`, counterpartyType: "customer", entityKind: code })
  );
  assert.equal(edited.error, undefined);
  // Харин ШИНЭ харилцагчид идэвхгүй төрөл оноохгүй
  const inactive = await asOrg(() =>
    createCounterparty({ name: `Шинэ ${STAMP}`, counterpartyType: "customer", entityKind: code })
  );
  assert.match(inactive.error ?? "", /идэвхгүй/);

  // Систем төрлийн нэр засагдана
  assert.equal(
    (await asOrg(() => saveCounterpartyEntityKind({ code: "individual", name: "Иргэн", baseKind: "individual" }))).error,
    undefined
  );
  const renamed = (await loadArApCounterparties(orgId)).find((entry) => entry.id === cp.id)!;
  assert.equal(renamed.entityKindName, "Гадаадын иргэн"); // нэмсэн төрлийн нэр хөндөгдөхгүй
});

test("цэвэрлэгээ — байгууллагын cascade устгал ангиллын модтой ч ажиллана", { skip: !DB_READY }, async () => {
  await db.delete(counterparties).where(eq(counterparties.organizationId, orgId));
  await db.delete(inventoryItems).where(eq(inventoryItems.organizationId, orgId));
  const before = await db.query.inventoryCategories.findMany({
    where: eq(inventoryCategories.organizationId, orgId),
    columns: { id: true },
  });
  assert.ok(before.length >= 4, "мод байх ёстой");
  await db.delete(organizations).where(eq(organizations.id, orgId));
  const after = await db.query.inventoryCategories.findMany({
    where: eq(inventoryCategories.organizationId, orgId),
    columns: { id: true },
  });
  assert.equal(after.length, 0);
  await db.delete(users).where(eq(users.id, userId));
});

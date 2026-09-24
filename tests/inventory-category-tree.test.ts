// Барааны ангиллын мод — ЦЭВЭР логикийн тест (DATABASE_URL ШААРДАХГҮЙ).

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CATEGORY_LEVEL_NAMES,
  ancestorCodes,
  buildCategoryTree,
  categoryDeleteBlocker,
  categoryDepth,
  categoryLevelName,
  categoryPathLabel,
  descendantCodes,
  effectiveCategoryClassification,
  maxTreeDepth,
  planCategoryLevels,
  resolveCategoryLevels,
  validateCategoryParent,
  type CategoryNode,
} from "../lib/inventory/category-tree";

const node = (
  id: string,
  code: string,
  name: string,
  parentId: string | null,
  ebarimtClassificationCode: string | null = null
): CategoryNode => ({ id, code, name, parentId, isActive: true, ebarimtClassificationCode });

// Хүнс → Сүүн бүтээгдэхүүн → Тараг ; Хүнс → Талх ; Ахуйн бараа (ганцаар)
const TREE: CategoryNode[] = [
  node("t", "TARAG", "Тараг", "s"),
  node("h", "FOOD", "Хүнс", null, "2399990"),
  node("s", "DAIRY", "Сүүн бүтээгдэхүүн", "h"),
  node("b", "BREAD", "Талх", "h", "2349100"),
  node("a", "HOME", "Ахуйн бараа", null),
];

test("түвшин: мөргүй бол default 3 түвшин", () => {
  assert.deepEqual(resolveCategoryLevels([]), [...DEFAULT_CATEGORY_LEVEL_NAMES]);
  assert.deepEqual(resolveCategoryLevels(null), [...DEFAULT_CATEGORY_LEVEL_NAMES]);
  assert.equal(categoryLevelName(1, DEFAULT_CATEGORY_LEVEL_NAMES), "Ерөнхий ангилал");
  assert.equal(categoryLevelName(3, DEFAULT_CATEGORY_LEVEL_NAMES), "Дэд ангилал");
  assert.equal(categoryLevelName(5, DEFAULT_CATEGORY_LEVEL_NAMES), "5-р түвшин");
});

test("түвшин: хадгалсан нэрс depth-ээр эрэмбэлэгдэнэ", () => {
  assert.deepEqual(
    resolveCategoryLevels([
      { depth: 2, name: "Бүлэг" },
      { depth: 1, name: "Салбар" },
    ]),
    ["Салбар", "Бүлэг"]
  );
});

test("түвшин хадгалах: хамгийн багадаа 1, хоосон/давхар нэр хориглоно", () => {
  assert.ok("error" in planCategoryLevels([], 0));
  assert.ok("error" in planCategoryLevels(["Нэг", " "], 0));
  assert.ok("error" in planCategoryLevels(["Нэг", "нэг"], 0));
  assert.deepEqual(planCategoryLevels([" Ганц "], 0), { names: ["Ганц"] });
});

test("түвшин хадгалах: ашиглагдаж буй гүнээс доош хасахгүй", () => {
  const result = planCategoryLevels(["Ерөнхий", "Үндсэн"], 3);
  assert.ok("error" in result);
  assert.match((result as { error: string }).error, /3-р түвшний/);
  assert.ok("names" in planCategoryLevels(["А", "Б", "В"], 3));
});

test("мод: DFS дараалал, гүн, зам", () => {
  const rows = buildCategoryTree(TREE);
  assert.deepEqual(
    rows.map((row) => `${row.depth}:${row.node.code}`),
    ["1:FOOD", "2:BREAD", "2:DAIRY", "3:TARAG", "1:HOME"]
  );
  const tarag = rows.find((row) => row.node.code === "TARAG")!;
  assert.equal(tarag.pathLabel, "Хүнс › Сүүн бүтээгдэхүүн › Тараг");
  assert.deepEqual(tarag.pathCodes, ["FOOD", "DAIRY", "TARAG"]);
  assert.equal(rows.find((row) => row.node.code === "FOOD")!.childCount, 2);
  assert.equal(maxTreeDepth(TREE), 3);
});

test("мод: алга эцэгтэй мөр эхний түвшинд гарна (гацахгүй)", () => {
  const rows = buildCategoryTree([node("x", "ORPHAN", "Өнчин", "missing")]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].depth, 1);
});

test("мод: цикл тасарна, мөр бүр НЭГ удаа гарна", () => {
  const cyclic = [node("p", "P", "P", "q"), node("q", "Q", "Q", "p")];
  const rows = buildCategoryTree(cyclic);
  assert.equal(rows.length, 2);
  assert.deepEqual(ancestorCodes("P", cyclic), ["P", "Q"]);
});

test("удамшил: өвөг ба удам", () => {
  assert.deepEqual(ancestorCodes("TARAG", TREE), ["TARAG", "DAIRY", "FOOD"]);
  assert.deepEqual([...descendantCodes("FOOD", TREE)].sort(), ["BREAD", "DAIRY", "FOOD", "TARAG"]);
  assert.deepEqual([...descendantCodes("HOME", TREE)], ["HOME"]);
  assert.deepEqual([...descendantCodes("UNKNOWN", TREE)], ["UNKNOWN"]);
  assert.deepEqual(ancestorCodes(null, TREE), []);
  assert.equal(categoryDepth("TARAG", TREE), 3);
  assert.equal(categoryDepth("NOPE", TREE), 0);
  assert.equal(categoryPathLabel("BREAD", TREE), "Хүнс › Талх");
});

test("eBarimt ангилал өвөг рүү өвлөгдөнө", () => {
  assert.equal(effectiveCategoryClassification("TARAG", TREE), "2399990"); // Хүнсээс
  assert.equal(effectiveCategoryClassification("BREAD", TREE), "2349100"); // өөрийнх
  assert.equal(effectiveCategoryClassification("HOME", TREE), null); // зохиохгүй
  assert.equal(effectiveCategoryClassification(null, TREE), null);
});

test("эцэг оноох: цикл, өөрийгөө, алга эцэг хориглоно", () => {
  assert.match(validateCategoryParent({ id: "h", parentId: "t", nodes: TREE, levelCount: 5 })!, /цикл/);
  assert.match(validateCategoryParent({ id: "h", parentId: "h", nodes: TREE, levelCount: 5 })!, /өөрийгөө/);
  assert.match(validateCategoryParent({ parentId: "zzz", nodes: TREE, levelCount: 5 })!, /олдсонгүй/);
  assert.equal(validateCategoryParent({ parentId: null, nodes: TREE, levelCount: 1 }), null);
});

test("эцэг оноох: түвшний тооноос гүн болохгүй (дэд модны өндрийг тооцно)", () => {
  // Шинэ ангилал Тараг-ийн доор = 4-р түвшин
  assert.match(validateCategoryParent({ parentId: "t", nodes: TREE, levelCount: 3 })!, /4-р түвшин/);
  assert.equal(validateCategoryParent({ parentId: "s", nodes: TREE, levelCount: 3 }), null);
  // Хүнсийг (3 өндөр) Ахуйн доор зөөвөл 4 болно
  assert.match(validateCategoryParent({ id: "h", parentId: "a", nodes: TREE, levelCount: 3 })!, /4-р түвшин/);
  assert.equal(validateCategoryParent({ id: "h", parentId: "a", nodes: TREE, levelCount: 4 }), null);
});

test("устгах: хүүхэд / бараа / дүрэмтэй бол хориглоно", () => {
  assert.equal(categoryDeleteBlocker({ childCount: 0, itemCount: 0 }), null);
  assert.match(categoryDeleteBlocker({ childCount: 2, itemCount: 0 })!, /2 дэд ангилал/);
  assert.match(categoryDeleteBlocker({ childCount: 0, itemCount: 5, ruleCount: 1 })!, /5 бараа, 1 хөнгөлөлтийн дүрэм/);
});

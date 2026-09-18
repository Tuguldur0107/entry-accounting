// S1/S6 компанийн сегментийн автомат бүрдүүлэлт — ЦЭВЭР тест (DB-гүй).
// Дүрэм: S1 = S6 (ижил код, ижил нэр), код тогтвортой, идемпотент.

import test from "node:test";
import assert from "node:assert/strict";

import {
  nextFreeCode,
  planCompanySegmentValues,
  type ExistingSegmentValue,
} from "../lib/gl/company-segments";
import {
  defaultValuesForSegment,
  hasSegmentDefaults,
  SEGMENT_DEFAULT_VALUES,
} from "../lib/constants/segment-defaults";
import { SEGMENT_DEFS } from "../lib/constants/standard-accounts";

const co = (id: string, name: string) => ({ organizationId: id, name });

function apply(
  existing: ExistingSegmentValue[],
  plan: ReturnType<typeof planCompanySegmentValues>
): ExistingSegmentValue[] {
  const rows = existing.map((row) => ({ ...row }));
  for (const update of plan.update) {
    const row = rows.find((r) => r.id === update.id)!;
    row.name = update.name;
    row.linkedOrganizationId = update.linkedOrganizationId;
  }
  for (const [index, create] of plan.create.entries())
    rows.push({ id: `new-${rows.length}-${index}`, ...create });
  return rows;
}

test("хоосон системд компани бүрд S1 ба S6 ижил код үүснэ", () => {
  const plan = planCompanySegmentValues({
    companies: [co("a", "Эх компани"), co("b", "Охин компани")],
    existing: [],
  });
  assert.equal(plan.update.length, 0);
  assert.equal(plan.create.length, 4);

  const codeOf = (segmentId: number, orgId: string) =>
    plan.create.find(
      (row) => row.segmentId === segmentId && row.linkedOrganizationId === orgId
    )!.code;

  assert.equal(codeOf(1, "a"), "101");
  assert.equal(codeOf(1, "b"), "102");
  // S6 нь S1-тэй ЯГ ижил код, ижил нэр
  assert.equal(codeOf(6, "a"), "101");
  assert.equal(codeOf(6, "b"), "102");
  assert.equal(
    plan.create.find((row) => row.segmentId === 6 && row.code === "102")!.name,
    "Охин компани"
  );
});

test("идемпотент — дахин ажиллуулахад юу ч өөрчлөгдөхгүй", () => {
  const companies = [co("a", "Эх компани"), co("b", "Охин компани")];
  const first = planCompanySegmentValues({ companies, existing: [] });
  const rows = apply([], first);
  const second = planCompanySegmentValues({ companies, existing: rows });
  assert.deepEqual(second, { create: [], update: [] });
});

test("нэр солиход НЭР шинэчлэгдэнэ, КОД хэвээр", () => {
  const rows = apply([], planCompanySegmentValues({
    companies: [co("a", "Хуучин нэр")],
    existing: [],
  }));
  const plan = planCompanySegmentValues({
    companies: [co("a", "Шинэ ХХК")],
    existing: rows,
  });
  assert.equal(plan.create.length, 0);
  assert.equal(plan.update.length, 2); // S1 + S6
  const after = apply(rows, plan);
  for (const row of after) {
    assert.equal(row.name, "Шинэ ХХК");
    assert.equal(row.code, "101");
  }
});

test("шинэ компани нэмэгдэхэд дараагийн сул код авна", () => {
  const rows = apply([], planCompanySegmentValues({
    companies: [co("a", "А компани")],
    existing: [],
  }));
  const plan = planCompanySegmentValues({
    companies: [co("a", "А компани"), co("b", "Б компани")],
    existing: rows,
  });
  assert.equal(plan.update.length, 0);
  assert.equal(plan.create.length, 2);
  assert.ok(plan.create.every((row) => row.code === "102"));
});

test("гараар бичсэн ижил нэртэй утга ӨВЛӨГДӨНӨ — давхардахгүй", () => {
  const existing: ExistingSegmentValue[] = [
    { id: "m1", segmentId: 1, code: "201", name: "Эх компани", linkedOrganizationId: null },
  ];
  const plan = planCompanySegmentValues({
    companies: [co("a", "Эх компани")],
    existing,
  });
  assert.deepEqual(plan.update, [
    { id: "m1", name: "Эх компани", linkedOrganizationId: "a" },
  ]);
  // S6-д тэр ЯГ кодоор шинээр үүснэ — хоёр сегмент ижил үлдэнэ
  assert.deepEqual(plan.create, [
    { segmentId: 6, code: "201", name: "Эх компани", linkedOrganizationId: "a" },
  ]);
});

test("гараар эзэлсэн код давхардахгүй", () => {
  const existing: ExistingSegmentValue[] = [
    { id: "m1", segmentId: 1, code: "101", name: "Салбар", linkedOrganizationId: null },
  ];
  const plan = planCompanySegmentValues({
    companies: [co("a", "Эх компани")],
    existing,
  });
  assert.ok(plan.create.every((row) => row.code === "102"));
});

test("nextFreeCode — 0-ээр эхлэхгүй, эзэлсэнийг алгасна", () => {
  assert.equal(nextFreeCode(new Set(), 3), "101");
  assert.equal(nextFreeCode(new Set(["101", "102"]), 3), "103");
  assert.equal(nextFreeCode(new Set(), 4), "1001");
});

test("стандарт утгын код нь сегментийн оронгийн тоотой таарна", () => {
  for (const [key, values] of Object.entries(SEGMENT_DEFAULT_VALUES)) {
    const def = SEGMENT_DEFS.find((d) => d.id === Number(key))!;
    const codes = new Set<string>();
    for (const value of values) {
      assert.equal(value.code.length, def.length, `S${def.id} ${value.code}`);
      assert.ok(!codes.has(value.code), `S${def.id} давхардсан код ${value.code}`);
      codes.add(value.code);
      assert.ok(value.name.trim().length > 0);
      // S9 нь модулийн үсэгт тэмдэг, бусад нь цифр
      if (def.id !== 9) assert.match(value.code, /^\d+$/);
    }
  }
});

test("S1/S6 стандарт жагсаалтгүй (компаниас автомат), S3 хоосон", () => {
  assert.deepEqual(defaultValuesForSegment(1), []);
  assert.deepEqual(defaultValuesForSegment(6), []);
  assert.deepEqual(defaultValuesForSegment(3), []);
  // Товч нь S1/S6-д ч харагдана (компаниас шинэчлэх)
  assert.equal(hasSegmentDefaults(1), true);
  assert.equal(hasSegmentDefaults(6), true);
  assert.equal(hasSegmentDefaults(3), false);
  assert.equal(hasSegmentDefaults(8), true);
  assert.ok(defaultValuesForSegment(2).every((value) => value.modules.length > 0));
});

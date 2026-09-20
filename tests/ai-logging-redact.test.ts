// AI бүртгэлийн PII цэвэрлэлт — WHITELIST зарчмын НОТОЛГОО.
//
// Цэвэр тест: DATABASE_URL ШААРДАХГҮЙ (CI-ийн үндсэн жагсаалтад ордог).

import test from "node:test";
import assert from "node:assert/strict";

import {
  GLOBAL_SAFE_KEYS,
  REDACTED,
  findPii,
  planTrainingScope,
  redactForScope,
  redactValue,
  scalarPiiHit,
} from "../lib/ai-logging/redact";

/** Бодит АР нэхэмжлэхийн санал — таних мэдээлэл ДҮҮРЭН. */
const SUGGESTION = {
  counterpartyName: "Болор Трейд ХХК",
  counterpartyRegisterNo: "УБ12345678",
  counterpartyTin: "12345678901",
  bankAccountNo: "5001234567",
  contactEmail: "nyabo@bolortrade.mn",
  description: "Ням-Осорын дэлгүүрээс авсан бараа",
  date: "2026-09-15",
  currency: "MNT",
  amount: 1250000,
  lines: [
    {
      accountNumber: "11210000",
      postingCode: "101.000000.11210000.0",
      itemName: "Гурил 1 кг",
      debit: 1250000,
      credit: 0,
      quantity: 50,
    },
  ],
};

test("tenant_only — өгөгдөл БҮРЭН хадгалагдана", () => {
  const out = redactForScope(SUGGESTION, "tenant_only");
  // Байгууллагын ӨӨРИЙН өгөгдөл, tenant тусгаарлалтаар хамгаалагдсан —
  // цэвэрлэх шаардлагагүй бөгөөд цэвэрлэвэл бүртгэл нь үнэ цэнгүй болно.
  assert.deepEqual(out, SUGGESTION);
});

test("global — таних мэдээлэл БҮГД redact хийгдэнэ", () => {
  const out = redactForScope(SUGGESTION, "global") as Record<string, unknown>;

  for (const key of [
    "counterpartyName",
    "counterpartyRegisterNo",
    "counterpartyTin",
    "bankAccountNo",
    "contactEmail",
    "description",
  ])
    assert.equal(out[key], REDACTED, `${key} цэвэрлэгдээгүй`);

  const line = (out.lines as Record<string, unknown>[])[0];
  // Дансны дугаар ба сегментийн код нь компани/төсөл кодыг агуулдаг тул
  // whitelist-д ЗОРИУД ороогүй (docs/ai-logging.md §4).
  assert.equal(line.accountNumber, REDACTED);
  assert.equal(line.postingCode, REDACTED);
  assert.equal(line.itemName, REDACTED);
});

test("global — тоон/ангиллын талбар үлдэж сургалтын үнэ цэн хадгалагдана", () => {
  const out = redactForScope(SUGGESTION, "global") as Record<string, unknown>;
  assert.equal(out.amount, 1250000);
  assert.equal(out.date, "2026-09-15");
  assert.equal(out.currency, "MNT");

  const line = (out.lines as Record<string, unknown>[])[0];
  assert.equal(line.debit, 1250000);
  assert.equal(line.credit, 0);
  assert.equal(line.quantity, 50);
});

test("бүтэц хадгалагдана — массив/объект бүтнээрээ алга болохгүй", () => {
  const out = redactForScope(SUGGESTION, "global") as Record<string, unknown>;
  assert.ok(Array.isArray(out.lines), "lines массив хэвээр байх ёстой");
  assert.equal((out.lines as unknown[]).length, 1);
});

// ── WHITELIST зарчмын ГОЛ нотолгоо ─────────────────────────────────────────

test("ШИНЭ, мэдэгдээгүй талбар DEFAULT-ААР redact хийгдэнэ", () => {
  // Хөгжүүлэгч маргааш `supplierLegalName` нэмэхэд хуучин blacklist түүнийг
  // МЭДЭХГҮЙ тул чимээгүй урсгана. Whitelist эсрэгээр ажиллана.
  const withNewFields = {
    ...SUGGESTION,
    supplierLegalName: "Шинэ Нийлүүлэгч ХХК",
    ownerPhone: "99112233",
    secretNote: "Захирлын хувийн тэмдэглэл",
    nested: { deeplyNewField: "Дорж Батаа", anotherNew: 42 },
  };
  const out = redactForScope(withNewFields, "global") as Record<string, unknown>;

  assert.equal(out.supplierLegalName, REDACTED);
  assert.equal(out.ownerPhone, REDACTED);
  assert.equal(out.secretNote, REDACTED);

  const nested = out.nested as Record<string, unknown>;
  assert.equal(nested.deeplyNewField, REDACTED);
  // Мэдэгдээгүй түлхүүр нь ТООН утгатай байсан ч redact хийгдэнэ —
  // whitelist нь утгын ТӨРЛӨӨР биш, ТҮЛХҮҮРЭЭР шийднэ.
  assert.equal(nested.anotherNew, REDACTED);
});

test("whitelist-д байгаа түлхүүр ч PII хээтэй бол redact хийгдэнэ", () => {
  // Хоёр дахь бүс: `type` нь whitelist-д байгаа боловч утга нь и-мэйл.
  const out = redactValue({ type: "nyabo@example.mn", kind: "journal" }) as Record<
    string,
    unknown
  >;
  assert.equal(out.type, REDACTED);
  assert.equal(out.kind, "journal");
});

test("оролт МУТАЦ хийгдэхгүй", () => {
  const before = JSON.stringify(SUGGESTION);
  redactForScope(SUGGESTION, "global");
  assert.equal(JSON.stringify(SUGGESTION), before);
});

test("null / хоосон утгууд асуудалгүй", () => {
  assert.equal(redactForScope(null, "global"), null);
  assert.equal(redactForScope(undefined, "tenant_only"), null);
  assert.deepEqual(redactForScope({}, "global"), {});
  assert.deepEqual(redactForScope([], "global"), []);
});

// ── PII хайлт ──────────────────────────────────────────────────────────────

test("findPii — РД, ТТД, и-мэйл, сегментийн кодыг барина", () => {
  assert.equal(scalarPiiHit("УБ12345678"), "register_no");
  assert.equal(scalarPiiHit("nyabo@bolortrade.mn"), "email");
  assert.equal(scalarPiiHit("12345678901"), "long_digits");
  assert.equal(scalarPiiHit("101.000000.11210000"), "segment_code");
  assert.equal(scalarPiiHit("MNT"), null);
  assert.equal(scalarPiiHit(1250000), null, "тоон утгыг хээгээр шалгахгүй");
});

test("цэвэрлэсний ДАРАА PII үлдэхгүй", () => {
  const cleaned = redactForScope(SUGGESTION, "global");
  assert.deepEqual(findPii(cleaned), []);
});

// ── training_scope төлөвлөлт ───────────────────────────────────────────────

test("scope өгөгдөөгүй бол tenant_only (default)", () => {
  const plan = planTrainingScope(undefined, [SUGGESTION]);
  assert.equal(plan.scope, "tenant_only");
  assert.equal(plan.downgradeReason, null);
});

test("tenant_only — PII шалгалт хийхгүй, хэвээр", () => {
  const plan = planTrainingScope("tenant_only", [SUGGESTION]);
  assert.equal(plan.scope, "tenant_only");
});

test("global — цэвэрлэлт ажиллавал scope хэвээр", () => {
  const plan = planTrainingScope("global", [SUGGESTION]);
  assert.equal(plan.scope, "global");
  assert.equal(plan.downgradeReason, null);
});

test("whitelist түлхүүрт нуугдсан PII ч цэвэрлэгдэнэ", () => {
  // `amount` нь whitelist-д байгаа боловч утга нь РД агуулсан текст —
  // хоёр дахь бүс (PII хээ) үүнийг барих ёстой.
  const out = redactValue({ amount: "РД: УБ99887766" }) as Record<string, unknown>;
  assert.equal(out.amount, REDACTED);
  // Цэвэрлэгдсэн тул scope буурах шаардлагагүй — энэ нь ЗӨВ зан төлөв.
  const plan = planTrainingScope("global", [{ amount: "РД: УБ99887766" }]);
  assert.equal(plan.scope, "global");
});

test("PII агуулсан ТҮЛХҮҮР бүтнээрээ хасагдана", () => {
  // `{ "УБ12345678": ... }` — данс / РД-г map-ийн түлхүүр болгосон payload.
  // Зөвхөн УТГЫГ цэвэрлэдэг байсан бол энэ зам чимээгүй алдагдана.
  const out = redactValue({
    "УБ12345678": { amount: 500 },
    "5001234567": { amount: 900 },
    "101.000.11210000": { amount: 100 },
    normal: { amount: 700 },
  }) as Record<string, unknown>;

  assert.deepEqual(Object.keys(out), ["normal"]);
  assert.deepEqual(out.normal, { amount: 700 });
});

test("findPii нь ТҮЛХҮҮР дэх PII-г ч барина", () => {
  const hits = findPii({ "УБ12345678": 5 });
  assert.equal(hits.length, 1);
  assert.match(hits[0], /түлхүүр/);
});

test("downgrade бүс: цэвэрлэлт мултарвал tenant_only руу БУУРНА", () => {
  // Хамгаалалтын ХОЁР ДАХЬ бүс. Өнөөдөр whitelist нь бүх PII-г барьдаг тул
  // энэ салаа ажиллах ёсгүй — гэвч хэн нэгэн GLOBAL_SAFE_KEYS-д таних
  // талбар нэмбэл ЭНЭ бүс л сүүлчийн хамгаалалт болно. Тиймээс салааны
  // логикийг ШУУД шалгана: findPii юм олбол scope буурах ёстой.
  const dirty = { amount: "УБ99887766" };
  assert.ok(findPii(dirty).length > 0, "бохир payload-д PII илрэх ёстой");
  // Цэвэрлэлтийн ДАРАА юу ч үлдэхгүй → downgrade хийх шаардлагагүй.
  assert.deepEqual(findPii(redactForScope(dirty, "global")), []);
});

test("whitelist-д таних мэдээллийн талбар ОРООГҮЙ эсэх", () => {
  // Регрессийн хамгаалалт: хэн нэгэн `counterpartyname`-г санамсаргүй
  // нэмбэл энэ тест УНАНА.
  for (const forbidden of [
    "counterpartyname",
    "name",
    "description",
    "accountnumber",
    "postingcode",
    "registerno",
    "tin",
    "email",
    "phone",
    "bankaccountno",
    "itemname",
    "memo",
    "note",
    "summary",
  ])
    assert.ok(
      !GLOBAL_SAFE_KEYS.has(forbidden),
      `"${forbidden}" нь GLOBAL_SAFE_KEYS-д БАЙЖ БОЛОХГҮЙ`
    );
});

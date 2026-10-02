import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ETAX_ACTIVE_STATUSES,
  ETAX_FORMS,
  ETAX_STATUS_LABELS,
  ETAX_SUBMISSION_STATUSES,
  isEtaxFormKey,
} from "../lib/itc/etax/constants";
import {
  ETAX_TRANSITIONS,
  EtaxError,
  assertTransition,
  buildVatSnapshot,
  canTransition,
  isPostingTransition,
  normalizeTaxReference,
  requiresTaxReference,
  snapshotAmountsDiffer,
  validateVatSnapshot,
  type EtaxVatSnapshot,
} from "../lib/itc/etax/submission";
import type { VatReturnSummary } from "../lib/vat/return";

// eTax (docs/dev/etax.md) ЦЭВЭР хэсэг: snapshot нь бодолтын хуулбар (дүн зохиохгүй),
// шалгалт уялдааг л барина, төлөв зөвхөн ирмэгээр шилжинэ.

const summary: VatReturnSummary = {
  periodCode: "2026-09",
  outputVat: 1_250_000,
  inputVat: 800_000,
  carriedInVat: 50_000,
  payableVat: 400_000,
  refundableVat: 0,
  deadline: "2026-10-10",
  outputLineCount: 12,
  inputLineCount: 7,
};
const settings = { outputVatAccountNumber: "31410000", inputVatAccountNumber: "13620000", vatRatePercent: 10 };
const taxpayer = { name: "Хос Хас Технологи ХХК", registerNo: "6543210", vatPayerNo: null };

function snapshot(overrides: Partial<EtaxVatSnapshot["amounts"]> = {}, extra: Partial<EtaxVatSnapshot> = {}): EtaxVatSnapshot {
  const base = buildVatSnapshot({ summary, settings, taxpayer, computedAt: new Date("2026-10-02T03:00:00Z") });
  return { ...base, ...extra, amounts: { ...base.amounts, ...overrides } };
}

test("buildVatSnapshot — бодолтын дүнг хуулна, маягт ТТ-03А, толгой цэвэрлэгдэнэ", () => {
  const snap = buildVatSnapshot({
    summary,
    settings,
    taxpayer: { name: "  Хос Хас  ", registerNo: " 6543210 ", vatPayerNo: "" },
    settlementVoucherId: "v1",
    computedAt: new Date("2026-10-02T03:00:00Z"),
  });
  assert.equal(snap.form, "vat");
  assert.equal(snap.formCode, ETAX_FORMS.vat.code);
  assert.equal(snap.periodCode, "2026-09");
  assert.deepEqual(snap.amounts, { outputVat: 1_250_000, inputVat: 800_000, carriedInVat: 50_000, payableVat: 400_000, refundableVat: 0 });
  assert.deepEqual(snap.taxpayer, { name: "Хос Хас", registerNo: "6543210", vatPayerNo: null });
  assert.equal(snap.source.settlementVoucherId, "v1");
  assert.equal(snap.deadline, "2026-10-10");
  assert.equal(snap.computedAt, "2026-10-02T03:00:00.000Z");
});

test("validateVatSnapshot — зөв тайлан алдаагүй; хугацаа дотор анхааруулгагүй", () => {
  const result = validateVatSnapshot(snapshot(), "2026-10-05");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.checkedOn, "2026-10-05");
});

test("validateVatSnapshot — толгой дутуу, регистр буруу, сөрөг дүн → алдаа", () => {
  const noHeader = validateVatSnapshot(snapshot({}, { taxpayer: { name: "", registerNo: null, vatPayerNo: null } }), "2026-10-05");
  assert.ok(noHeader.errors.some((e) => e.includes("Компанийн нэр")));
  assert.ok(noHeader.errors.some((e) => e.includes("регистрийн дугаар хоосон")));
  const badReg = validateVatSnapshot(snapshot({}, { taxpayer: { ...taxpayer, registerNo: "AB12" } }), "2026-10-05");
  assert.ok(badReg.errors.some((e) => e.includes("7 оронтой")));
  const negative = validateVatSnapshot(snapshot({ inputVat: -1 }), "2026-10-05");
  assert.ok(negative.errors.some((e) => e.includes("Оролтын НӨАТ сөрөг")));
});

test("validateVatSnapshot — төлөх/шилжүүлэх уялдаа зөрвөл алдаа (дүн дахин бодогдохгүй)", () => {
  const wrongPayable = validateVatSnapshot(snapshot({ payableVat: 399_000 }), "2026-10-05");
  assert.ok(wrongPayable.errors.some((e) => e.includes("Төлөх НӨАТ")));
  const both = validateVatSnapshot(snapshot({ payableVat: 400_000, refundableVat: 10 }), "2026-10-05");
  assert.ok(both.errors.length > 0);
  // Буцаан авах сар: оролт > гаралт + кредит → төлөх 0, шилжүүлэх эерэг
  const refund = snapshot({ outputVat: 100, inputVat: 300, carriedInVat: 0, payableVat: 0, refundableVat: 200 });
  assert.deepEqual(validateVatSnapshot(refund, "2026-10-05").errors, []);
  // 1 мөнгөний бөөрөнхийлөл тэвчээр дотор
  assert.deepEqual(validateVatSnapshot(snapshot({ payableVat: 400_000.004 }), "2026-10-05").errors, []);
});

test("validateVatSnapshot — хоцорсон ба тэг тайлан нь АНХААРУУЛГА (хориг биш)", () => {
  const late = validateVatSnapshot(snapshot(), "2026-10-11");
  assert.deepEqual(late.errors, []);
  assert.ok(late.warnings.some((w) => w.includes("2026-10-10") && w.includes("хоцорсон")));
  const zero = snapshot(
    { outputVat: 0, inputVat: 0, carriedInVat: 0, payableVat: 0, refundableVat: 0 },
    { counts: { outputLines: 0, inputLines: 0 } }
  );
  const result = validateVatSnapshot(zero, "2026-10-05");
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((w) => w.includes("тэг тайлан")));
});

test("snapshotAmountsDiffer — дүн зөрвөл хуучирсан, 1 мөнгөний дотор зөрөөгүй", () => {
  assert.equal(snapshotAmountsDiffer(snapshot(), snapshot()), false);
  assert.equal(snapshotAmountsDiffer(snapshot(), snapshot({ outputVat: 1_250_000.004 })), false);
  assert.equal(snapshotAmountsDiffer(snapshot(), snapshot({ outputVat: 1_250_001 })), true);
});

test("төлөвийн машин — зөвхөн зөвшөөрөгдсөн ирмэг; эцсийн төлвөөс гарахгүй", () => {
  assert.equal(canTransition("draft", "ready"), true);
  assert.equal(canTransition("draft", "submitted"), false); // хүний хяналтгүй тушаахгүй
  assert.equal(canTransition("ready", "submitted"), true);
  assert.equal(canTransition("ready", "draft"), true); // дахин бодох
  assert.equal(canTransition("submitted", "accepted"), true);
  assert.equal(canTransition("submitted", "rejected"), true);
  assert.equal(canTransition("submitted", "draft"), false);
  for (const terminal of ["accepted", "rejected", "cancelled"] as const) {
    assert.deepEqual(ETAX_TRANSITIONS[terminal], []);
    for (const to of ETAX_SUBMISSION_STATUSES) assert.equal(canTransition(terminal, to), false);
  }
  assert.throws(() => assertTransition("accepted", "draft"), (e: unknown) => e instanceof EtaxError && /ETAX_STATE/.test(e.message));
  assert.doesNotThrow(() => assertTransition("draft", "cancelled"));
});

test("батлах шинжтэй шилжилт ба ТЕГ-ийн дугаарын шаардлага", () => {
  assert.equal(isPostingTransition("submitted"), true);
  assert.equal(isPostingTransition("accepted"), true);
  assert.equal(isPostingTransition("rejected"), true);
  assert.equal(isPostingTransition("ready"), false);
  assert.equal(isPostingTransition("cancelled"), false);
  assert.equal(requiresTaxReference("submitted"), true);
  assert.equal(requiresTaxReference("accepted"), false);
  assert.equal(normalizeTaxReference("  TT-2026-0001 "), "TT-2026-0001");
  assert.equal(normalizeTaxReference(""), null);
  assert.throws(() => normalizeTaxReference("x".repeat(65)), /64/);
});

test("constants — төлөв бүр монгол шошготой, амьд төлөв эцсийн rejected/cancelled-ийг хамрахгүй", () => {
  for (const status of ETAX_SUBMISSION_STATUSES) assert.ok(ETAX_STATUS_LABELS[status].length > 0);
  assert.equal(ETAX_ACTIVE_STATUSES.includes("rejected"), false);
  assert.equal(ETAX_ACTIVE_STATUSES.includes("cancelled"), false);
  assert.equal(ETAX_ACTIVE_STATUSES.includes("accepted"), true);
  assert.equal(isEtaxFormKey("vat"), true);
  assert.equal(isEtaxFormKey("cit"), false);
});

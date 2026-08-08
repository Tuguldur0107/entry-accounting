import test from "node:test";
import assert from "node:assert/strict";

import {
  applyInclusiveVatToLines,
  computeVatReturn,
  splitVat,
  vatDeadlineOf,
  type VatJournalLine,
} from "../lib/vat/return";

// ── splitVat ────────────────────────────────────────────────────────────────

test("splitVat exclusive: 1,000,000 → НӨАТ 100,000, нийт 1,100,000", () => {
  const result = splitVat(1_000_000, "exclusive");
  assert.equal(result.net, 1_000_000);
  assert.equal(result.vat, 100_000);
  assert.equal(result.gross, 1_100_000);
});

test("splitVat inclusive: 1,100,000 → НӨАТ 100,000, цэвэр 1,000,000", () => {
  const result = splitVat(1_100_000, "inclusive");
  assert.equal(result.net, 1_000_000);
  assert.equal(result.vat, 100_000);
  assert.equal(result.gross, 1_100_000);
});

test("splitVat: 0 болон сөрөг дүн алдаа шидна", () => {
  assert.throws(() => splitVat(0, "exclusive"));
  assert.throws(() => splitVat(-100, "inclusive"));
});

// ── applyInclusiveVatToLines ────────────────────────────────────────────────

test("inclusive мөрүүд: НӨАТ ялгарсны дараа нийлбэр хадгалагдана", () => {
  const { adjusted, vat } = applyInclusiveVatToLines([550_000, 550_000]);
  assert.equal(vat, 100_000);
  const sum = adjusted.reduce((s, a) => s + a, 0);
  assert.equal(Math.round((sum + vat) * 100) / 100, 1_100_000);
});

test("inclusive мөрүүд: бөөрөнхийллийн зөрүү хамгийн том мөрөнд шингэнэ", () => {
  // 3 тэгш бус мөр — таслалын үлдэгдэл үүсэх дүнгүүд.
  const lines = [333_333.33, 333_333.33, 433_333.34];
  const { adjusted, vat } = applyInclusiveVatToLines(lines);
  const sum = adjusted.reduce((s, a) => s + a, 0);
  const gross = lines.reduce((s, a) => s + a, 0);
  assert.equal(Math.round((sum + vat) * 100) / 100, Math.round(gross * 100) / 100);
});

// ── computeVatReturn ────────────────────────────────────────────────────────

const OUT = "31410000";
const IN = "13620000";

function line(
  mainAccount: string,
  debit: number,
  credit: number,
  date = "2026-07-15",
  status = "posted"
): VatJournalLine {
  return { mainAccount, debit, credit, date, status };
}

test("сарын тайлан: гаралт Cr−Dr, оролт Dr−Cr, төлөх = зөрүү", () => {
  const summary = computeVatReturn(
    [
      line(OUT, 0, 300_000), // борлуулалтын НӨАТ
      line(OUT, 0, 200_000),
      line(IN, 150_000, 0), // худалдан авалтын НӨАТ
      line("51100000", 0, 5_000_000), // хамааралгүй данс — тоологдохгүй
    ],
    { periodCode: "2026-07", outputVatAccount: OUT, inputVatAccount: IN }
  );
  assert.equal(summary.outputVat, 500_000);
  assert.equal(summary.inputVat, 150_000);
  assert.equal(summary.payableVat, 350_000);
  assert.equal(summary.refundableVat, 0);
  assert.equal(summary.deadline, "2026-08-10");
});

test("оролт нь гаралтаас их бол буцаан авах дүн гарна", () => {
  const summary = computeVatReturn(
    [line(OUT, 0, 100_000), line(IN, 400_000, 0)],
    { periodCode: "2026-07", outputVatAccount: OUT, inputVatAccount: IN }
  );
  assert.equal(summary.payableVat, 0);
  assert.equal(summary.refundableVat, 300_000);
});

test("өөр сар болон draft мөр тоологдохгүй; reversed хос цэвэрлэгдэнэ", () => {
  const summary = computeVatReturn(
    [
      line(OUT, 0, 100_000, "2026-06-30"), // өмнөх сар
      line(OUT, 0, 100_000, "2026-07-01", "draft"), // ноорог
      line(OUT, 0, 100_000, "2026-07-10", "reversed"), // эх
      line(OUT, 100_000, 0, "2026-07-10", "posted"), // буцаалт (сторно)
      line(OUT, 0, 250_000, "2026-07-20"),
    ],
    { periodCode: "2026-07", outputVatAccount: OUT, inputVatAccount: IN }
  );
  assert.equal(summary.outputVat, 250_000);
});

test("vatDeadlineOf: 12-р сарын тайлан дараа оны 1-р сарын 10", () => {
  assert.equal(vatDeadlineOf("2026-12"), "2027-01-10");
  assert.equal(vatDeadlineOf("2026-01"), "2026-02-10");
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTaxLedger,
  checkTaxInvoice,
  isTaxCheckProblem,
  isTaxSyncDue,
  summarizeTaxChecks,
  taxSyncDays,
  type EntryInvoiceInput,
} from "../lib/ebarimt/tax-reconcile";
import { tpiHasMorePages, tpiPageWindow } from "../lib/itc/tpi";

const INV = "000006596177000260929000000123887";
const NOW = new Date("2026-10-10T00:00:00Z");
const OLD = new Date("2026-10-01T00:00:00Z");
const coverage = { syncFrom: "2026-09-01", now: NOW };

function entry(partial: Partial<EntryInvoiceInput> = {}): EntryInvoiceInput {
  return {
    ddtd: INV,
    invoiceDate: "2026-09-29",
    invoiceSentAt: OLD,
    registeredTotal: 1_500_000,
    entryTotal: 1_500_000,
    entryPaid: 500_000,
    reportedPaid: 500_000,
    lastReportedAt: OLD,
    ...partial,
  };
}

const ledger = (paid: number[] = [500_000], total = 1_500_000) =>
  buildTaxLedger([
    { ddtd: INV, isInvoice: true, parentDdtd: null, total },
    ...paid.map((amount, index) => ({ ddtd: `PAY${index}`, isInvoice: false, parentDdtd: INV, total: amount })),
  ]);

test("buildTaxLedger: нэхэмжлэх − Σ invoiceId-тай баримт; давхардсан ДДТД нэг л удаа", () => {
  const result = buildTaxLedger([
    { ddtd: INV, isInvoice: true, parentDdtd: null, total: 1_500_000 },
    { ddtd: "P1", isInvoice: false, parentDdtd: INV, total: 400_000 },
    { ddtd: "P1", isInvoice: false, parentDdtd: INV, total: 400_000 },
    { ddtd: "P2", isInvoice: false, parentDdtd: ` ${INV} `, total: 100_000.5 },
  ]);
  assert.equal(result.invoices.get(INV), 1_500_000);
  assert.deepEqual(result.payments.get(INV), { paid: 500_000.5, count: 2 });
});

test("тулсан: ТЕГ-ийн үлдэгдэл = Entry-ийн үлдэгдэл, мэдэгдсэн төлөлт = ТЕГ-ийнх", () => {
  const result = checkTaxInvoice(entry(), ledger(), coverage);
  assert.equal(result.check, "ok");
  assert.equal(result.taxRemaining, 1_000_000);
  assert.equal(result.entryRemaining, 1_000_000);
  assert.equal(result.difference, 0);
});

test("порталын «+»-аар гараар нэмсэн төлөлт → tax_extra (давхар бүртгэлийн эрсдэл)", () => {
  const result = checkTaxInvoice(entry(), ledger([500_000, 300_000]), coverage);
  assert.equal(result.check, "tax_extra");
  assert.equal(result.taxRemaining, 700_000);
  assert.equal(result.difference, -300_000);
  assert.ok(isTaxCheckProblem(result.check));
});

test("Entry илгээсэн төлөлт ТЕГ-д алга: 72 цагийн дотор хүлээгдэж буй, дараа нь tax_missing_payment", () => {
  const recent = new Date(NOW.getTime() - 5 * 3600_000);
  assert.equal(checkTaxInvoice(entry({ entryPaid: 800_000, reportedPaid: 800_000, lastReportedAt: recent }), ledger(), coverage).check, "pending");
  assert.equal(checkTaxInvoice(entry({ entryPaid: 800_000, reportedPaid: 800_000 }), ledger(), coverage).check, "tax_missing_payment");
});

test("Entry-д төлөгдсөн ч ТЕГ-д мэдэгдээгүй (алдаатай баримт / кассгүй хаалт) → entry_unreported", () => {
  assert.equal(checkTaxInvoice(entry({ entryPaid: 900_000 }), ledger(), coverage).check, "entry_unreported");
});

test("ТЕГ-д мэдэгдсэн төлөлт Entry-д буцаагдсан → entry_reversed", () => {
  assert.equal(checkTaxInvoice(entry({ entryPaid: 0 }), ledger(), coverage).check, "entry_reversed");
});

test("нэхэмжлэхийн дүн зөрсөн (засвар ТЕГ-д очоогүй) → total_mismatch", () => {
  assert.equal(checkTaxInvoice(entry({ registeredTotal: 1_200_000, entryTotal: 1_200_000 }), ledger(), coverage).check, "total_mismatch");
  // ebarimtTotal хадгалагдаагүй хуучин өгөгдөл: үлдэгдлийн зөрүүгээр л илэрнэ
  assert.equal(checkTaxInvoice(entry({ registeredTotal: null, entryTotal: 1_200_000 }), ledger(), coverage).check, "total_mismatch");
});

test("нэхэмжлэх ТЕГ-д алга: 72 цагийн дотор хүлээгдэж буй, татсан хугацаанаас өмнө not_synced, бусад нь tax_missing_invoice", () => {
  const empty = buildTaxLedger([]);
  assert.equal(checkTaxInvoice(entry({ invoiceSentAt: new Date(NOW.getTime() - 3600_000) }), empty, coverage).check, "pending");
  assert.equal(checkTaxInvoice(entry({ invoiceDate: "2026-08-15" }), empty, coverage).check, "not_synced");
  assert.equal(checkTaxInvoice(entry(), empty, { syncFrom: null, now: NOW }).check, "not_synced");
  assert.equal(checkTaxInvoice(entry(), empty, coverage).check, "tax_missing_invoice");
});

test("1₮ хүртэлх бөөрөнхийллийн зөрүү тулсанд тооцогдоно", () => {
  assert.equal(checkTaxInvoice(entry({ entryPaid: 500_000.6, reportedPaid: 500_000.4 }), ledger(), coverage).check, "ok");
});

test("summarizeTaxChecks: pending/ok/not_synced асуудал биш, danger нь ТЕГ-ийн бүртгэлийн эрсдэл", () => {
  assert.deepEqual(summarizeTaxChecks(["ok", "pending", "not_synced", "entry_unreported", "tax_extra"]), {
    checked: 5,
    problems: 2,
    danger: 1,
  });
});

test("isTaxSyncDue: анх, нөхөлт 10 мин тутам, алдаанд 1 цаг, эс бөгөөс өдөрт нэг 06:00-аас", () => {
  const base = { now: NOW, todayUb: "2026-10-10", hourUb: 8, lastSyncError: null };
  assert.equal(isTaxSyncDue({ ...base, lastSyncAt: null, lastSyncDateUb: null, syncedThrough: null }), true);
  const fiveMinAgo = new Date(NOW.getTime() - 5 * 60_000);
  const twentyMinAgo = new Date(NOW.getTime() - 20 * 60_000);
  // Нөхөлт дуусаагүй
  assert.equal(isTaxSyncDue({ ...base, lastSyncAt: fiveMinAgo, lastSyncDateUb: "2026-10-10", syncedThrough: "2026-09-20" }), false);
  assert.equal(isTaxSyncDue({ ...base, lastSyncAt: twentyMinAgo, lastSyncDateUb: "2026-10-10", syncedThrough: "2026-09-20" }), true);
  // Алдаатай — 1 цаг хүлээнэ
  assert.equal(
    isTaxSyncDue({ ...base, lastSyncError: "x", lastSyncAt: twentyMinAgo, lastSyncDateUb: "2026-10-10", syncedThrough: "2026-09-20" }),
    false
  );
  // Гүйцсэн: өнөөдөр татсан бол дахин үгүй; өчигдөр татсан бол 06:00-аас хойш
  assert.equal(isTaxSyncDue({ ...base, lastSyncAt: twentyMinAgo, lastSyncDateUb: "2026-10-10", syncedThrough: "2026-10-10" }), false);
  const yesterday = new Date(NOW.getTime() - 20 * 3600_000);
  assert.equal(isTaxSyncDue({ ...base, lastSyncAt: yesterday, lastSyncDateUb: "2026-10-09", syncedThrough: "2026-10-09" }), true);
  assert.equal(isTaxSyncDue({ ...base, hourUb: 5, lastSyncAt: yesterday, lastSyncDateUb: "2026-10-09", syncedThrough: "2026-10-09" }), false);
});

test("taxSyncDays: сүүлийн 3 өдрийг давтаж, эхлэлээс доош орохгүй, нэг удаад ≤ maxDays", () => {
  assert.deepEqual(taxSyncDays({ syncFrom: "2026-10-01", syncedThrough: "2026-10-09", todayUb: "2026-10-10" }), [
    "2026-10-06",
    "2026-10-07",
    "2026-10-08",
    "2026-10-09",
    "2026-10-10",
  ]);
  assert.deepEqual(taxSyncDays({ syncFrom: "2026-10-08", syncedThrough: "2026-10-09", todayUb: "2026-10-10" }), [
    "2026-10-08",
    "2026-10-09",
    "2026-10-10",
  ]);
  const backfill = taxSyncDays({ syncFrom: "2026-01-01", syncedThrough: null, todayUb: "2026-10-10", maxDays: 31 });
  assert.equal(backfill.length, 31);
  assert.equal(backfill[0], "2026-01-01");
  assert.equal(backfill[30], "2026-01-31");
});

test("TPI хуудаслалт: дараагийн хуудас өмнөхийн endCount-оос — аль ч тайлбарт мөр алгасахгүй", () => {
  assert.deepEqual(tpiPageWindow(0, 500), { startCount: 0, endCount: 500 });
  assert.deepEqual(tpiPageWindow(1, 500), { startCount: 500, endCount: 1000 });
  assert.equal(tpiHasMorePages(500, 500), true);
  assert.equal(tpiHasMorePages(499, 500), true);
  assert.equal(tpiHasMorePages(501, 500), true);
  assert.equal(tpiHasMorePages(120, 500), false);
  // Сервер хуудаслалтыг үл тоож бүгдийг өгсөн
  assert.equal(tpiHasMorePages(5000, 500), false);
});

test("хэсэгчилсэн буцаалтын засвар (шинэ ДДТД): хуучин ДДТД-д бүртгэгдсэн төлөлт гинжээр тоологдоно", () => {
  const OLD_DDTD = "000006596177000260920000000111111";
  const chainLedger = buildTaxLedger([
    { ddtd: INV, isInvoice: true, parentDdtd: null, total: 1_200_000 },
    { ddtd: "P-OLD", isInvoice: false, parentDdtd: OLD_DDTD, total: 500_000 },
  ]);
  const base = entry({ registeredTotal: 1_200_000, entryTotal: 1_200_000 });
  // Гинжгүй бол худал «Төлөлт ТЕГ-д алга»
  assert.equal(checkTaxInvoice(base, chainLedger, coverage).check, "tax_missing_payment");
  const result = checkTaxInvoice({ ...base, previousDdtds: [OLD_DDTD, INV] }, chainLedger, coverage);
  assert.equal(result.check, "ok");
  assert.equal(result.taxPaid, 500_000);
  assert.equal(result.taxRemaining, 700_000);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultPurchasesSyncFrom,
  normalizePurchaseDdtd,
  purchaseSyncRanges,
  reconcilePurchases,
  summarizePurchaseChecks,
  type ApInvoiceInput,
  type TaxPurchaseInput,
} from "../lib/ebarimt/purchase-reconcile";

const D1 = "000005743087000240101000001411087";
const D2 = "000005743087000240101000001411088";
const coverage = { syncFrom: "2026-08-01", syncedThrough: "2026-10-10", todayUb: "2026-10-10" };

const purchase = (partial: Partial<TaxPurchaseInput> = {}): TaxPurchaseInput => ({
  ddtd: D1,
  receiptDate: "2026-09-15",
  total: 110_000,
  vat: 10_000,
  sellerName: "ГУР*****МБА",
  sellerRegNo: "57***85",
  receiptType: "ТӨЛБӨРИЙН БАРИМТ",
  ...partial,
});
const invoice = (partial: Partial<ApInvoiceInput> = {}): ApInvoiceInput => ({
  documentId: "ap1",
  documentNo: "AP-26-000001",
  date: "2026-09-16",
  counterpartyName: "Гурвалжин ХХК",
  total: 110_000,
  vat: 10_000,
  supplierEbarimtId: D1,
  ...partial,
});

test("ДДТД-ээр холбосон, дүн/НӨАТ тэнцүү → ok; зөрвөл amount_mismatch (danger)", () => {
  assert.equal(reconcilePurchases([purchase()], [invoice()], coverage)[0].check, "ok");
  const rows = reconcilePurchases([purchase()], [invoice({ vat: 0 })], coverage);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].check, "amount_mismatch");
  assert.equal(rows[0].documentNo, "AP-26-000001");
  assert.equal(summarizePurchaseChecks(rows.map((row) => row.check)).danger, 1);
});

test("өглөгт бүртгэлгүй баримт → entry_missing, ижил дүн ±7 хоногийн ДДТД-гүй өглөгийг санал болгоно (ойрыг нь түрүүлж)", () => {
  const rows = reconcilePurchases(
    [purchase()],
    [
      invoice({ documentId: "far", documentNo: "AP-FAR", date: "2026-09-21", supplierEbarimtId: null }),
      invoice({ documentId: "near", documentNo: "AP-NEAR", date: "2026-09-15", supplierEbarimtId: null }),
      invoice({ documentId: "out", documentNo: "AP-OUT", date: "2026-09-30", supplierEbarimtId: null }),
      invoice({ documentId: "diff", documentNo: "AP-DIFF", total: 99_000, supplierEbarimtId: null }),
    ],
    coverage
  );
  const receipt = rows.find((row) => row.kind === "receipt")!;
  assert.equal(receipt.check, "entry_missing");
  assert.deepEqual(receipt.candidates.map((candidate) => candidate.documentNo), ["AP-NEAR", "AP-FAR"]);
  // ДДТД-гүй НӨАТ-тай өглөг бүр тусдаа «eBarimt холбогдоогүй»
  assert.equal(rows.filter((row) => row.check === "no_receipt").length, 4);
});

test("өглөгт бичсэн ДДТД ТЕГ-д алга → tax_missing; сүүлийн 3 хоног pending; татаагүй хугацаа not_synced", () => {
  const check = (date: string) => reconcilePurchases([], [invoice({ date, supplierEbarimtId: D2 })], coverage)[0].check;
  assert.equal(check("2026-09-20"), "tax_missing");
  assert.equal(check("2026-10-08"), "pending");
  assert.equal(check("2026-07-20"), "not_synced");
  // Хэзээ ч татаагүй
  assert.equal(
    reconcilePurchases([], [invoice({ supplierEbarimtId: D2 })], { syncFrom: null, syncedThrough: null, todayUb: "2026-10-10" })[0].check,
    "not_synced"
  );
});

test("НӨАТ-гүй, ДДТД-гүй өглөг асуудал биш; давхардсан ДДТД нэг л мөр", () => {
  assert.deepEqual(reconcilePurchases([], [invoice({ vat: 0, supplierEbarimtId: null })], coverage), []);
  assert.equal(reconcilePurchases([purchase(), purchase({ ddtd: ` ${D1} ` })], [invoice()], coverage).length, 1);
});

test("summarizePurchaseChecks: pending/not_synced/ok асуудал биш; danger = дүн зөрсөн + ТЕГ-д алга", () => {
  assert.deepEqual(summarizePurchaseChecks(["ok", "pending", "not_synced", "entry_missing", "no_receipt", "tax_missing", "amount_mismatch"]), {
    checked: 7,
    problems: 4,
    danger: 2,
  });
});

test("татах муж: 2 сарын өмнөх сарын 1-ээс, 31 хоногоор, сүүлийн 3 өдрийг давтана, нэг удаад ≤ 4", () => {
  assert.equal(defaultPurchasesSyncFrom("2026-10-02"), "2026-08-01");
  assert.equal(defaultPurchasesSyncFrom("2026-01-15"), "2025-11-01");
  assert.deepEqual(purchaseSyncRanges({ syncFrom: "2026-08-01", syncedThrough: null, todayUb: "2026-10-02" }), [
    { startDate: "2026-08-01", endDate: "2026-08-31" },
    { startDate: "2026-09-01", endDate: "2026-10-01" },
    { startDate: "2026-10-02", endDate: "2026-10-02" },
  ]);
  assert.deepEqual(purchaseSyncRanges({ syncFrom: "2026-08-01", syncedThrough: "2026-10-01", todayUb: "2026-10-02" }), [
    { startDate: "2026-09-28", endDate: "2026-10-02" },
  ]);
  assert.equal(purchaseSyncRanges({ syncFrom: "2025-01-01", syncedThrough: null, todayUb: "2026-10-02" }).length, 4);
});

test("ДДТД-ийн хэлбэр: 33 оронтой тоо, зай хасна", () => {
  assert.equal(normalizePurchaseDdtd(` ${D1.slice(0, 10)} ${D1.slice(10)} `), D1);
  assert.equal(normalizePurchaseDdtd("123"), null);
  assert.equal(normalizePurchaseDdtd("0000057430870002401010000014110AB"), null);
});

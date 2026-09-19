import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MODULE_CODES,
  formatNo,
  inheritReversalModules,
  moduleFromExternalRef,
  planVoucherNumbers,
  scopeOf,
} from "../scripts/lib/voucher-number-plan.mjs";

const ORG = "org-1";

function voucher(
  id: string,
  date: string,
  extra: Partial<{ externalRef: string; reversalOfVoucherId: string }> = {}
) {
  return {
    id,
    organizationId: ORG,
    date,
    externalRef: null,
    reversalOfVoucherId: null,
    ...extra,
  };
}

test("scope нь lib/gl/voucher-no.ts-тэй ижил код өгнө", () => {
  assert.equal(scopeOf("gl", "2026-09-19"), "GL-26");
  assert.equal(scopeOf("cost", "2027-01-01"), "COST-27");
  assert.equal(formatNo("GL-26", 7), "GL-26-000007");
});

test("танихгүй модуль / гажиг огноонд ШИДНЭ", () => {
  assert.throws(() => scopeOf("хачин", "2026-09-19"), /Танихгүй модуль/);
  assert.throws(() => scopeOf("gl", "19/09/2026"), /огноо буруу/);
});

test("externalRef угтвараар модуль танина", () => {
  assert.equal(moduleFromExternalRef("vat-settlement:2026-08"), "vat");
  assert.equal(moduleFromExternalRef("payroll:2026-08"), "payroll");
  assert.equal(moduleFromExternalRef("po-close:abc"), "proc");
  assert.equal(moduleFromExternalRef("gr-capitalize:abc"), "proc");
  assert.equal(moduleFromExternalRef("opening-balance:2026-01-01"), null);
  assert.equal(moduleFromExternalRef(null), null);
});

test("огнооны дарааллаар 1-ээс дугаарлана", () => {
  const { updates } = planVoucherNumbers({
    vouchers: [
      voucher("a", "2026-09-15"),
      voucher("b", "2026-09-16"),
      voucher("c", "2026-09-18"),
    ],
  });
  assert.deepEqual(updates, [
    { id: "a", documentNo: "GL-26-000001" },
    { id: "b", documentNo: "GL-26-000002" },
    { id: "c", documentNo: "GL-26-000003" },
  ]);
});

test("модуль бүр ӨӨРИЙН дараалалтай", () => {
  const { updates, byModule } = planVoucherNumbers({
    vouchers: [
      voucher("a", "2026-09-15"),
      voucher("b", "2026-09-15"),
      voucher("c", "2026-09-16"),
    ],
    moduleById: new Map([
      ["b", "cash"],
      ["c", "cash"],
    ]),
  });
  assert.deepEqual(updates, [
    { id: "a", documentNo: "GL-26-000001" },
    { id: "b", documentNo: "CM-26-000001" },
    { id: "c", documentNo: "CM-26-000002" },
  ]);
  assert.equal(byModule.get("cash"), 2);
  assert.equal(byModule.get("gl"), 1);
});

test("жил солигдоход 1-ээс эхэлнэ", () => {
  const { updates } = planVoucherNumbers({
    vouchers: [
      voucher("a", "2026-12-31"),
      voucher("b", "2027-01-02"),
      voucher("c", "2027-01-03"),
    ],
  });
  assert.deepEqual(updates.map((row) => row.documentNo), [
    "GL-26-000001",
    "GL-27-000001",
    "GL-27-000002",
  ]);
});

test("аль хэдийн олгогдсон дугаарын ДАРААГААС үргэлжилнэ", () => {
  const { updates, counters } = planVoucherNumbers({
    vouchers: [voucher("a", "2026-09-15"), voucher("b", "2026-09-16")],
    usedDocumentNos: [
      { organizationId: ORG, documentNo: "GL-26-000001" },
      { organizationId: ORG, documentNo: "GL-26-000004" },
    ],
  });
  assert.deepEqual(updates.map((row) => row.documentNo), [
    "GL-26-000005",
    "GL-26-000006",
  ]);
  assert.deepEqual(counters, [{ organizationId: ORG, scope: "GL-26", value: 6 }]);
});

test("байгууллага бүр ТУСДАА дараалалтай", () => {
  const { updates } = planVoucherNumbers({
    vouchers: [
      { ...voucher("a", "2026-09-15"), organizationId: "org-A" },
      { ...voucher("b", "2026-09-16"), organizationId: "org-B" },
      { ...voucher("c", "2026-09-17"), organizationId: "org-A" },
    ],
  });
  assert.deepEqual(updates.map((row) => row.documentNo), [
    "GL-26-000001",
    "GL-26-000001",
    "GL-26-000002",
  ]);
});

test("буцаалт эх журналынхаа модулийг өвлөнө", () => {
  const { updates } = planVoucherNumbers({
    vouchers: [
      voucher("src", "2026-09-15"),
      voucher("rev", "2026-09-16", { reversalOfVoucherId: "src" }),
    ],
    moduleById: new Map([["src", "fa"]]),
  });
  assert.deepEqual(updates, [
    { id: "src", documentNo: "FA-26-000001" },
    { id: "rev", documentNo: "FA-26-000002" },
  ]);
});

test("гинжин буцаалт ч өвлөнө (буцаалтын буцаалт)", () => {
  const resolved = inheritReversalModules(
    [
      voucher("a", "2026-09-15"),
      voucher("b", "2026-09-16", { reversalOfVoucherId: "a" }),
      voucher("c", "2026-09-17", { reversalOfVoucherId: "b" }),
    ],
    new Map([["a", "cost"]])
  );
  assert.equal(resolved.get("b"), "cost");
  assert.equal(resolved.get("c"), "cost");
});

test("мөчлөгт буцаалт гацаахгүй", () => {
  const resolved = inheritReversalModules(
    [
      voucher("a", "2026-09-15", { reversalOfVoucherId: "b" }),
      voucher("b", "2026-09-16", { reversalOfVoucherId: "a" }),
    ],
    new Map()
  );
  assert.equal(resolved.get("a"), undefined, "тодорхойлогдохгүй → gl рүү унана");
});

test("холбоос нь externalRef-ийг ДАРНА", () => {
  const { updates } = planVoucherNumbers({
    vouchers: [
      voucher("a", "2026-09-15", { externalRef: "payroll:2026-09" }),
      voucher("b", "2026-09-16", { externalRef: "vat-settlement:2026-09" }),
    ],
    // Дэд дэвтрийн холбоос нь илүү найдвартай тул давуу эрхтэй.
    moduleById: new Map([["a", "cash"]]),
  });
  assert.deepEqual(updates, [
    { id: "a", documentNo: "CM-26-000001" },
    { id: "b", documentNo: "VAT-26-000001" },
  ]);
});

test("хоосон жагсаалт — юу ч төлөвлөхгүй", () => {
  const { updates, counters } = planVoucherNumbers({ vouchers: [] });
  assert.deepEqual(updates, []);
  assert.deepEqual(counters, []);
});

test("модулийн кодууд voucher-no.ts-тэй ижил багц", async () => {
  const { JOURNAL_MODULE_CODES } = await import("../lib/gl/voucher-no");
  assert.deepEqual(MODULE_CODES, JOURNAL_MODULE_CODES);
});

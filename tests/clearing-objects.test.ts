// Клирингийн объект тодорхойлолт — ЦЭВЭР дүрмүүд (docs/cost §6).
//
// Регресс: тэгширсэн хос (эх + буцаалт; АП мөр + түүнээс үүссэн хөдөлгөөн)
// хоёр өөр объект болж "нээлттэй" гэж худал сэрэмжлүүлдэг байсан.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveClearingObject,
  resolveClearingObjectWithReversal,
  type ClearingLookups,
  type ClearingRawLine,
} from "../lib/costing/clearing-objects";

function emptyLookups(): ClearingLookups {
  return {
    entryById: new Map(),
    allocationByEntry: new Map(),
    movementById: new Map(),
    apByArapLine: new Map(),
    apByVoucher: new Map(),
    cashByVoucher: new Map(),
    componentById: new Map(),
    orderById: new Map(),
    itemById: new Map(),
  };
}

function line(overrides: Partial<ClearingRawLine> = {}): ClearingRawLine {
  return {
    voucherId: "v-1",
    voucherDate: "2026-07-12",
    voucherDescription: "Гар журнал",
    account: "14000099",
    delta: -5_000_000,
    costEntryId: null,
    businessObjectType: null,
    businessObjectId: null,
    ...overrides,
  };
}

/** Бакетын түлхүүр — ачаалагчийнхтай ИЖИЛ дүрэм. */
const keyOf = (account: string, r: { objectType: string; objectId: string }) =>
  `${account}::${r.objectType}::${r.objectId}`;

describe("resolveClearingObject", () => {
  it("нотолгоогүй мөр «Тодорхойгүй (гар журнал)» болно", () => {
    const resolved = resolveClearingObject(line(), emptyLookups());
    assert.equal(resolved.objectType, "Тодорхойгүй (гар журнал)");
    assert.equal(resolved.known, false);
  });

  it("хөдөлгөөн нь АП-ийн мөрөөс үүссэн бол АП БАРИМТЫН объектод буудаг", () => {
    const lookups = emptyLookups();
    lookups.entryById.set("ce-1", {
      id: "ce-1",
      movementId: "mv-1",
      itemId: "item-1",
      costComponentId: null,
    });
    lookups.movementById.set("mv-1", {
      documentNo: "INV-20260805-EA268E",
      sourceType: "arap_line",
      sourceId: "apline-1",
    });
    lookups.apByArapLine.set("apline-1", {
      documentNo: "AP-20260805-ED783A",
      documentType: "ap_bill",
      purchaseOrderId: null,
    });
    // АП нэхэмжлэхийн ӨӨРИЙН Dr мөр (воучероороо шийдэгддэг)
    lookups.apByVoucher.set("v-ap", {
      documentNo: "AP-20260805-ED783A",
      documentType: "ap_bill",
      purchaseOrderId: null,
    });

    const capitalization = resolveClearingObject(
      line({ voucherId: "v-cost", costEntryId: "ce-1", delta: -500_000 }),
      lookups
    );
    const invoice = resolveClearingObject(
      line({ voucherId: "v-ap", delta: 500_000 }),
      lookups
    );

    // ХОЁУЛАА нэг объект → нэг бакет → тэгширнэ.
    assert.equal(capitalization.objectType, "Өглөгийн нэхэмжлэх");
    assert.equal(capitalization.objectId, "AP-20260805-ED783A");
    assert.equal(
      keyOf("14000099", capitalization),
      keyOf("14000099", invoice)
    );
  });

  it("АП-ийн мөр нь PO-той бол ЗАХИАЛГЫН объектод буудаг", () => {
    const lookups = emptyLookups();
    lookups.entryById.set("ce-1", {
      id: "ce-1",
      movementId: "mv-1",
      itemId: null,
      costComponentId: null,
    });
    lookups.movementById.set("mv-1", {
      documentNo: "INV-1",
      sourceType: "arap_line",
      sourceId: "apline-1",
    });
    lookups.apByArapLine.set("apline-1", {
      documentNo: "AP-1",
      documentType: "ap_bill",
      purchaseOrderId: "po-1",
    });
    lookups.orderById.set("po-1", { documentNo: "PO-20260801-AAA111" });

    const resolved = resolveClearingObject(
      line({ costEntryId: "ce-1" }),
      lookups
    );
    assert.equal(resolved.objectType, "Захиалга (PO)");
    assert.equal(resolved.objectId, "PO-20260801-AAA111");
  });

  it("хуваарилалт эх нэхэмжлэхийн мөртэй бол ТЭР БАРИМТЫН объектод буудаг", () => {
    // Зардлыг дансанд оруулсан АП-ийн Dr ба түүнийг хаасан хуваарилалтын Cr
    // НЭГ бакетад орох ёстой — эс бөгөөс хоёулаа мөнхөд "нээлттэй".
    const lookups = emptyLookups();
    lookups.entryById.set("ce-lc", {
      id: "ce-lc",
      movementId: null,
      itemId: "item-1",
      costComponentId: null,
    });
    lookups.allocationByEntry.set("ce-lc", {
      documentNo: "ALLOC-1",
      costComponentId: null,
      sourceLineId: "apline-7",
    });
    lookups.apByArapLine.set("apline-7", {
      documentNo: "AP-20260901-FREIGHT",
      documentType: "ap_bill",
      purchaseOrderId: null,
    });
    lookups.apByVoucher.set("v-ap", {
      documentNo: "AP-20260901-FREIGHT",
      documentType: "ap_bill",
      purchaseOrderId: null,
    });

    const allocation = resolveClearingObject(
      line({ voucherId: "v-alloc", costEntryId: "ce-lc", delta: -300_000 }),
      lookups
    );
    const invoice = resolveClearingObject(
      line({ voucherId: "v-ap", delta: 300_000 }),
      lookups
    );
    assert.equal(allocation.objectType, "Өглөгийн нэхэмжлэх");
    assert.equal(keyOf("14000099", allocation), keyOf("14000099", invoice));
  });

  it("эх сурвалжгүй хуваарилалт «Зардлын хуваарилалт» хэвээр", () => {
    const lookups = emptyLookups();
    lookups.entryById.set("ce-lc", {
      id: "ce-lc",
      movementId: null,
      itemId: "item-1",
      costComponentId: null,
    });
    lookups.allocationByEntry.set("ce-lc", {
      documentNo: "ALLOC-2",
      costComponentId: null,
      sourceLineId: null,
    });
    const resolved = resolveClearingObject(
      line({ costEntryId: "ce-lc" }),
      lookups
    );
    // Холбоос БАЙХГҮЙ үед объектыг ЗОХИОХГҮЙ (§6.2) — ил үлдэнэ.
    assert.equal(resolved.objectType, "Зардлын хуваарилалт");
    assert.equal(resolved.objectId, "ALLOC-2");
  });

  it("хөдөлгөөн устсан өртгийн бичилт барааны нэрээр объект болно", () => {
    const lookups = emptyLookups();
    lookups.entryById.set("ce-2", {
      id: "ce-2",
      movementId: null, // буцаагдсан бичилтийн хөдөлгөөн устсан
      itemId: "item-9",
      costComponentId: null,
    });
    lookups.itemById.set("item-9", { code: "SUG-1", name: "Элсэн чихэр 1кг" });

    const resolved = resolveClearingObject(
      line({ costEntryId: "ce-2" }),
      lookups
    );
    assert.equal(resolved.objectType, "Өртгийн бичилт");
    assert.equal(resolved.objectId, "ce-2");
    assert.equal(resolved.objectLabel, "SUG-1 · Элсэн чихэр 1кг");
    // "Тодорхойгүй (гар журнал)" руу УНАХГҮЙ — жинхэнэ гар бичилттэй хольж
    // хутгавал тайлбаргүй үлдэгдлийн тоолуур гажина.
    assert.equal(resolved.known, true);
  });
});

describe("resolveClearingObjectWithReversal", () => {
  const original = line({ voucherId: "v-orig", delta: -5_000_000 });
  const reversal = line({
    voucherId: "v-rev",
    voucherDescription: "Буцаалт",
    delta: 5_000_000,
  });
  const context = {
    reversalOf: new Map([["v-rev", "v-orig"]]),
    linesByVoucherAccount: new Map([
      ["v-orig::14000099", [original]],
      ["v-rev::14000099", [reversal]],
    ]),
  };

  it("гар журналын буцаалт ЭХ журналынхаа бакетад орж тэгширнэ", () => {
    const lookups = emptyLookups();
    const a = resolveClearingObjectWithReversal(original, lookups, context);
    const b = resolveClearingObjectWithReversal(reversal, lookups, context);
    assert.equal(keyOf("14000099", a), keyOf("14000099", b));
    // Цэвэр дүн 0 → ачаалагч "cleared" болгоно, "нээлттэй" гэж тоолохгүй.
    assert.equal(original.delta + reversal.delta, 0);
  });

  it("эх нь өртгийн бичилттэй бол буцаалт мөн ТҮҮНИЙ объектыг өвлөнө", () => {
    const lookups = emptyLookups();
    lookups.entryById.set("ce-3", {
      id: "ce-3",
      movementId: null,
      itemId: "item-9",
      costComponentId: null,
    });
    lookups.itemById.set("item-9", { code: "SUG-1", name: "Элсэн чихэр 1кг" });
    const withEntry = line({
      voucherId: "v-orig",
      costEntryId: "ce-3",
      delta: -5_000_000,
    });
    const ctx = {
      reversalOf: context.reversalOf,
      linesByVoucherAccount: new Map([
        ["v-orig::14000099", [withEntry]],
        ["v-rev::14000099", [reversal]],
      ]),
    };

    const a = resolveClearingObjectWithReversal(withEntry, lookups, ctx);
    const b = resolveClearingObjectWithReversal(reversal, lookups, ctx);
    assert.equal(a.objectType, "Өртгийн бичилт");
    assert.equal(keyOf("14000099", a), keyOf("14000099", b));
    assert.equal(b.known, true);
  });

  it("буцаалтын БУЦААЛТ гинжний ҮНДЭС рүү бакетлагдана", () => {
    // V1 (эх, гар журнал) → V2 (буцаалт) → V3 (буцаалтын буцаалт) → V4.
    // Дөрвүүлээ V1-ийн бакетад орж Σ = 0 → "нээлттэй" гэж тоологдохгүй.
    const v1 = line({ voucherId: "v1", delta: -5_000_000 });
    const v2 = line({ voucherId: "v2", delta: 5_000_000 });
    const v3 = line({ voucherId: "v3", delta: -5_000_000 });
    const v4 = line({ voucherId: "v4", delta: 5_000_000 });
    const ctx = {
      reversalOf: new Map([
        ["v2", "v1"],
        ["v3", "v2"],
        ["v4", "v3"],
      ]),
      linesByVoucherAccount: new Map([
        ["v1::14000099", [v1]],
        ["v2::14000099", [v2]],
        ["v3::14000099", [v3]],
        ["v4::14000099", [v4]],
      ]),
    };
    const lookups = emptyLookups();
    const keys = [v1, v2, v3, v4].map((entry) =>
      keyOf(
        "14000099",
        resolveClearingObjectWithReversal(entry, lookups, ctx)
      )
    );
    assert.equal(new Set(keys).size, 1, "дөрвүүлээ НЭГ бакетад орох ёстой");
    assert.equal(keys[0], keyOf("14000099", { objectType: "Тодорхойгүй (гар журнал)", objectId: "v1" }));
    assert.equal(v1.delta + v2.delta + v3.delta + v4.delta, 0);
  });

  it("гинжний дээд шатанд мэдэгдэх объект байвал түүнийг авна", () => {
    const lookups = emptyLookups();
    lookups.cashByVoucher.set("v1", { documentNo: "CASH-1" });
    const v1 = line({ voucherId: "v1" });
    const v2 = line({ voucherId: "v2" });
    const v3 = line({ voucherId: "v3" });
    const resolved = resolveClearingObjectWithReversal(v3, lookups, {
      reversalOf: new Map([
        ["v2", "v1"],
        ["v3", "v2"],
      ]),
      linesByVoucherAccount: new Map([
        ["v1::14000099", [v1]],
        ["v2::14000099", [v2]],
        ["v3::14000099", [v3]],
      ]),
    });
    assert.equal(resolved.objectType, "Мөнгөн гүйлгээ");
    assert.equal(resolved.objectId, "CASH-1");
  });

  it("мөчлөгтэй холбоос гацаахгүй", () => {
    const a = line({ voucherId: "a" });
    const b = line({ voucherId: "b" });
    const resolved = resolveClearingObjectWithReversal(a, emptyLookups(), {
      reversalOf: new Map([
        ["a", "b"],
        ["b", "a"],
      ]),
      linesByVoucherAccount: new Map([
        ["a::14000099", [a]],
        ["b::14000099", [b]],
      ]),
    });
    assert.equal(resolved.known, false);
  });

  it("буцаалт биш нотолгоогүй мөр өвлөхгүй — тайлбаргүй хэвээр", () => {
    const lone = line({ voucherId: "v-lone" });
    const resolved = resolveClearingObjectWithReversal(lone, emptyLookups(), {
      reversalOf: new Map(),
      linesByVoucherAccount: new Map([["v-lone::14000099", [lone]]]),
    });
    assert.equal(resolved.known, false);
    assert.equal(resolved.objectId, "v-lone");
  });
});

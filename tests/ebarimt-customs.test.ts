import test from "node:test";
import assert from "node:assert/strict";

import { customsGoodsLabel, summarizeCustomsDeclarations } from "../lib/ebarimt/customs";
import { customsDeclarationBody, customsHasMorePages, parseCustomsDeclarations } from "../lib/itc/tpi";

test("Гаалийн мэдүүлгийн хүсэлт: YYYY-MM-DD, pageNumber 1-ээс, анхдагч 100", () => {
  assert.deepEqual(customsDeclarationBody({ startDate: "2026-09-01", endDate: "2026-09-07", pageNumber: 1 }), {
    startDate: "2026-09-01",
    endDate: "2026-09-07",
    pageNumber: 1,
    pageSize: 100,
  });
  assert.throws(() => customsDeclarationBody({ startDate: "2026/09/01", endDate: "2026-09-07", pageNumber: 1 }), /YYYY-MM-DD/);
  assert.throws(() => customsDeclarationBody({ startDate: "2026-09-08", endDate: "2026-09-07", pageNumber: 1 }), /хойш/);
  assert.throws(() => customsDeclarationBody({ startDate: "2026-09-01", endDate: "2026-09-07", pageNumber: 0 }), /1-ээс/);
});

test("Гаалийн мэдүүлгийн хариу (албан жишээ): дугаар, огноо, барааны мөр, нийлбэр", () => {
  const result = parseCustomsDeclarations({
    content: [
      {
        dclrNo: "14215******I25514",
        dclrDate: "2020-09-24T09:15:58.000+0000",
        items: [
          { goodsnm: "Нүүрс, коксжих, боловсруулаагүй", itemuprc: 0.0493, dutyamt: 0, exciseamt: 0, formamt: 0, vatBaseAmt: 0, vatamt: 0 },
          { goodsnm: "Тоног төхөөрөмж", itemuprc: "1200.5", dutyamt: 5000, exciseamt: "0", formamt: 3000, vatBaseAmt: 1_058_000, vatamt: 105_800.004 },
        ],
      },
      { dclrDate: "2020-09-25T00:00:00.000+0000", items: [] },
    ],
  });
  assert.equal(result.skipped, 1, "дугааргүй мэдүүлэг алгасагдаж тоологдоно");
  assert.equal(result.totalPages, null);
  const [declaration] = result.rows;
  assert.equal(declaration.declarationNo, "14215******I25514");
  assert.equal(declaration.date, "2020-09-24");
  assert.equal(declaration.items.length, 2);
  assert.equal(declaration.items[0].unitPrice, 0.0493);
  assert.equal(declaration.items[1].unitPrice, 1200.5);
  assert.equal(declaration.duty, 5000);
  assert.equal(declaration.fee, 3000);
  assert.equal(declaration.vatBase, 1_058_000);
  assert.equal(declaration.vat, 105_800);
  // Spring хуудаслалтын totalPages ирвэл уншина; status ≠ 200 бол шиднэ.
  assert.equal(parseCustomsDeclarations({ content: [], totalPages: 3 }).totalPages, 3);
  assert.throws(() => parseCustomsDeclarations({ status: 500, msg: "алдаа" }), /алдаа/);
});

test("Гаалийн хуудаслалт: totalPages-ээр, эс бөгөөс дүүрэн хуудсаар", () => {
  assert.equal(customsHasMorePages(1, 100, null), true);
  assert.equal(customsHasMorePages(1, 37, null), false);
  assert.equal(customsHasMorePages(2, 100, 2), false);
  assert.equal(customsHasMorePages(1, 100, 3), true);
});

test("Гаалийн хураангуй ба барааны товч", () => {
  const row = (vat: number, duty: number, names: string[]) => ({
    declarationNo: `D${vat}`,
    rawDate: "",
    date: "2026-09-01",
    items: names.map((name) => ({ name, unitPrice: null, duty: 0, excise: 0, fee: 0, vatBase: 0, vat: 0 })),
    duty,
    excise: 10,
    fee: 1,
    vatBase: vat * 10,
    vat,
  });
  const summary = summarizeCustomsDeclarations([row(100.005, 50, ["A", "B"]), row(200, 25, ["C"])]);
  assert.equal(summary.count, 2);
  assert.equal(summary.items, 3);
  assert.equal(summary.vat, 300.01);
  assert.equal(summary.duty, 75);
  assert.equal(summary.excise, 20);
  assert.equal(customsGoodsLabel([{ name: "A" }, { name: "B" }, { name: "C" }]), "A … (+2)");
  assert.equal(customsGoodsLabel([{ name: " A " }]), "A");
  assert.equal(customsGoodsLabel([]), "");
});

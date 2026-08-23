import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEbarimtExtraction } from "../lib/arap/ebarimt";

const VALID = {
  supplierName: "Түмэн Импекс ХХК",
  supplierRegisterNo: "2074818",
  ddtd: "0000123456789012345678901234567890",
  date: "2026-07-15",
  totalAmount: 550000,
  vatAmount: 50000,
  lines: [
    { description: "Бичгийн цаас A4", amount: 330000 },
    { description: "Принтерийн хор", amount: 220000 },
  ],
};

test("зөв JSON — бүх талбар задарна (markdown код блоктой ч)", () => {
  const result = parseEbarimtExtraction(
    "```json\n" + JSON.stringify(VALID) + "\n```"
  );
  assert.ok("data" in result);
  assert.equal(result.data.supplierName, "Түмэн Импекс ХХК");
  assert.equal(result.data.supplierRegisterNo, "2074818");
  assert.equal(result.data.ddtd, VALID.ddtd);
  assert.equal(result.data.vatAmount, 50000);
  assert.equal(result.data.lines.length, 2);
});

test("мөрийн нийлбэр нийт дүнтэй зөрвөл нэг нэгдсэн мөр болно", () => {
  const result = parseEbarimtExtraction(
    JSON.stringify({ ...VALID, lines: [{ description: "Х", amount: 100 }] })
  );
  assert.ok("data" in result);
  assert.equal(result.data.lines.length, 1);
  assert.equal(result.data.lines[0].amount, 550000);
  assert.equal(result.data.lines[0].description, "Худалдан авалт (eBarimt)");
});

test("дутуу/буруу утгууд — ойлгомжтой алдаа эсвэл аюулгүй default", () => {
  assert.ok("error" in parseEbarimtExtraction("ямар ч JSON алга"));
  assert.ok(
    "error" in parseEbarimtExtraction(JSON.stringify({ ...VALID, date: "2026/07/15" }))
  );
  assert.ok(
    "error" in parseEbarimtExtraction(JSON.stringify({ ...VALID, totalAmount: 0 }))
  );
  // ТТД буруу форматтай → null; НӨАТ нийт дүнгээс их → 0 (НӨАТ-гүй гэж үзнэ)
  const odd = parseEbarimtExtraction(
    JSON.stringify({
      ...VALID,
      supplierRegisterNo: "АБВ",
      vatAmount: 600000,
      ddtd: "x",
    })
  );
  assert.ok("data" in odd);
  assert.equal(odd.data.supplierRegisterNo, null);
  assert.equal(odd.data.vatAmount, 0);
  assert.equal(odd.data.ddtd, null);
});

test("тоон утга мянгачлалтай текстээр ирсэн ч уншина", () => {
  const result = parseEbarimtExtraction(
    JSON.stringify({
      ...VALID,
      totalAmount: "550,000₮",
      vatAmount: "50,000",
      lines: [{ description: "Бараа", amount: "550,000" }],
    })
  );
  assert.ok("data" in result);
  assert.equal(result.data.totalAmount, 550000);
  assert.equal(result.data.vatAmount, 50000);
  assert.equal(result.data.lines[0].amount, 550000);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  SEG_DEFAULTS,
  buildSegCode,
  fmtAccountDisplay,
  normalizePastedAccount,
  parseSegParts,
  withSegDefaultOption,
} from "../lib/grid/segments";

// Стандарт: бүх сегмент бөглөгдөнө — бичигдээгүй нь оронгийн тоогоор 0,
// S3 үндсэн данс default-гүй, S9 = "GL".

test("SEG_DEFAULTS: оронгийн тоогоор 0-жсэн (S3 хоосон, S9 GL)", () => {
  assert.equal(SEG_DEFAULTS[1], "000");
  assert.equal(SEG_DEFAULTS[2], "000000");
  assert.equal(SEG_DEFAULTS[3], "");
  assert.equal(SEG_DEFAULTS[4], "00");
  assert.equal(SEG_DEFAULTS[5], "0000");
  assert.equal(SEG_DEFAULTS[8], "0000");
  assert.equal(SEG_DEFAULTS[9], "GL");
  assert.equal(SEG_DEFAULTS[10], "0");
});

test("buildSegCode: идэвхгүй БОЛОН бөглөөгүй идэвхтэй сегмент 0-default авна", () => {
  // Зөвхөн S3 идэвхтэй — бусад нь default.
  assert.equal(
    buildSegCode({ 3: "11000001" }, [3]),
    "000.000000.11000001.00.0000.000.0000.0000.GL.0"
  );
  // S2 идэвхтэй ч сонгоогүй — мөн 0-default.
  assert.equal(
    buildSegCode({ 3: "11000001" }, [2, 3]),
    "000.000000.11000001.00.0000.000.0000.0000.GL.0"
  );
  // S2 сонгосон бол утгаараа.
  assert.equal(
    buildSegCode({ 2: "120005", 3: "11000001" }, [2, 3]),
    "000.120005.11000001.00.0000.000.0000.0000.GL.0"
  );
  // extraDefaults (жишээ нь компани) 0-default-ыг дарна.
  assert.equal(
    buildSegCode({ 3: "11000001" }, [1, 3], { 1: "101" }),
    "101.000000.11000001.00.0000.000.0000.0000.GL.0"
  );
});

test("parseSegParts: хуучин (хоосон хэсэгтэй) кодыг 0-default-аар уншина", () => {
  const legacy = "..11000001...000.0000..GL.0";
  const parts = parseSegParts(legacy, [1, 2, 3, 8]);
  assert.equal(parts[1], "000");
  assert.equal(parts[2], "000000");
  assert.equal(parts[3], "11000001");
  assert.equal(parts[8], "0000");
});

test("идэвхжүүлсэн сегмент хуучин дата дээр 0 утгатай харагдана", () => {
  const stored = "000.000000.11000001.00.0000.000.0000.0000.GL.0";
  // S2-ыг шинээр идэвхжүүлэв — 0-утгатайгаа display-д гарна.
  assert.equal(fmtAccountDisplay(stored, [2, 3]), "000000.11000001");
  // Данс сонгогдоогүй хоосон мөр юу ч үзүүлэхгүй.
  const empty = buildSegCode({}, [2, 3]);
  assert.equal(fmtAccountDisplay(empty, [2, 3]), "");
});

test("normalizePastedAccount: хуучин форматын paste 0-жиж, шинэ формат хэвээрээ", () => {
  const padded = normalizePastedAccount("..11000001...000.0000..GL.0", [3]);
  assert.equal(padded, "000.000000.11000001.00.0000.000.0000.0000.GL.0");
  // 8 оронтой үндсэн данс → бүтэн 0-padded код.
  assert.equal(
    normalizePastedAccount("11000001", [3]),
    "000.000000.11000001.00.0000.000.0000.0000.GL.0"
  );
  // Active-only N-part код.
  assert.equal(
    normalizePastedAccount("120005.11000001", [2, 3]),
    "000.120005.11000001.00.0000.000.0000.0000.GL.0"
  );
});

test("withSegDefaultOption: 'Ерөнхий' сонголт нэмэгдэнэ, S3-д нэмэгдэхгүй", () => {
  const options = [{ code: "120005", name: "Уурхай" }];
  const withDefault = withSegDefaultOption(2, options);
  assert.equal(withDefault[0].code, "000000");
  assert.equal(withDefault.length, 2);
  // Давхардуулахгүй.
  assert.equal(withSegDefaultOption(2, withDefault).length, 2);
  // S3 үндсэн дансанд default сонголт байхгүй.
  assert.equal(withSegDefaultOption(3, options).length, 1);
});

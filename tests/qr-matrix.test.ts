import assert from "node:assert/strict";
import test from "node:test";

import { qrSvgPath } from "../lib/qr/matrix";

test("qrSvgPath — линкийн QR матриц (тогтвортой, квадрат модульт)", () => {
  const url = "https://app.entry.mn/invoice/2f1c1f5e-8a3b-4b8e-9d7c-1a2b3c4d5e6f";
  const a = qrSvgPath(url);
  const b = qrSvgPath(url);
  assert.equal(a.path, b.path);
  assert.ok(a.count >= 21 && a.count % 4 === 1, `модулийн тоо ${a.count}`);
  assert.match(a.path, /^M\d+ \d+h1v1h-1z/);
  assert.notEqual(qrSvgPath(`${url}x`).path, a.path);
});

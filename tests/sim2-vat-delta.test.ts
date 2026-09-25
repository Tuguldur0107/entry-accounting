// SIM2-015: тооцооноос хойш батлагдсан нэхэмжлэх → НЭМЭЛТ тооцоо (зөрүү).
import test from "node:test";
import assert from "node:assert/strict";

import { planVatSettlementDelta } from "../lib/vat/return";

test("B 2025-07: тооцоо 9.2M гаралт / 7.84M төлөлт → тайлан 35.85M — нэмэлт 26.65M", () => {
  const delta = planVatSettlementDelta(
    { outputVat: 35_850_000, inputVat: 1_360_000, carriedInVat: 0 },
    { output: 9_200_000, input: 1_360_000 }
  );
  assert.deepEqual(delta, {
    outputDelta: 26_650_000,
    inputDelta: 0,
    payableDelta: 26_650_000,
    needed: true,
    negative: false,
  });
  // 7.84M + 26.65M = 34.49M = get_vat_return-ийн ТӨЛӨХ
  assert.equal(7_840_000 + delta.payableDelta, 34_490_000);
});

test("зөрүүгүй бол нэмэлт тооцоо хэрэггүй; буурсан бол автоматаар бичихгүй", () => {
  assert.equal(
    planVatSettlementDelta({ outputVat: 1_000, inputVat: 300, carriedInVat: 0 }, { output: 1_000, input: 300 }).needed,
    false
  );
  const decreased = planVatSettlementDelta(
    { outputVat: 800, inputVat: 300, carriedInVat: 0 },
    { output: 1_000, input: 300 }
  );
  assert.equal(decreased.negative, true);
  // Хожим орсон оролтын НӨАТ төлөх дүнг бууруулна → negative (буцаан авах)
  const moreInput = planVatSettlementDelta(
    { outputVat: 1_000, inputVat: 500, carriedInVat: 0 },
    { output: 1_000, input: 300 }
  );
  assert.equal(moreInput.inputDelta, 200);
  assert.equal(moreInput.negative, true);
});

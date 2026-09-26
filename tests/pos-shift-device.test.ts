import assert from "node:assert/strict";
import test from "node:test";

import {
  SHIFT_DEVICE_MAX_ENTRIES,
  parseShiftDevicePicks,
  pickShiftDefaults,
  rememberShiftDevicePick,
} from "../lib/pos/shift-device";

const lists = { cashAccountIds: ["c1", "c2"], warehouseIds: ["w1", "w2"] };

test("төхөөрөмжийн сүүлийн сонголт байгууллагын сүүлийн ээлжийг дарна", () => {
  const result = pickShiftDefaults({
    ...lists,
    devicePicks: [{ cashAccountId: "c2", warehouseId: "w2" }],
    fallbackCashAccountId: "c1",
    fallbackWarehouseId: "w1",
  });
  assert.deepEqual(result, { cashAccountId: "c2", warehouseId: "w2", fromDevice: true });
});

test("өөр байгууллагын / устгасан данстай сонголтыг алгасч дараагийнхыг авна", () => {
  const result = pickShiftDefaults({
    ...lists,
    devicePicks: [
      { cashAccountId: "other-org", warehouseId: "w1" },
      { cashAccountId: "c2", warehouseId: "gone" },
      { cashAccountId: "c1", warehouseId: "w2" },
    ],
  });
  assert.deepEqual(result, { cashAccountId: "c1", warehouseId: "w2", fromDevice: true });
});

test("санамжгүй бол сүүлийн ээлж → жагсаалтын эхнийх", () => {
  assert.deepEqual(
    pickShiftDefaults({ ...lists, devicePicks: [], fallbackCashAccountId: "c2", fallbackWarehouseId: "nope" }),
    { cashAccountId: "c2", warehouseId: "w1", fromDevice: false }
  );
  assert.deepEqual(pickShiftDefaults({ cashAccountIds: [], warehouseIds: [], devicePicks: [] }), {
    cashAccountId: "",
    warehouseId: "",
    fromDevice: false,
  });
});

test("parse: гажиг утгыг хаяж, дээд тоогоор таслана", () => {
  assert.deepEqual(parseShiftDevicePicks(null), []);
  assert.deepEqual(parseShiftDevicePicks({ cashAccountId: "c1" }), []);
  assert.deepEqual(
    parseShiftDevicePicks([{ cashAccountId: "c1", warehouseId: "w1", extra: 1 }, { cashAccountId: "", warehouseId: "w" }, "x"]),
    [{ cashAccountId: "c1", warehouseId: "w1" }]
  );
  const many = Array.from({ length: 20 }, (_, i) => ({ cashAccountId: `c${i}`, warehouseId: "w" }));
  assert.equal(parseShiftDevicePicks(many).length, SHIFT_DEVICE_MAX_ENTRIES);
});

test("remember: шинэ нь эхэнд, ижил кассын хуучин мөр солигдоно", () => {
  const next = rememberShiftDevicePick(
    [
      { cashAccountId: "c1", warehouseId: "w1" },
      { cashAccountId: "c2", warehouseId: "w2" },
    ],
    { cashAccountId: "c2", warehouseId: "w1" }
  );
  assert.deepEqual(next, [
    { cashAccountId: "c2", warehouseId: "w1" },
    { cashAccountId: "c1", warehouseId: "w1" },
  ]);
});
